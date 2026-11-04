"""批次异常看板：读取上游数据并维护本地追加式快照。"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from pymongo import ReturnDocument
from pymongo.errors import BulkWriteError

from app.core.timezone import beijing_now
from app.models.documents import Collections
from app.services.async_ttl_cache import AsyncTTLCache

QUERY_URL = "http://10.2.68.103/api/exception/queryExceptionList.action"
EXCEPTION_TYPE_URL = "http://10.2.68.103/api/exception/queryExceptionType.action"

# 上游使用分页接口；每页最多读取 5000 条。
MAX_ROWS = 5000
SYNC_CACHE_TTL = timedelta(hours=24)
# 筛选项样本窗口取最近一年：既能覆盖当前在产机型，又把上游扫描耗时控制在秒级。
OPTIONS_SAMPLE_DAYS = 365
QUERY_TIMEOUT = httpx.Timeout(30.0, connect=8.0)

# 上游工厂编码（与基地权限的映射见 API 层，青岛上游为 Q000、权限侧为 QD）。
FACTORY_OPTIONS: tuple[tuple[str, str], ...] = (
    ("1000", "天津"),
    ("2000", "盘锦"),
    ("3000", "昆山"),
    ("Q000", "青岛"),
    ("7000", "太原"),
    ("8000", "安阳"),
    ("9000", "桐乡"),
    ("D000", "大同"),
)

STATE_LABELS: dict[str, str] = {"Open": "未关闭", "Closed": "已关闭"}

_FACTORY_ALIASES = {alias: code for code, label in FACTORY_OPTIONS for alias in (code, label)}
_FACTORY_ALIASES.update(
    {
        "TJ": "1000",
        "PJ": "2000",
        "KS": "3000",
        "QD": "Q000",
        "TY": "7000",
        "AY": "8000",
        "TX": "9000",
        "DT": "D000",
    }
)

_cache = AsyncTTLCache(max_entries=32)


class BatchExceptionUpstreamError(RuntimeError):
    """上游批次异常系统返回异常。"""


def _client() -> httpx.AsyncClient:
    # 上游是内网私有服务，禁用 shell 代理，避免请求被 HTTP_PROXY 劫持。
    return httpx.AsyncClient(timeout=QUERY_TIMEOUT, trust_env=False)


async def _get_json(url: str, params: dict[str, Any], *, envelope: bool = True) -> dict[str, Any]:
    try:
        async with _client() as client:
            response = await client.get(url, params=params)
    except httpx.HTTPError as exc:
        raise BatchExceptionUpstreamError(f"连接批次异常系统失败：{exc}") from exc
    if response.status_code >= 300:
        raise BatchExceptionUpstreamError(f"批次异常系统返回 HTTP {response.status_code}")
    try:
        body = response.json()
    except ValueError as exc:
        raise BatchExceptionUpstreamError("批次异常系统返回了非 JSON 响应") from exc
    if not isinstance(body, dict):
        raise BatchExceptionUpstreamError("批次异常系统响应格式无效")
    # 异常类型接口直接返回 {一级类型: [二级类型]}，没有 code 包装。
    if envelope and body.get("code") != 0:
        raise BatchExceptionUpstreamError(
            f"批次异常系统查询失败：{body.get('msg') or body.get('code')}"
        )
    return body


async def _query_rows(
    params: dict[str, Any], *, page: int = 1, limit: int = MAX_ROWS
) -> tuple[int, list[dict[str, Any]]]:
    body = await _get_json(QUERY_URL, {"page": page, "limit": limit, **params})
    rows = body.get("data")
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise BatchExceptionUpstreamError("批次异常系统返回的数据格式无效")
    try:
        total = int(body.get("count") or 0)
    except (TypeError, ValueError) as exc:
        raise BatchExceptionUpstreamError("批次异常系统返回的总数无效") from exc
    return total, rows


def _source_key(row: dict[str, Any]) -> str:
    for field in ("id", "exceptionId", "batchId"):
        value = row.get(field)
        if value is not None and str(value).strip():
            return f"source:{field}:{str(value).strip()}"
    encoded = json.dumps(
        row, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str
    )
    return f"sha256:{hashlib.sha256(encoded.encode('utf-8')).hexdigest()}"


def _editable_defaults(source: dict[str, Any]) -> dict[str, str]:
    return {
        "platform": str(source.get("platform") or "").strip(),
        "customer": str(source.get("customer") or "").strip(),
        "base": str(source.get("factory") or "").strip(),
        "errTypeFirst": str(source.get("errTypeFirst") or "").strip(),
        "causedBy": str(source.get("causedBy") or "").strip(),
    }


def serialize_batch_exception(document: dict[str, Any]) -> dict[str, Any]:
    """Expose the immutable source snapshot with its separate editable values."""
    source = document.get("source") if isinstance(document.get("source"), dict) else {}
    editable = document.get("editable") if isinstance(document.get("editable"), dict) else {}
    return {
        **source,
        **editable,
        "sequence": document.get("sequence"),
        "syncYear": document.get("sync_year"),
        # 合并统计：被合并行指向组内最小 sequence（锚点行本身没有该字段）。
        "mergedInto": document.get("merged_into"),
    }


async def _insert_new_rows(db: Any, year: int, rows: list[dict[str, Any]]) -> int:
    collection = db[Collections.BATCH_EXCEPTION_RECORDS]
    unique_rows: dict[str, dict[str, Any]] = {}
    for row in rows:
        unique_rows.setdefault(_source_key(row), row)
    keys = list(unique_rows)
    if not keys:
        return 0

    existing_keys: set[str] = set()
    for offset in range(0, len(keys), 1000):
        existing = await collection.find(
            {"source_key": {"$in": keys[offset : offset + 1000]}},
            {"source_key": 1},
        ).to_list(length=None)
        existing_keys.update(item["source_key"] for item in existing)
    pending = [(key, row) for key, row in unique_rows.items() if key not in existing_keys]
    if not pending:
        return 0

    counters = db[Collections.BATCH_EXCEPTION_COUNTERS]
    maximum = await collection.find_one(
        {"sequence": {"$exists": True}}, {"sequence": 1}, sort=[("sequence", -1)]
    )
    await counters.update_one(
        {"_id": "batch_exception"},
        {"$max": {"value": int((maximum or {}).get("sequence") or 0)}},
        upsert=True,
    )

    inserted = 0
    for offset in range(0, len(pending), 1000):
        batch = pending[offset : offset + 1000]
        counter = await counters.find_one_and_update(
            {"_id": "batch_exception"},
            {"$inc": {"value": len(batch)}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        first_sequence = int(counter["value"]) - len(batch) + 1
        now = beijing_now().isoformat()
        documents = [
            {
                "source_key": key,
                "sync_year": year,
                "sequence": first_sequence + index,
                "source": row,
                "editable": _editable_defaults(row),
                "created_at": now,
            }
            for index, (key, row) in enumerate(batch)
        ]
        try:
            result = await collection.insert_many(documents, ordered=False)
            inserted += len(result.inserted_ids)
        except BulkWriteError as exc:
            errors = (exc.details or {}).get("writeErrors", [])
            if any(error.get("code") != 11000 for error in errors):
                raise
            inserted += int((exc.details or {}).get("nInserted") or 0)
    return inserted


async def sync_current_year(db: Any) -> dict[str, Any]:
    """Reuse a successful yearly sync for 24 hours, otherwise append unseen rows."""
    now = beijing_now()
    today = now.date()
    sync_state = db[Collections.BATCH_EXCEPTION_COUNTERS]
    previous = await sync_state.find_one({"_id": "batch_exception_year_sync"})
    synced_at = (previous or {}).get("synced_at")
    if isinstance(synced_at, datetime):
        if synced_at.tzinfo is None:
            synced_at = synced_at.replace(tzinfo=timezone.utc)
        age = now.astimezone(timezone.utc) - synced_at.astimezone(timezone.utc)
        if previous.get("year") == today.year and timedelta(0) <= age < SYNC_CACHE_TTL:
            return {
                "year": today.year,
                "fetched": previous.get("fetched", 0),
                "inserted": previous.get("inserted", 0),
                "syncedAt": synced_at.isoformat(),
                "cached": True,
            }

    params = {
        "factory": "",
        "createTimeStart": date(today.year, 1, 1).isoformat(),
        "createTimeEnd": today.isoformat(),
    }
    total, first_page = await _query_rows(params, page=1)
    rows = list(first_page)
    expected_total = max(total, len(rows))
    page = 1
    while len(rows) < expected_total:
        page += 1
        _, page_rows = await _query_rows(params, page=page)
        if not page_rows:
            raise BatchExceptionUpstreamError("批次异常系统分页数据不完整，请稍后重试")
        rows.extend(page_rows)
    inserted = await _insert_new_rows(db, today.year, rows)
    synced_at = beijing_now()
    result = {
        "year": today.year,
        "fetched": len(rows),
        "inserted": inserted,
        "syncedAt": synced_at.isoformat(),
        "cached": False,
    }
    await sync_state.update_one(
        {"_id": "batch_exception_year_sync"},
        {
            "$set": {
                "year": today.year,
                "fetched": len(rows),
                "inserted": inserted,
                "synced_at": synced_at,
            }
        },
        upsert=True,
    )
    return result


def _factory_code(value: Any) -> str:
    text = str(value or "").strip()
    return _FACTORY_ALIASES.get(text.upper(), _FACTORY_ALIASES.get(text, text))


def _as_date(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


def _contains(value: Any, query: str) -> bool:
    return query.casefold() in str(value or "").casefold()


def _responsibility_matches(value: Any, query: str) -> bool:
    """Match a responsibility token even when the upstream stores combinations."""
    normalized_query = str(query or "").strip().casefold()
    if not normalized_query:
        return True
    tokens = re.split(r"[,，;；/\s]+", str(value or "").strip().casefold())
    return normalized_query in tokens


async def query_batch_exceptions(
    db: Any,
    *,
    factory: str,
    create_time_start: date,
    create_time_end: date,
    models: str = "",
    order_id: str = "",
    err_type_first: str = "",
    err_type_second: str = "",
    sales_receipts: str = "",
    state: str = "",
    caused_by: str = "",
) -> dict[str, Any]:
    """Query this year's local append-only snapshots using dashboard filters."""
    today = beijing_now().date()
    documents = (
        await db[Collections.BATCH_EXCEPTION_RECORDS]
        .find({"sync_year": today.year})
        .sort("sequence", 1)
        .to_list(length=None)
    )
    factory_code = _factory_code(factory)
    filtered: list[dict[str, Any]] = []
    for document in documents:
        source = document.get("source") or {}
        editable = document.get("editable") or {}
        if factory_code and _factory_code(source.get("factory")) != factory_code:
            continue
        created = _as_date(source.get("createTime"))
        if created is None or not create_time_start <= created <= create_time_end:
            continue
        if models and str(source.get("models") or "").strip() != models:
            continue
        if order_id and str(source.get("orderID") or "").strip() != order_id:
            continue
        if err_type_first and str(editable.get("errTypeFirst") or "").strip() != err_type_first:
            continue
        if err_type_second and str(source.get("errTypeSecond") or "").strip() != err_type_second:
            continue
        if sales_receipts and not _contains(source.get("salesReceipts"), sales_receipts):
            continue
        if state and str(source.get("state") or "").strip() != state:
            continue
        if caused_by and not _responsibility_matches(editable.get("causedBy"), caused_by):
            continue
        filtered.append(serialize_batch_exception(document))
    return {
        "upstreamTotal": len(filtered),
        "readCount": len(filtered),
        "complete": True,
        "queriedAt": beijing_now().isoformat(),
        "rows": filtered,
    }


async def collect_merge_group(collection: Any, sequences: list[int]) -> dict[int, dict[str, Any]]:
    """Expand the selected sequences into their full merge groups (flattened)."""
    documents = await collection.find({"sequence": {"$in": sequences}}).to_list(length=None)
    if len(documents) != len(sequences):
        found = {int(document["sequence"]) for document in documents}
        missing = next(sequence for sequence in sequences if sequence not in found)
        raise LookupError(missing)
    # 所选记录可能已经是锚点或成员：把涉及到的整组都取回来，统一拍平。
    anchors = sorted(
        {int(document.get("merged_into") or document["sequence"]) for document in documents}
    )
    member_documents = await collection.find({"merged_into": {"$in": anchors}}).to_list(length=None)
    anchor_documents = await collection.find({"sequence": {"$in": anchors}}).to_list(length=None)
    return {
        int(document["sequence"]): document for document in [*anchor_documents, *member_documents]
    }


async def merge_batch_exceptions(
    db: Any,
    *,
    sequences: list[int],
    operator: str,
    check_access: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Merge the given records (and any groups they belong to) under one anchor."""
    collection = db[Collections.BATCH_EXCEPTION_RECORDS]
    unique = list(dict.fromkeys(sequences))
    if len(unique) < 2:
        raise ValueError("请至少选择两条记录")
    group = await collect_merge_group(collection, unique)
    if check_access:
        for document in group.values():
            check_access(document)
    anchor = min(group)
    others = [sequence for sequence in group if sequence != anchor]
    if others:
        await collection.update_many(
            {"sequence": {"$in": others}},
            {
                "$set": {
                    "merged_into": anchor,
                    "merged_by": operator,
                    "merged_at": beijing_now().isoformat(),
                }
            },
        )
    # 锚点自身绝不能带 merged_into，兜底清理保证不变量。
    await collection.update_one(
        {"sequence": anchor, "merged_into": {"$exists": True}},
        {"$unset": {"merged_into": "", "merged_by": "", "merged_at": ""}},
    )
    return {"anchor": anchor, "merged": len(group)}


async def unmerge_batch_exceptions(
    db: Any,
    *,
    sequence: int,
    check_access: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Dissolve the whole group the given record belongs to."""
    collection = db[Collections.BATCH_EXCEPTION_RECORDS]
    document = await collection.find_one({"sequence": sequence})
    if document is None:
        raise LookupError(sequence)
    anchor = int(document.get("merged_into") or document["sequence"])
    if check_access:
        members = await collection.find({"merged_into": anchor}).to_list(length=None)
        check_access(document)
        for member in members:
            check_access(member)
    await collection.update_many(
        {"merged_into": anchor},
        {"$unset": {"merged_into": "", "merged_by": "", "merged_at": ""}},
    )
    return {"anchor": anchor}


async def _load_exception_types() -> dict[str, list[str]]:
    body = await _get_json(EXCEPTION_TYPE_URL, {}, envelope=False)
    types = body if isinstance(body, dict) else {}
    return {
        str(first): [str(second) for second in seconds]
        for first, seconds in types.items()
        if isinstance(seconds, list)
    }


def _sorted_unique(values: list[Any], *, reverse: bool = False) -> list[str]:
    unique = {str(value).strip() for value in values if value is not None and str(value).strip()}
    return sorted(unique, key=lambda item: item.casefold(), reverse=reverse)


async def _load_options(factory: str) -> dict[str, Any]:
    today = beijing_now().date()
    _, rows = await _query_rows(
        {
            "factory": factory,
            "createTimeStart": (today - timedelta(days=OPTIONS_SAMPLE_DAYS)).isoformat(),
            "createTimeEnd": today.isoformat(),
        }
    )
    states = _sorted_unique([row.get("state") for row in rows] + list(STATE_LABELS))
    return {
        "errTypes": await _cache.get_or_set(
            "exception-types", _load_exception_types, ttl_seconds=900
        ),
        "models": _sorted_unique([row.get("models") for row in rows]),
        "causedBy": _sorted_unique([row.get("causedBy") for row in rows]),
        "orders": _sorted_unique([row.get("orderID") for row in rows], reverse=True),
        "salesReceipts": _sorted_unique([row.get("salesReceipts") for row in rows], reverse=True),
        "states": [{"value": value, "label": STATE_LABELS.get(value, value)} for value in states],
    }


async def fetch_options(factory: str) -> dict[str, Any]:
    """按基地缓存筛选项样本（上游没有独立的选项接口）。"""
    return await _cache.get_or_set(
        f"options:{factory or 'all'}", lambda: _load_options(factory), ttl_seconds=300
    )
