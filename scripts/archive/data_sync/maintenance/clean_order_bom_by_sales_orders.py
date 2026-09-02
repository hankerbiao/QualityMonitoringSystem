#!/usr/bin/env python3
"""Remove BOM rows with a production order but no known sales order.

Run from the repository root:

    uv run --project backend python scripts/archive/data_sync/maintenance/clean_order_bom_by_sales_orders.py
    uv run --project backend python scripts/archive/data_sync/maintenance/clean_order_bom_by_sales_orders.py --apply

Rows without ``AUFNR_1`` are retained. The default is a read-only dry run.
``--apply`` deletes only records whose inspected fields are unchanged, then
writes an audit summary to ``order_bom_sales_order_cleanup_runs``.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import DeleteOne

BACKEND_DIR = Path(__file__).resolve().parents[4] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.db.mongodb import close_mongo_connection, connect_to_mongo, get_database  # noqa: E402

BOM_COLLECTION = "order_bom_postings_sap"
SALES_ORDERS_COLLECTION = "sales_orders_sap"
AUDIT_COLLECTION = "order_bom_sales_order_cleanup_runs"


def normalize_aufnr(value: Any) -> str:
    """Return the canonical production-order key used by the sales-order master."""
    text = str(value or "").strip()
    if not text or (text.isdigit() and not text.lstrip("0")):
        return ""
    return text.zfill(12) if text.isdigit() else text


def normalize_vbeln(value: Any) -> str:
    """Return the canonical sales-order key used by the sales-order dashboard."""
    text = str(value or "").strip()
    if not text or (text.isdigit() and not text.lstrip("0")):
        return ""
    return text.lstrip("0") if text.isdigit() else text


async def load_sales_order_vbelns(collection: Any) -> set[str]:
    """Load normalized sales-order keys exposed by the sales-order dashboard."""
    vbelns: set[str] = set()
    cursor = collection.find({}, {"data.VBELN": 1})
    async for document in cursor:
        if vbeln := normalize_vbeln((document.get("data") or {}).get("VBELN")):
            vbelns.add(vbeln)
    return vbelns


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="清理有 AUFNR_1 但销售订单号不在看板中的订单 BOM 数据"
    )
    parser.add_argument("--apply", action="store_true", help="执行删除；省略时只统计")
    parser.add_argument("--batch-size", type=int, default=1_000, help="删除批次大小，默认 1000")
    parser.add_argument("--sample-size", type=int, default=20, help="输出待删除样本数量，默认 20")
    return parser.parse_args()


async def run(*, apply: bool, batch_size: int, sample_size: int) -> dict[str, Any]:
    """Compare all BOM rows with the sales-order master and optionally delete invalid rows."""
    if batch_size < 1:
        raise ValueError("--batch-size 必须大于 0")
    if sample_size < 0:
        raise ValueError("--sample-size 不能小于 0")

    db = get_database()
    bom = db[BOM_COLLECTION]
    run_id = uuid.uuid4().hex
    started_at = datetime.now(timezone.utc)
    sales_order_vbelns = await load_sales_order_vbelns(db[SALES_ORDERS_COLLECTION])
    summary: dict[str, Any] = {
        "run_id": run_id,
        "mode": "apply" if apply else "dry_run",
        "bom_collection": BOM_COLLECTION,
        "sales_orders_collection": SALES_ORDERS_COLLECTION,
        "sales_order_vbeln_count": len(sales_order_vbelns),
        "scanned_records": 0,
        "kept_records": 0,
        "kept_missing_aufnr_records": 0,
        "missing_vbeln_records": 0,
        "unmatched_vbeln_records": 0,
        "delete_operations_planned": 0,
        "matched_deletes": 0,
        "deleted_records": 0,
        "samples": [],
        "started_at": started_at.isoformat(),
    }
    delete_operations: list[DeleteOne] = []

    async def flush_deletes() -> None:
        if not delete_operations:
            return
        result = await bom.bulk_write(delete_operations, ordered=False)
        summary["matched_deletes"] += result.deleted_count
        summary["deleted_records"] += result.deleted_count
        delete_operations.clear()

    cursor = bom.find({}, {"_id": 1, "AUFNR_1": 1, "VBELN_EX": 1}).batch_size(batch_size)
    async for document in cursor:
        summary["scanned_records"] += 1
        raw_aufnr = document.get("AUFNR_1")
        aufnr = normalize_aufnr(raw_aufnr)
        if not aufnr:
            summary["kept_records"] += 1
            summary["kept_missing_aufnr_records"] += 1
            continue

        raw_vbeln = document.get("VBELN_EX")
        vbeln = normalize_vbeln(raw_vbeln)
        if vbeln and vbeln in sales_order_vbelns:
            summary["kept_records"] += 1
            continue

        if vbeln:
            summary["unmatched_vbeln_records"] += 1
            reason = "sales_order_not_in_dashboard"
        else:
            summary["missing_vbeln_records"] += 1
            reason = "missing_or_invalid_sales_order"

        summary["delete_operations_planned"] += 1
        if len(summary["samples"]) < sample_size:
            summary["samples"].append(
                {
                    "id": str(document["_id"]),
                    "AUFNR_1": raw_aufnr,
                    "normalized_aufnr": aufnr or None,
                    "VBELN_EX": raw_vbeln,
                    "normalized_vbeln": vbeln or None,
                    "reason": reason,
                }
            )
        if apply:
            # Include the inspected value to avoid deleting a concurrently corrected row.
            delete_operations.append(
                DeleteOne({"_id": document["_id"], "AUFNR_1": raw_aufnr, "VBELN_EX": raw_vbeln})
            )
            if len(delete_operations) >= batch_size:
                await flush_deletes()

    if apply:
        await flush_deletes()
        summary["completed_at"] = datetime.now(timezone.utc).isoformat()
        await db[AUDIT_COLLECTION].insert_one(summary)
    return summary


async def main() -> None:
    args = parse_args()
    await connect_to_mongo()
    try:
        summary = await run(
            apply=args.apply,
            batch_size=args.batch_size,
            sample_size=args.sample_size,
        )
        print(json.dumps(summary, ensure_ascii=False, default=str, sort_keys=True))
    finally:
        await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(main())
