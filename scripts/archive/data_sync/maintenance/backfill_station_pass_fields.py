#!/usr/bin/env python3
"""Backfill normalized fields used by the station pass-rate aggregation.

The default is a dry run; pass ``--apply`` to write documents. Progress is
saved after every batch, so an interrupted write can continue safely.
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

BACKEND_DIR = Path(__file__).resolve().parents[4] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.db.mongodb import close_mongo_connection, connect_to_mongo, get_database  # noqa: E402
from app.services.station_pass_fields import (  # noqa: E402
    repair_station_pass_fields,
    station_pass_fields,
)

CHECKPOINTS = "station_pass_field_backfill_checkpoints"
RUNS = "station_pass_field_backfill_runs"
SPECS = (
    (
        "station_records_sap",
        station_pass_fields,
        ("ACTUAL_START_TIME", "GSTRS", "SPEC", "SPEC_DESC"),
    ),
    ("repair_records_sap", repair_station_pass_fields, ("ZNGGZ", "ZNGSPEC")),
)


async def _backfill_collection(
    db: Any,
    collection_name: str,
    normalizer: Any,
    source_fields: tuple[str, ...],
    *,
    apply: bool,
    batch_size: int,
    resume: bool,
) -> dict[str, Any]:
    checkpoint_id = f"{collection_name}:v1"
    checkpoint = await db[CHECKPOINTS].find_one({"_id": checkpoint_id}) if resume else None
    query: dict[str, Any] = {}
    if checkpoint and checkpoint.get("last_id") is not None:
        query["_id"] = {"$gt": checkpoint["last_id"]}

    target_fields = (
        ("station_pass_date", "station_code_norm", "station_name_norm")
        if collection_name == "station_records_sap"
        else ("repair_station_code_norm",)
    )
    projection = {"_id": 1, **dict.fromkeys(source_fields + target_fields, 1)}
    summary = {
        "collection": collection_name,
        "total": 0,
        "updated": 0,
        "unchanged": 0,
        "unparseable": 0,
    }
    collection = db[collection_name]
    while True:
        rows = (
            await collection.find(query, projection).sort("_id", 1).limit(batch_size).to_list(None)
        )
        if not rows:
            break
        operations: list[UpdateOne] = []
        for row in rows:
            fields = normalizer(row)
            summary["total"] += 1
            required_fields = (
                target_fields[:2] if collection_name == "station_records_sap" else target_fields
            )
            if any(not fields[field] for field in required_fields):
                summary["unparseable"] += 1
            if any(row.get(field) != value for field, value in fields.items()):
                summary["updated"] += 1
                operations.append(UpdateOne({"_id": row["_id"]}, {"$set": fields}))
            else:
                summary["unchanged"] += 1
        if apply and operations:
            await collection.bulk_write(operations, ordered=False)
        last_id = rows[-1]["_id"]
        query = {"_id": {"$gt": last_id}}
        if apply:
            await db[CHECKPOINTS].update_one(
                {"_id": checkpoint_id},
                {"$set": {"last_id": last_id, "updated_at": datetime.now(timezone.utc)}},
                upsert=True,
            )
    if apply:
        await db[CHECKPOINTS].delete_one({"_id": checkpoint_id})
    return summary


async def run(*, apply: bool, batch_size: int, resume: bool) -> dict[str, Any]:
    if batch_size < 1:
        raise ValueError("--batch-size must be positive")
    db = get_database()
    summary: dict[str, Any] = {
        "run_id": uuid.uuid4().hex,
        "mode": "apply" if apply else "dry_run",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "collections": [],
    }
    for collection_name, normalizer, source_fields in SPECS:
        summary["collections"].append(
            await _backfill_collection(
                db,
                collection_name,
                normalizer,
                source_fields,
                apply=apply,
                batch_size=batch_size,
                resume=resume,
            )
        )
    summary["completed_at"] = datetime.now(timezone.utc).isoformat()
    if apply:
        await db[RUNS].insert_one(summary)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write normalized fields")
    parser.add_argument("--batch-size", type=int, default=1_000)
    parser.add_argument("--no-resume", action="store_true", help="ignore saved progress")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    await connect_to_mongo()
    try:
        print(
            json.dumps(
                await run(apply=args.apply, batch_size=args.batch_size, resume=not args.no_resume),
                ensure_ascii=False,
                default=str,
                sort_keys=True,
            )
        )
    finally:
        await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(main())
