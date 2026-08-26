#!/usr/bin/env python3
"""Backfill production and sales orders for SAP repair records.

Run from the repository root:

    uv run --project backend python scripts/maintenance/backfill_repair_orders.py
    uv run --project backend python scripts/maintenance/backfill_repair_orders.py --apply

The script uses ``PCODE`` as the machine SN. It only fills blank ``AUFNR``
and ``VBELN`` fields and records the source and any competing candidates in
``order_backfill``. Existing order values are never overwritten.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import uuid
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import UpdateOne

BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.db.mongodb import close_mongo_connection, connect_to_mongo, get_database  # noqa: E402

REPAIR_COLLECTION = "repair_records_sap"
AUDIT_COLLECTION = "repair_order_backfill_runs"
EMPTY_VALUES = [None, "", "0"]


@dataclass(frozen=True)
class Resolution:
    """A resolved order value with all usable source candidates."""

    value: str = ""
    source: str = ""
    conflicting_values: tuple[str, ...] = ()


def clean_value(value: Any) -> str:
    """Return a stripped identifier, treating blank and all-zero values as empty."""
    text = str(value or "").strip()
    if not text or (text.isdigit() and not text.lstrip("0")):
        return ""
    return text


def normalize_production_order(value: Any) -> str:
    """Use a 12-digit SAP AUFNR when the source value is numeric."""
    text = clean_value(value)
    if not text:
        return ""
    return text.zfill(12) if text.isdigit() else text


def normalize_sales_order(value: Any) -> str:
    """Canonicalize order IDs and remove fault-order item suffixes like ``--10``."""
    text = clean_value(value)
    text = re.sub(r"--\d+$", "", text)
    if text.isdigit():
        return text.lstrip("0") or "0"
    return text


def resolve_candidate(
    source_values: list[tuple[str, set[str]]],
) -> Resolution:
    """Pick the first unambiguous source and retain cross-source conflicts."""
    selected_source = ""
    selected_value = ""
    all_values: set[str] = set()

    for source, values in source_values:
        usable = {value for value in values if value}
        all_values.update(usable)
        if not selected_value and len(usable) == 1:
            selected_source = source
            selected_value = next(iter(usable))

    conflicts = tuple(sorted(all_values - {selected_value})) if selected_value else ()
    return Resolution(selected_value, selected_source, conflicts)


def empty_field_filter(field: str) -> dict[str, list[dict[str, Any]]]:
    """Match a missing, null, or empty-string field without treating zero as blank."""
    return {
        "$or": [
            {field: {"$exists": False}},
            {field: None},
            {field: ""},
            {field: "0"},
        ]
    }


async def load_sn_candidates(
    collection: Any,
    sn_field: str,
    value_field: str,
    serial_numbers: list[str],
    normalize: Callable[[Any], str],
) -> dict[str, set[str]]:
    """Load de-duplicated values for each SN from a source collection."""
    pipeline = [
        {"$match": {sn_field: {"$in": serial_numbers}}},
        {"$group": {"_id": f"${sn_field}", "values": {"$addToSet": f"${value_field}"}}},
    ]
    rows = await collection.aggregate(pipeline, allowDiskUse=True).to_list(None)
    return {
        row["_id"]: {normalized for value in row["values"] if (normalized := normalize(value))}
        for row in rows
        if clean_value(row.get("_id"))
    }


async def load_order_to_sales(
    collection: Any,
    order_field: str,
    sales_field: str,
    production_orders: set[str],
) -> dict[str, set[str]]:
    """Load unmodified SAP sales IDs grouped by normalized production order."""
    if not production_orders:
        return {}

    pipeline = [
        {"$match": {order_field: {"$in": list(production_orders)}}},
        {"$group": {"_id": f"${order_field}", "values": {"$addToSet": f"${sales_field}"}}},
    ]
    rows = await collection.aggregate(pipeline, allowDiskUse=True).to_list(None)
    grouped: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        order = normalize_production_order(row.get("_id"))
        if not order:
            continue
        grouped[order].update(
            sales for value in row["values"] if (sales := normalize_sales_order(value))
        )
    return dict(grouped)


async def load_sales_master(collection: Any) -> dict[str, set[str]]:
    """Map each normalized sales-order master AUFNR to its VBELN values."""
    grouped: dict[str, set[str]] = defaultdict(set)
    cursor = collection.find({}, {"aufnr": 1, "data.VBELN": 1})
    async for document in cursor:
        order = normalize_production_order(document.get("aufnr"))
        sales = normalize_sales_order((document.get("data") or {}).get("VBELN"))
        if order and sales:
            grouped[order].add(sales)
    return dict(grouped)


async def build_mappings(db: Any, serial_numbers: list[str]) -> tuple[
    dict[str, dict[str, set[str]]],
    dict[str, set[str]],
    dict[str, set[str]],
]:
    """Build all SN-to-order candidates and production-order-to-sales mappings."""
    repair = db[REPAIR_COLLECTION]
    station = db["station_records_sap"]
    serial = db["serial_bindings_sap"]
    fault = db["fault_info"]

    (
        existing_aufnr,
        existing_vbeln,
        station_aufnr,
        station_vbeln,
        serial_aufnr,
        fault_aufnr,
        fault_vbeln,
    ) = (
        await asyncio.gather(
            load_sn_candidates(repair, "PCODE", "AUFNR", serial_numbers, normalize_production_order),
            load_sn_candidates(repair, "PCODE", "VBELN", serial_numbers, normalize_sales_order),
            load_sn_candidates(station, "PCODE", "AUFNR", serial_numbers, normalize_production_order),
            load_sn_candidates(station, "PCODE", "KDAUF", serial_numbers, normalize_sales_order),
            load_sn_candidates(serial, "ZCODE_HEAD", "AUFNR_HEAD", serial_numbers, normalize_production_order),
            load_sn_candidates(fault, "sn", "mfg_order", serial_numbers, normalize_production_order),
            load_sn_candidates(fault, "sn", "sale_no", serial_numbers, normalize_sales_order),
        )
    )

    production_orders = set().union(
        *(
            values
            for source in (existing_aufnr, station_aufnr, serial_aufnr, fault_aufnr)
            for values in source.values()
        )
    )
    sales_master, bom_sales = await asyncio.gather(
        load_sales_master(db["sales_orders_sap"]),
        load_order_to_sales(
            db["order_bom_postings_sap"], "AUFNR_1", "VBELN_EX", production_orders
        ),
    )

    return (
        {
            "existing_aufnr": existing_aufnr,
            "existing_vbeln": existing_vbeln,
            "station_aufnr": station_aufnr,
            "station_vbeln": station_vbeln,
            "serial_binding_aufnr": serial_aufnr,
            "fault_aufnr": fault_aufnr,
            "fault_vbeln": fault_vbeln,
        },
        sales_master,
        bom_sales,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="按 PCODE 回填 SAP 维修记录中的订单号")
    parser.add_argument(
        "--apply", action="store_true", help="写入数据库；省略时只输出统计结果"
    )
    parser.add_argument("--batch-size", type=int, default=1_000, help="批量写入大小，默认 1000")
    return parser.parse_args()


async def run(apply: bool, batch_size: int) -> dict[str, Any]:
    if batch_size < 1:
        raise ValueError("--batch-size 必须大于 0")

    db = get_database()
    repair = db[REPAIR_COLLECTION]
    run_id = uuid.uuid4().hex
    started_at = datetime.now(timezone.utc)
    repair_rows = await repair.find({}, {"_id": 1, "PCODE": 1, "AUFNR": 1, "VBELN": 1}).to_list(None)
    serial_numbers = sorted({clean_value(row.get("PCODE")) for row in repair_rows if clean_value(row.get("PCODE"))})
    source_maps, sales_master, bom_sales = await build_mappings(db, serial_numbers)

    summary: dict[str, Any] = {
        "run_id": run_id,
        "mode": "apply" if apply else "dry_run",
        "repair_rows": len(repair_rows),
        "unique_sn": len(serial_numbers),
        "mapped_sn": 0,
        "mapped_records": 0,
        "aufnr_candidates": 0,
        "vbeln_candidates": 0,
        "aufnr_updates_planned": 0,
        "vbeln_updates_planned": 0,
        "records_updates_planned": 0,
        "conflicting_aufnr_candidates": 0,
        "conflicting_vbeln_candidates": 0,
        "matched_updates": 0,
        "modified_updates": 0,
        "started_at": started_at.isoformat(),
    }
    operations: list[UpdateOne] = []
    mapped_serials: set[str] = set()

    for row in repair_rows:
        serial_number = clean_value(row.get("PCODE"))
        if not serial_number:
            continue

        aufnr = resolve_candidate(
            [
                ("existing_repair", source_maps["existing_aufnr"].get(serial_number, set())),
                ("station_record", source_maps["station_aufnr"].get(serial_number, set())),
                ("serial_binding", source_maps["serial_binding_aufnr"].get(serial_number, set())),
                ("fault_record", source_maps["fault_aufnr"].get(serial_number, set())),
            ]
        )
        vbeln = resolve_candidate(
            [
                ("existing_repair", source_maps["existing_vbeln"].get(serial_number, set())),
                ("station_record", source_maps["station_vbeln"].get(serial_number, set())),
                ("sales_orders_sap", sales_master.get(aufnr.value, set())),
                ("order_bom_postings_sap", bom_sales.get(aufnr.value, set())),
                ("fault_record", source_maps["fault_vbeln"].get(serial_number, set())),
            ]
        )

        if aufnr.value:
            summary["aufnr_candidates"] += 1
        if vbeln.value:
            summary["vbeln_candidates"] += 1
        if aufnr.value or vbeln.value:
            mapped_serials.add(serial_number)
            summary["mapped_records"] += 1
        if aufnr.conflicting_values:
            summary["conflicting_aufnr_candidates"] += 1
        if vbeln.conflicting_values:
            summary["conflicting_vbeln_candidates"] += 1

        updates: dict[str, Any] = {}
        conditions: list[dict[str, list[dict[str, Any]]]] = []
        if row.get("AUFNR") in EMPTY_VALUES and aufnr.value:
            updates["AUFNR"] = aufnr.value
            updates["order_backfill.aufnr_source"] = aufnr.source
            updates["order_backfill.aufnr_conflicting_values"] = list(aufnr.conflicting_values)
            summary["aufnr_updates_planned"] += 1
            conditions.append(empty_field_filter("AUFNR"))
        if row.get("VBELN") in EMPTY_VALUES and vbeln.value:
            updates["VBELN"] = vbeln.value
            updates["order_backfill.vbeln_source"] = vbeln.source
            updates["order_backfill.vbeln_conflicting_values"] = list(vbeln.conflicting_values)
            summary["vbeln_updates_planned"] += 1
            conditions.append(empty_field_filter("VBELN"))
        if not updates:
            continue

        summary["records_updates_planned"] += 1
        updates["order_backfill.run_id"] = run_id
        updates["order_backfill.updated_at"] = started_at
        operations.append(UpdateOne({"_id": row["_id"], "$and": conditions}, {"$set": updates}))

    summary["mapped_sn"] = len(mapped_serials)
    if apply:
        for offset in range(0, len(operations), batch_size):
            result = await repair.bulk_write(operations[offset : offset + batch_size], ordered=False)
            summary["matched_updates"] += result.matched_count
            summary["modified_updates"] += result.modified_count

        summary["completed_at"] = datetime.now(timezone.utc).isoformat()
        await db[AUDIT_COLLECTION].insert_one(summary)
    return summary


async def main() -> None:
    args = parse_args()
    await connect_to_mongo()
    try:
        summary = await run(args.apply, args.batch_size)
        print(json.dumps(summary, ensure_ascii=False, default=str, sort_keys=True))
    finally:
        await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(main())
