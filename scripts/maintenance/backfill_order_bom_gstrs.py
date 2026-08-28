#!/usr/bin/env python3
"""Backfill BOM GSTRS from the sales-order dashboard.

Run from the repository root:

    uv run --project backend python scripts/maintenance/backfill_order_bom_gstrs.py
    uv run --project backend python scripts/maintenance/backfill_order_bom_gstrs.py --apply

The default is a read-only dry run. ``--apply`` updates ``GSTRS`` only when a
unique match is found, preferring ``AUFNR_1`` and falling back to ``VBELN_EX``.
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

from pymongo import UpdateOne

BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.db.mongodb import close_mongo_connection, connect_to_mongo, get_database  # noqa: E402
from app.services.order_bom_gstrs import (  # noqa: E402
    OrderBomGstrsLookup,
    build_order_bom_gstrs_lookup,
)

BOM_COLLECTION = "order_bom_postings_sap"
SALES_ORDERS_COLLECTION = "sales_orders_sap"
AUDIT_COLLECTION = "order_bom_gstrs_backfill_runs"


async def load_lookup(collection: Any) -> OrderBomGstrsLookup:
    documents: list[dict[str, Any]] = []
    cursor = collection.find({}, {"aufnr": 1, "data.VBELN": 1, "data.GSTRS": 1})
    async for document in cursor:
        documents.append(document)
    return build_order_bom_gstrs_lookup(documents)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="从销售订单看板回填订单 BOM 的 GSTRS")
    parser.add_argument("--apply", action="store_true", help="执行写入；省略时只统计")
    parser.add_argument("--batch-size", type=int, default=1_000, help="写入批次大小，默认 1000")
    parser.add_argument("--sample-size", type=int, default=20, help="输出待更新样本数量，默认 20")
    return parser.parse_args()


async def run(*, apply: bool, batch_size: int, sample_size: int) -> dict[str, Any]:
    """Backfill all BOM rows and return an auditable summary."""
    if batch_size < 1:
        raise ValueError("--batch-size 必须大于 0")
    if sample_size < 0:
        raise ValueError("--sample-size 不能小于 0")

    db = get_database()
    bom = db[BOM_COLLECTION]
    lookup = await load_lookup(db[SALES_ORDERS_COLLECTION])
    summary: dict[str, Any] = {
        "run_id": uuid.uuid4().hex,
        "mode": "apply" if apply else "dry_run",
        "bom_collection": BOM_COLLECTION,
        "sales_orders_collection": SALES_ORDERS_COLLECTION,
        "sales_order_aufnr_count": len(lookup.by_aufnr),
        "sales_order_vbeln_count": len(lookup.by_vbeln),
        "scanned_records": 0,
        "already_current_records": 0,
        "updates_planned": 0,
        "matched_updates": 0,
        "modified_records": 0,
        "unmatched_records": 0,
        "ambiguous_records": 0,
        "matched_by_aufnr": 0,
        "matched_by_vbeln": 0,
        "samples": [],
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    operations: list[UpdateOne] = []

    async def flush_updates() -> None:
        if not operations:
            return
        result = await bom.bulk_write(operations, ordered=False)
        summary["matched_updates"] += result.matched_count
        summary["modified_records"] += result.modified_count
        operations.clear()

    cursor = bom.find({}, {"_id": 1, "AUFNR_1": 1, "VBELN_EX": 1, "GSTRS": 1}).batch_size(
        batch_size
    )
    async for document in cursor:
        summary["scanned_records"] += 1
        match = lookup.resolve(document.get("AUFNR_1"), document.get("VBELN_EX"))
        if match.value is None:
            summary["ambiguous_records" if match.ambiguous else "unmatched_records"] += 1
            continue
        summary["matched_by_aufnr" if match.source == "AUFNR_1" else "matched_by_vbeln"] += 1
        if document.get("GSTRS") == match.value:
            summary["already_current_records"] += 1
            continue

        summary["updates_planned"] += 1
        if len(summary["samples"]) < sample_size:
            summary["samples"].append(
                {
                    "id": str(document["_id"]),
                    "AUFNR_1": document.get("AUFNR_1"),
                    "VBELN_EX": document.get("VBELN_EX"),
                    "GSTRS": match.value,
                    "match_source": match.source,
                }
            )
        if apply:
            operations.append(
                UpdateOne(
                    {
                        "_id": document["_id"],
                        "AUFNR_1": document.get("AUFNR_1"),
                        "VBELN_EX": document.get("VBELN_EX"),
                    },
                    {"$set": {"GSTRS": match.value}},
                )
            )
            if len(operations) >= batch_size:
                await flush_updates()

    if apply:
        await flush_updates()
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
