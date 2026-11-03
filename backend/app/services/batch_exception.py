"""批次异常看板：实时代理 10.2.68.103 批次异常查询系统。"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import httpx

from app.core.timezone import beijing_now
from app.services.async_ttl_cache import AsyncTTLCache

QUERY_URL = "http://10.2.68.103/api/exception/queryExceptionList.action"
EXCEPTION_TYPE_URL = "http://10.2.68.103/api/exception/queryExceptionType.action"

# 上游单次查询可返回全部匹配记录；5000 足够覆盖数年数据，同时避免慢查询拖垮页面。
MAX_ROWS = 5000
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


async def _query_rows(params: dict[str, Any]) -> tuple[int, list[dict[str, Any]]]:
    body = await _get_json(QUERY_URL, {"page": 1, "limit": MAX_ROWS, **params})
    rows = body.get("data")
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise BatchExceptionUpstreamError("批次异常系统返回的数据格式无效")
    try:
        total = int(body.get("count") or 0)
    except (TypeError, ValueError) as exc:
        raise BatchExceptionUpstreamError("批次异常系统返回的总数无效") from exc
    return total, rows


async def query_batch_exceptions(
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
    """按筛选条件向上游实时查询批次异常记录（不做本地缓存）。"""
    params: dict[str, Any] = {
        "factory": factory,
        "createTimeStart": create_time_start.isoformat(),
        "createTimeEnd": create_time_end.isoformat(),
    }
    for key, value in (
        ("models", models),
        ("orderID", order_id),
        ("errTypeFirst", err_type_first),
        ("errTypeSecond", err_type_second),
        ("salesReceipts", sales_receipts),
        ("state", state),
        ("causedBy", caused_by),
    ):
        if value:
            params[key] = value
    total, rows = await _query_rows(params)
    return {
        "upstreamTotal": total,
        "readCount": len(rows),
        "complete": total <= len(rows),
        "queriedAt": beijing_now().isoformat(),
        "rows": rows,
    }


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
