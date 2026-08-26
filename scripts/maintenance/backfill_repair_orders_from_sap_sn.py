#!/usr/bin/env python3
"""Use the SAP SN-info interface to fill missing repair order fields.

The script deduplicates SNs across missing ``AUFNR`` and ``VBELN`` records,
queries SG and KK once per batch, and only updates fields that are still
empty. It defaults to a dry-run:

    uv run --project backend python scripts/maintenance/backfill_repair_orders_from_sap_sn.py
    uv run --project backend python scripts/maintenance/backfill_repair_orders_from_sap_sn.py --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import UpdateOne

BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.db.mongodb import close_mongo_connection, connect_to_mongo, get_database  # noqa: E402
from app.services.sap_sn_info_service import SapSnInfoService  # noqa: E402

REPAIR_COLLECTION = "repair_records_sap"
AUDIT_COLLECTION = "repair_sn_api_backfill_runs"
EMPTY_VALUES = (None, "", "0")


def is_empty(value: Any) -> bool:
    return value in EMPTY_VALUES


def clean(value: Any) -> str:
    return str(value or "").strip()


def normalize_order(value: Any) -> str:
    text = clean(value)
    return text.zfill(12) if text.isdigit() and text else text


def normalize_sales(value: Any) -> str:
    text = re.sub(r"--\d+$", "", clean(value))
    return text.lstrip("0") if text.isdigit() else text


def parse_item(record: dict[str, Any]) -> dict[str, str]:
    """Normalize the documented SAP response fields for Mongo updates."""
    result = {
        key: clean(record.get(key))
        for key in ("PCODE", "AUFNR", "MATNR", "MAKTX", "CDATE_S", "CDATE_E", "CDATE_I", "CDATE_O")
    }
    for key in ("CDATE_S", "CDATE_E", "CDATE_I", "CDATE_O"):
        if result[key] == "0000-00-00":
            result[key] = ""
    return result


async def load_sales_by_order(db: Any, production_orders: set[str]) -> dict[str, str]:
    """Resolve a unique VBELN from the local order master, then BOM fallback."""
    if not production_orders:
        return {}
    master: dict[str, set[str]] = {}
    cursor = db["sales_orders_sap"].find({}, {"aufnr": 1, "data.VBELN": 1})
    async for document in cursor:
        order = normalize_order(document.get("aufnr"))
        sales = normalize_sales((document.get("data") or {}).get("VBELN"))
        if order in production_orders and sales:
            master.setdefault(order, set()).add(sales)
    bom: dict[str, set[str]] = {}
    cursor = db["order_bom_postings_sap"].find(
        {"AUFNR_1": {"$in": list(production_orders)}},
        {"AUFNR_1": 1, "VBELN_EX": 1},
    )
    async for document in cursor:
        order = normalize_order(document.get("AUFNR_1"))
        sales = normalize_sales(document.get("VBELN_EX"))
        if order in production_orders and sales:
            bom.setdefault(order, set()).add(sales)

    resolved: dict[str, str] = {}
    for order in production_orders:
        master_values = master.get(order, set())
        bom_values = bom.get(order, set())
        overlap = master_values & bom_values
        if len(master_values) == 1:
            resolved[order] = next(iter(master_values))
        elif len(overlap) == 1:
            resolved[order] = next(iter(overlap))
        elif len(bom_values) == 1:
            resolved[order] = next(iter(bom_values))
    return resolved


def merge_items(results: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Merge duplicate SG/KK rows by PCODE and preserve source names."""
    merged: dict[str, dict[str, Any]] = {}
    for source, result in results.items():
        if not result.success:
            continue
        for raw in result.records:
            item = parse_item(raw)
            pcode = item["PCODE"]
            if not pcode:
                continue
            current = merged.setdefault(pcode, {**item, "sources": []})
            for key, value in item.items():
                if not current.get(key) and value:
                    current[key] = value
            if source not in current["sources"]:
                current["sources"].append(source)
    return merged


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="通过 SAP SN_INFO 接口补充维修订单字段")
    parser.add_argument("--apply", action="store_true", help="写入数据库；默认只统计")
    parser.add_argument("--batch-size", type=int, default=200, help="每批 SN 数，默认 200")
    return parser.parse_args()


async def run(apply: bool, batch_size: int) -> dict[str, Any]:
    if batch_size < 1 or batch_size > 1000:
        raise ValueError("--batch-size 必须在 1 到 1000 之间")

    db = get_database()
    collection = db[REPAIR_COLLECTION]
    empty_aufnr = {"$or": [{"AUFNR": {"$exists": False}}, {"AUFNR": None}, {"AUFNR": ""}, {"AUFNR": "0"}]}
    empty_vbeln = {"$or": [{"VBELN": {"$exists": False}}, {"VBELN": None}, {"VBELN": ""}, {"VBELN": "0"}]}

    candidates = await collection.find(
        {"$or": [empty_aufnr, empty_vbeln]},
        {"_id": 1, "PCODE": 1, "AUFNR": 1, "VBELN": 1},
    ).to_list(None)
    serial_numbers = sorted({clean(row.get("PCODE")) for row in candidates if clean(row.get("PCODE"))})
    run_id = uuid.uuid4().hex
    started_at = datetime.now(timezone.utc)
    summary: dict[str, Any] = {
        "run_id": run_id,
        "mode": "apply" if apply else "dry_run",
        "candidate_records": len(candidates),
        "unique_sn": len(serial_numbers),
        "batch_size": batch_size,
        "batch_count": (len(serial_numbers) + batch_size - 1) // batch_size,
        "api_calls": 0,
        "api_successful_sources": 0,
        "api_failed_sources": 0,
        "matched_sn": 0,
        "aufnr_updates_planned": 0,
        "vbeln_updates_planned": 0,
        "records_updates_planned": 0,
        "modified_updates": 0,
        "started_at": started_at.isoformat(),
        "source_errors": {},
    }
    items: dict[str, dict[str, Any]] = {}
    service = SapSnInfoService()
    for offset in range(0, len(serial_numbers), batch_size):
        batch = serial_numbers[offset : offset + batch_size]
        results = await service.fetch_all(batch)
        summary["api_calls"] += len(results)
        for source, result in results.items():
            if result.success:
                summary["api_successful_sources"] += 1
            else:
                summary["api_failed_sources"] += 1
                summary["source_errors"][source] = result.error
        items.update(merge_items(results))

    summary["matched_sn"] = len(items)
    production_orders = {
        normalize_order(item["AUFNR"])
        for item in items.values()
        if item.get("AUFNR")
    }
    sales_by_order = await load_sales_by_order(db, production_orders)
    for item in items.values():
        item["VBELN"] = sales_by_order.get(normalize_order(item.get("AUFNR")), "")
    operations: list[UpdateOne] = []
    for row in candidates:
        sn = clean(row.get("PCODE"))
        item = items.get(sn)
        if not item:
            continue
        updates: dict[str, Any] = {
            "repair_sn_api_backfill.run_id": run_id,
            "repair_sn_api_backfill.sources": item["sources"],
            "repair_sn_api_backfill.updated_at": started_at,
        }
        if is_empty(row.get("AUFNR")) and item["AUFNR"]:
            updates["AUFNR"] = item["AUFNR"]
            summary["aufnr_updates_planned"] += 1
        if is_empty(row.get("VBELN")) and item["VBELN"]:
            updates["VBELN"] = item["VBELN"]
            summary["vbeln_updates_planned"] += 1
        if len(updates) == 3:
            continue
        summary["records_updates_planned"] += 1
        operations.append(UpdateOne({"_id": row["_id"]}, {"$set": updates}))

    if apply and operations:
        for offset in range(0, len(operations), 1000):
            result = await collection.bulk_write(operations[offset : offset + 1000], ordered=False)
            summary["modified_updates"] += result.modified_count
        summary["completed_at"] = datetime.now(timezone.utc).isoformat()
        await db[AUDIT_COLLECTION].insert_one(summary)
    return summary


async def main() -> None:
    args = parse_args()
    await connect_to_mongo()
    try:
        print(json.dumps(await run(args.apply, args.batch_size), ensure_ascii=False, default=str, sort_keys=True))
    finally:
        await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(main())
