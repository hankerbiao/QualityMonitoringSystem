#!/usr/bin/env python3
"""Fill repair-record customers from the SAP sales-order master.

Run from the repository root:

    uv run --project backend python scripts/maintenance/backfill_repair_customers.py
    uv run --project backend python scripts/maintenance/backfill_repair_customers.py --apply

The join key is production order: ``repair_records_sap.AUFNR`` to
``sales_orders_sap.aufnr``. Numeric values are normalized by removing leading
zeros, so SAP's 12-digit AUFNR and the sales master format join consistently.
Only an empty ``customer`` field is filled.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import UpdateOne

BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.db.mongodb import close_mongo_connection, connect_to_mongo, get_database  # noqa: E402

REPAIR_COLLECTION = "repair_records_sap"
SALES_COLLECTION = "sales_orders_sap"
AUDIT_COLLECTION = "repair_customer_backfill_runs"
EMPTY_VALUES = (None, "", "0")


def normalize_production_order(value: Any) -> str:
    """Return the canonical numeric AUFNR key used across SAP collections."""
    value = str(value or "").strip()
    if not value:
        return ""
    return value.lstrip("0") or "0" if value.isdigit() else value


def clean_customer(value: Any) -> str:
    return str(value or "").strip()


async def load_customers_by_order(db: Any) -> tuple[dict[str, str], dict[str, list[str]]]:
    """Resolve only unambiguous customer names for each canonical production order."""
    values: dict[str, set[str]] = defaultdict(set)
    cursor = db[SALES_COLLECTION].find({}, {"aufnr": 1, "data.NAME1_ZU": 1})
    async for document in cursor:
        order = normalize_production_order(document.get("aufnr"))
        customer = clean_customer((document.get("data") or {}).get("NAME1_ZU"))
        if order and customer:
            values[order].add(customer)

    resolved = {order: next(iter(customers)) for order, customers in values.items() if len(customers) == 1}
    conflicts = {order: sorted(customers) for order, customers in values.items() if len(customers) > 1}
    return resolved, conflicts


async def run(apply: bool, batch_size: int) -> dict[str, Any]:
    if batch_size < 1:
        raise ValueError("--batch-size 必须大于 0")

    db = get_database()
    started_at = datetime.now(timezone.utc)
    run_id = uuid.uuid4().hex
    repairs = await db[REPAIR_COLLECTION].find(
        {"$or": [{"customer": {"$exists": False}}, {"customer": {"$in": list(EMPTY_VALUES)}}]},
        {"_id": 1, "AUFNR": 1},
    ).to_list(None)
    customers, conflicts = await load_customers_by_order(db)

    summary: dict[str, Any] = {
        "run_id": run_id,
        "mode": "apply" if apply else "dry_run",
        "candidate_records": len(repairs),
        "sales_orders_with_customer": len(customers),
        "conflicting_sales_order_customers": len(conflicts),
        "matched_records": 0,
        "unmatched_records": 0,
        "updates_planned": 0,
        "matched_updates": 0,
        "modified_updates": 0,
        "started_at": started_at.isoformat(),
    }
    operations: list[UpdateOne] = []
    for repair in repairs:
        order = normalize_production_order(repair.get("AUFNR"))
        customer = customers.get(order, "")
        if not customer:
            summary["unmatched_records"] += 1
            continue
        summary["matched_records"] += 1
        summary["updates_planned"] += 1
        operations.append(
            UpdateOne(
                {"_id": repair["_id"], "$or": [{"customer": {"$exists": False}}, {"customer": {"$in": list(EMPTY_VALUES)}}]},
                {"$set": {
                    "customer": customer,
                    "customer_backfill.run_id": run_id,
                    "customer_backfill.source": "sales_orders_sap.data.NAME1_ZU",
                    "customer_backfill.production_order_key": order,
                    "customer_backfill.updated_at": started_at,
                }},
            )
        )

    if apply:
        for offset in range(0, len(operations), batch_size):
            result = await db[REPAIR_COLLECTION].bulk_write(operations[offset : offset + batch_size], ordered=False)
            summary["matched_updates"] += result.matched_count
            summary["modified_updates"] += result.modified_count
        summary["completed_at"] = datetime.now(timezone.utc).isoformat()
        await db[AUDIT_COLLECTION].insert_one(summary)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="按生产订单回填 SAP 维修记录客户")
    parser.add_argument("--apply", action="store_true", help="写入数据库；省略时只输出统计结果")
    parser.add_argument("--batch-size", type=int, default=1_000, help="批量写入大小，默认 1000")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    await connect_to_mongo()
    try:
        print(json.dumps(await run(args.apply, args.batch_size), ensure_ascii=False, default=str, sort_keys=True))
    finally:
        await close_mongo_connection()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
