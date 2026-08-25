"""Shared primitives for SCS DOA full and incremental synchronization.

The existing full-sync scripts remain usable as standalone commands.  This
module owns the pieces that need to stay consistent for scheduled jobs:
session setup, date normalization, stable-key migration, and idempotent writes.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import logging
import os
import re
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import requests
from pymongo import MongoClient

from spider_scs import fetch_page, login, parse_form

logger = logging.getLogger(__name__)

MONGO_URL = os.getenv("MONGODB_URL", "mongodb://10.17.154.252:27019")
DB_NAME = os.getenv("MONGODB_DB_NAME", "quality_monitoring")
DOA_COLLECTION = "scs_doa_results"
PROGRESS_COLLECTION = "scs_doa_incremental_progress"
PROGRESS_ID = "scs_doa_incremental"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def decode_unicode_escapes(value: str) -> str:
    """Decode SCS ``%uXXXX`` escapes into readable text."""
    def _replace(match: re.Match[str]) -> str:
        return chr(int(match.group(1), 16))
    return re.sub(r"%u([0-9A-Fa-f]{4})", _replace, value)


def login_with_error_check(
    session: requests.Session,
    username: str,
    password: str,
    clientstamp: str,
    timeout: float,
) -> None:
    """Login and fail loudly when SCS rejects the account.

    SCS returns HTTP 200 even for failed login; the business error is carried
    in the ``echoStr`` / ``returnValue`` JSON fields.  Raising here turns the
    misleading "redirect to logoff" symptom into an actionable message.
    """
    login(session, username, password, clientstamp, timeout)
    try:
        payload = session.post(
            "https://scs.sugon.com/prod/ssocontroller",
            data={
                "name": username,
                "password": password,
                "randcode": "",
                "contextServiceName": "do_org_user_findbynameandpwd_sugon",
                "mobileclient": "false",
                "clientstamp": clientstamp,
            },
            timeout=(15.0, timeout),
        )
        body = payload.json()
    except Exception:
        logger.warning("无法确认 SCS 登录业务结果，继续按已登录处理")
        return
    return_value = str(body.get("returnValue") or "")
    echo_str = body.get("echoStr") or ""
    if return_value == "noforward" or (
        return_value not in {"success", ""} and "success" not in str(body).lower()
    ):
        raise RuntimeError(
            f"SCS 登录失败（账号可能已删除或无权限）: {decode_unicode_escapes(str(echo_str))}"
            f" returnValue={return_value}"
        )


def clean_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\xa0", " ").split())


def normalize_accepted_date(value: Any) -> str | None:
    """Normalize SCS accepted time to an ISO date string."""
    text = clean_text(value)
    if not text:
        return None
    candidate = text[:10].replace("/", "-")
    try:
        return datetime.strptime(candidate, "%Y-%m-%d").date().isoformat()
    except ValueError:
        return None


def parse_iso_date(value: str, *, option: str = "date") -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{option} 必须是 YYYY-MM-DD") from exc


def row_hash(row: dict[str, Any]) -> str:
    canonical = json.dumps(
        row,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def create_session(username: str, password: str, clientstamp: str, timeout: float) -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0",
            "Referer": "http://scs.sugon.com/",
            "Origin": "http://scs.sugon.com",
        }
    )
    login(session, username, password, clientstamp, timeout)
    return session


def iter_incremental_pages(
    session: requests.Session,
    *,
    start_date: date,
    end_date: date,
    page_size: int,
    max_pages: int,
    clientstamp: str,
    timeout: float,
) -> Iterator[tuple[int, dict[str, str], list[dict[str, str]], str]]:
    """Yield parsed SCS pages and require a definitive end before returning."""
    if max_pages < 1:
        raise ValueError("max_pages 必须大于 0")
    for page in range(1, max_pages + 1):
        response = fetch_page(
            session,
            page,
            page_size,
            clientstamp,
            timeout,
            start_date=start_date.isoformat(),
            end_date=end_date.isoformat(),
        )
        fields, rows = parse_form(response.content)
        yield page, fields, rows, response.url
        if not rows or len(rows) < page_size:
            return
    raise RuntimeError(
        f"达到 --max-pages={max_pages} 仍未遇到短页/空页，请增加 max-pages 后重试"
    )


def ensure_indexes(collection: Any) -> None:
    """Create indexes after the optional key migration has removed duplicates."""
    collection.create_index("scs_key", unique=True, sparse=True, name="uniq_scs_doa_key")
    collection.create_index(
        "scs_enrichment.accepted_date", name="scs_doa_accepted_date"
    )
    collection.create_index("scs_enrichment.status", name="scs_doa_enrichment_status")


def _document_time(document: dict[str, Any]) -> datetime:
    value = document.get("updated_at") or document.get("created_at")
    if isinstance(value, datetime):
        return value
    return datetime.min.replace(tzinfo=timezone.utc)


def migrate_stable_keys(collection: Any) -> dict[str, int]:
    """Backfill ``scs_key`` and collapse legacy hash duplicates.

    The newest document is retained for each service-order ID.  Older
    documents contribute enrichment fields that are missing from the retained
    document.  Documents without a service-order ID are left untouched and are
    allowed by the sparse unique index.
    """
    grouped: dict[str, list[dict[str, Any]]] = {}
    scanned = 0
    for document in collection.find({"data.服务单号_id": {"$exists": True}}):
        scanned += 1
        key = clean_text((document.get("data") or {}).get("服务单号_id"))
        if key:
            grouped.setdefault(key, []).append(document)

    merged = removed = 0
    for key, documents in grouped.items():
        documents.sort(key=_document_time, reverse=True)
        keep = documents[0]
        enrichment = dict(keep.get("scs_enrichment") or {})
        for duplicate in documents[1:]:
            for field, value in (duplicate.get("scs_enrichment") or {}).items():
                if field not in enrichment or enrichment[field] in (None, "", False):
                    enrichment[field] = value
            collection.delete_one({"_id": duplicate["_id"]})
            removed += 1
        update: dict[str, Any] = {"scs_key": key}
        if enrichment:
            update["scs_enrichment"] = enrichment
        collection.update_one({"_id": keep["_id"]}, {"$set": update})
        merged += 1

    ensure_indexes(collection)
    return {"scanned": scanned, "keys": merged, "duplicates_removed": removed}


def upsert_doa_rows(
    collection: Any,
    rows: list[dict[str, Any]],
    fields: dict[str, Any],
    source_url: str,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Upsert page rows by service-order ID and mark changed rows for enrichment."""
    timestamp = utc_now()
    keys: list[str] = []
    changed_keys: list[str] = []
    skipped = 0
    for row in rows:
        key = clean_text(row.get("服务单号_id"))
        if not key:
            skipped += 1
            continue
        current = collection.find_one(
            {"scs_key": key},
            {"record_hash": 1, "data": 1},
        )
        digest = row_hash(row)
        is_changed = current is None or current.get("record_hash") != digest
        keys.append(key)
        if is_changed:
            changed_keys.append(key)
        if dry_run:
            continue

        # The listing page does not contain product-entity fields. Merge it
        # into the existing data so a later list refresh cannot erase a
        # successful detail enrichment.
        old_data = current.get("data") if current else None
        merged_data = {**old_data, **row} if isinstance(old_data, dict) else dict(row)
        update = {
            "$set": {
                "scs_key": key,
                "page_fields": fields,
                "data": merged_data,
                "record_hash": digest,
                "scs_enrichment.accepted_date": normalize_accepted_date(row.get("受理时间")),
                "source_url": source_url,
                "updated_at": timestamp,
            },
            "$setOnInsert": {"created_at": timestamp},
        }
        if is_changed:
            update["$set"]["scs_enrichment.needs_enrichment"] = True
        collection.update_one({"scs_key": key}, update, upsert=True)

    return {
        "keys": keys,
        "changed_keys": changed_keys,
        "skipped": skipped,
        "accepted_dates": [
            value
            for value in (normalize_accepted_date(row.get("受理时间")) for row in rows)
            if value
        ],
    }


@contextmanager
def single_instance_lock(path: str | None = None) -> Iterator[None]:
    """Acquire a non-blocking POSIX lock for cron invocations."""
    lock_path = Path(
        path
        or os.getenv(
            "SCS_INCREMENTAL_LOCK_PATH",
            "/tmp/quality-monitoring-scs-doa-incremental.lock",
        )
    )
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError(f"已有 SCS 增量任务运行中: {lock_path}") from exc
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def get_mongo() -> MongoClient:
    return MongoClient(MONGO_URL, serverSelectionTimeoutMS=30_000)


def resolve_watermark(
    collection: Any,
    progress_collection: Any,
    start_date: str | None,
) -> date:
    progress = progress_collection.find_one({"_id": PROGRESS_ID}) or {}
    stored = progress.get("watermark_date")
    if stored:
        return parse_iso_date(str(stored), option="watermark_date")

    latest = collection.find_one(
        {"scs_enrichment.accepted_date": {"$exists": True}},
        {"scs_enrichment.accepted_date": 1},
        sort=[("scs_enrichment.accepted_date", -1)],
    )
    latest_value = (latest or {}).get("scs_enrichment", {}).get("accepted_date")
    if latest_value:
        return parse_iso_date(str(latest_value), option="accepted_date")
    if start_date:
        return parse_iso_date(start_date, option="start-date")
    raise ValueError("历史集合为空，请首次运行时提供 --start-date YYYY-MM-DD")


def update_progress(progress_collection: Any, **values: Any) -> None:
    progress_collection.update_one(
        {"_id": PROGRESS_ID},
        {"$set": {**values, "updated_at": utc_now()}, "$setOnInsert": {"created_at": utc_now()}},
        upsert=True,
    )
