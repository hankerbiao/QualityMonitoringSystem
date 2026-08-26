"""RTY sales-order and repair-record synchronization orchestration.

The service intentionally keeps source checkpoints independent.  SAP sales
orders are fetched per source and merged idempotently by ``AUFNR``; repair
records are enriched only when their target fields are empty.
"""
from __future__ import annotations

import asyncio
import re
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from pymongo import UpdateOne

from app.db.mongodb import get_database
from app.models.documents import Collections
from app.repositories import sales_order_repository as sales_repo
from app.services.rty_sync_types import RepairBackfillPlan, SalesSyncResult
from app.services.sap_sales_order_service import SapSalesOrderService, SourceFetchResult
from app.services.sap_sn_info_service import SapSnInfoService

CHECKPOINTS = "rty_sync_checkpoints"
RUNS = "rty_sync_runs"
REPAIR = Collections.REPAIR_RECORDS_SAP
EMPTY_VALUES = (None, "", "0")
SOURCES = ("SG", "KK")


def clean_value(value: Any) -> str:
    text = str(value or "").strip()
    if not text or (text.isdigit() and not text.lstrip("0")):
        return ""
    return text


def normalize_production_order(value: Any) -> str:
    text = clean_value(value)
    return text.zfill(12) if text.isdigit() else text


def normalize_sales_order(value: Any) -> str:
    text = re.sub(r"--\d+$", "", clean_value(value))
    return text.lstrip("0") or "0" if text.isdigit() else text


def is_empty(value: Any) -> bool:
    return value in EMPTY_VALUES


@dataclass(frozen=True)
class Candidate:
    value: str = ""
    source: str = ""
    conflicts: tuple[str, ...] = ()


def resolve_candidate(source_values: list[tuple[str, set[str]]]) -> Candidate:
    """Select the first unambiguous source and retain competing values."""
    selected = ""
    selected_source = ""
    all_values: set[str] = set()
    for source, values in source_values:
        usable = {v for v in values if v}
        all_values.update(usable)
        if not selected and len(usable) == 1:
            selected = next(iter(usable))
            selected_source = source
    return Candidate(selected, selected_source, tuple(sorted(all_values - {selected})))


def _field_empty(field: str) -> dict[str, Any]:
    return {"$or": [{field: {"$exists": False}}, {field: None}, {field: ""}, {field: "0"}]}


async def _sn_values(collection: Any, sn_field: str, value_field: str, sns: set[str], normalizer) -> dict[str, set[str]]:
    if not sns:
        return {}
    values: dict[str, set[str]] = defaultdict(set)
    cursor = collection.find({sn_field: {"$in": list(sns)}}, {sn_field: 1, value_field: 1})
    async for doc in cursor:
        sn = clean_value(doc.get(sn_field))
        value = normalizer(doc.get(value_field))
        if sn and value:
            values[sn].add(value)
    return dict(values)


async def _order_sales(collection: Any, orders: set[str], order_field: str, sales_field: str) -> dict[str, set[str]]:
    result: dict[str, set[str]] = defaultdict(set)
    if not orders:
        return result
    cursor = collection.find({order_field: {"$in": list(orders)}}, {order_field: 1, sales_field: 1})
    async for doc in cursor:
        order = normalize_production_order(doc.get(order_field))
        sales = normalize_sales_order(doc.get(sales_field))
        if order and sales:
            result[order].add(sales)
    return result


async def _sales_master(db: Any, orders: set[str] | None = None) -> dict[str, set[str]]:
    result: dict[str, set[str]] = defaultdict(set)
    cursor = db[Collections.SALES_ORDERS_SAP].find({}, {"aufnr": 1, "data.VBELN": 1, "data.NAME1_ZU": 1})
    async for doc in cursor:
        order = normalize_production_order(doc.get("aufnr"))
        if orders and order not in orders:
            continue
        sales = normalize_sales_order((doc.get("data") or {}).get("VBELN"))
        if order and sales:
            result[order].add(sales)
    return result


async def _customer_master(db: Any, orders: set[str]) -> tuple[dict[str, str], dict[str, list[str]]]:
    values: dict[str, set[str]] = defaultdict(set)
    cursor = db[Collections.SALES_ORDERS_SAP].find({}, {"aufnr": 1, "data.NAME1_ZU": 1})
    async for doc in cursor:
        order = normalize_production_order(doc.get("aufnr"))
        customer = str((doc.get("data") or {}).get("NAME1_ZU") or "").strip()
        if order in orders and customer:
            values[order].add(customer)
    return (
        {key: next(iter(vals)) for key, vals in values.items() if len(vals) == 1},
        {key: sorted(vals) for key, vals in values.items() if len(vals) > 1},
    )


async def _local_maps(db: Any, sns: set[str]) -> tuple[dict[str, dict[str, set[str]]], dict[str, set[str]], dict[str, set[str]]]:
    repair, station = db[REPAIR], db[Collections.STATION_RECORDS_SAP]
    serial, fault = db[Collections.SERIAL_BINDINGS_SAP], db["fault_info"]
    existing_aufnr, existing_vbeln, station_aufnr, station_vbeln, binding_aufnr, fault_aufnr, fault_vbeln = await asyncio.gather(
        _sn_values(repair, "PCODE", "AUFNR", sns, normalize_production_order),
        _sn_values(repair, "PCODE", "VBELN", sns, normalize_sales_order),
        _sn_values(station, "PCODE", "AUFNR", sns, normalize_production_order),
        _sn_values(station, "PCODE", "KDAUF", sns, normalize_sales_order),
        _sn_values(serial, "ZCODE_HEAD", "AUFNR_HEAD", sns, normalize_production_order),
        _sn_values(fault, "sn", "mfg_order", sns, normalize_production_order),
        _sn_values(fault, "sn", "sale_no", sns, normalize_sales_order),
    )
    maps = {
        "existing_aufnr": existing_aufnr,
        "existing_vbeln": existing_vbeln,
        "station_aufnr": station_aufnr,
        "station_vbeln": station_vbeln,
        "serial_binding_aufnr": binding_aufnr,
        "fault_aufnr": fault_aufnr,
        "fault_vbeln": fault_vbeln,
    }
    orders: set[str] = set()
    for key in ("existing_aufnr", "station_aufnr", "serial_binding_aufnr", "fault_aufnr"):
        for values in maps[key].values():
            orders.update(values)
    sales_master, bom_sales = await asyncio.gather(
        _sales_master(db, orders),
        _order_sales(db[Collections.ORDER_BOM_POSTINGS_SAP], orders, "AUFNR_1", "VBELN_EX"),
    )
    return maps, dict(sales_master), dict(bom_sales)


def _merge_sn_items(results: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    merged: dict[str, dict[str, Any]] = {}
    errors: dict[str, str] = {}
    for source, result in results.items():
        if not result.success:
            errors[source] = result.error or "SAP source failed"
            continue
        for raw in result.records:
            sn = clean_value(raw.get("PCODE"))
            if not sn:
                continue
            item = merged.setdefault(sn, {"PCODE": sn, "sources": []})
            for key in ("AUFNR", "VBELN", "MATNR", "MAKTX", "CDATE_S", "CDATE_E", "CDATE_I", "CDATE_O"):
                value = clean_value(raw.get(key))
                if value:
                    if not item.get(key):
                        item[key] = value
                    elif item[key] != value:
                        item.setdefault("conflicts", {}).setdefault(key, set()).update({item[key], value})
            if source not in item["sources"]:
                item["sources"].append(source)
    return merged, errors


class RtySyncService:
    """Coordinates RTY synchronization; dependencies are injectable for tests."""

    def __init__(self, db: Any | None = None, sales_service: SapSalesOrderService | None = None, sn_service: SapSnInfoService | None = None) -> None:
        self.db = db or get_database()
        self.sales_service = sales_service or SapSalesOrderService()
        self.sn_service = sn_service or SapSnInfoService()

    async def _checkpoint(self, source: str) -> date | None:
        doc = await self.db[CHECKPOINTS].find_one({"_id": f"sales_orders:{source}"})
        value = doc.get("last_success_date") if doc else None
        try:
            return date.fromisoformat(value) if value else None
        except (TypeError, ValueError):
            return None

    async def _save_checkpoint(self, source: str, value: date, run_id: str, dry_run: bool) -> None:
        if dry_run:
            return
        await self.db[CHECKPOINTS].update_one(
            {"_id": f"sales_orders:{source}"},
            {"$set": {"source": "sales_orders", "source_name": source, "last_success_date": value.isoformat(), "updated_at": datetime.now(timezone.utc), "run_id": run_id}},
            upsert=True,
        )

    async def sync_sales_range(self, start_date: date, end_date: date, prodh_list: list[str] | None = None) -> dict[str, Any]:
        """Shared non-checkpointed range sync used by the HTTP sales-order API."""
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        results = await self.sales_service.fetch_all(start_date, end_date, prodh_list)
        successful = [result for result in results.values() if result.success]
        if not successful:
            return {"success": False, "results": results, "per_source": {}, "inserted": 0, "updated": 0}
        aufnr_sources, source_records, per_source = sales_repo.aggregate_source_results(results, now_iso)
        inserted, updated = await sales_repo.upsert_sales_orders(
            aufnr_sources, source_records, now_iso, db=self.db
        )
        summary = SalesSyncResult(
            successful_sources=len(successful),
            total_sources=len(results),
            inserted=inserted,
            updated=updated,
            orders=len(aufnr_sources),
            details={"results": results, "per_source": per_source, "aufnr_sources": aufnr_sources},
        )
        return {
            "success": summary.success,
            "partial_success": bool(summary.successful_sources) and not summary.success,
            **summary.details,
            "inserted": summary.inserted,
            "updated": summary.updated,
        }

    async def sales(self, *, start_date: date | None, end_date: date, prodh_list: list[str], lookback_days: int, bootstrap: bool, dry_run: bool, run_id: str) -> dict[str, Any]:
        if lookback_days < 0:
            raise ValueError("lookback_days must be non-negative")
        ranges: dict[str, date] = {}
        missing: list[str] = []
        for source in SOURCES:
            if bootstrap:
                if start_date is None:
                    raise ValueError("bootstrap requires start_date")
                ranges[source] = start_date
            else:
                checkpoint = await self._checkpoint(source)
                if checkpoint is None:
                    missing.append(source)
                else:
                    ranges[source] = checkpoint - timedelta(days=lookback_days)
        if missing:
            return {"success": False, "error": f"Missing checkpoints for: {', '.join(missing)}", "sources": {}}

        fetched: dict[str, SourceFetchResult] = {}
        fetched_values = await asyncio.gather(*(self.sales_service.fetch_source(source, ranges[source], end_date, prodh_list) for source in SOURCES), return_exceptions=True)
        for source, value in zip(SOURCES, fetched_values, strict=True):
            fetched[source] = value if isinstance(value, SourceFetchResult) else SourceFetchResult(source=source, success=False, error=str(value))
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        successful = {key: value for key, value in fetched.items() if value.success}
        aufnr_sources, source_records, per_source = sales_repo.aggregate_source_results(fetched, now_iso)
        inserted = updated = 0
        if successful and not dry_run:
            inserted, updated = await sales_repo.upsert_sales_orders(aufnr_sources, source_records, now_iso, db=self.db)
        checkpoint_allowed = not bootstrap or len(successful) == len(SOURCES)
        for source, result in fetched.items():
            if result.success and checkpoint_allowed:
                await self._save_checkpoint(source, end_date, run_id, dry_run)
        return {
            "success": len(successful) == len(SOURCES),
            "partial_success": bool(successful) and len(successful) < len(SOURCES),
            "ranges": {key: value.isoformat() for key, value in ranges.items()},
            "sources": {key: vars(value) | {"stats": vars(per_source[key])} for key, value in fetched.items()},
            "inserted": inserted,
            "updated": updated,
            "orders": len(aufnr_sources),
        }

    async def repair(self, *, dry_run: bool, run_id: str, batch_size: int = 200) -> dict[str, Any]:
        if batch_size < 1:
            raise ValueError("batch_size must be positive")
        collection = self.db[REPAIR]
        candidate_filter = {"$or": [_field_empty("AUFNR"), _field_empty("VBELN"), _field_empty("customer")]}
        rows = await collection.find(candidate_filter, {"_id": 1, "PCODE": 1, "AUFNR": 1, "VBELN": 1, "customer": 1}).to_list(None)
        sns = {clean_value(row.get("PCODE")) for row in rows if clean_value(row.get("PCODE"))}
        maps, sales_master, bom_sales = await _local_maps(self.db, sns)
        assignments: dict[str, dict[str, Any]] = {}
        unresolved = set()
        for row in rows:
            sn = clean_value(row.get("PCODE"))
            existing_order = normalize_production_order(row.get("AUFNR"))
            aufnr = (
                Candidate(existing_order, "existing_repair")
                if existing_order
                else resolve_candidate([
                    ("repair", maps["existing_aufnr"].get(sn, set())),
                    ("station", maps["station_aufnr"].get(sn, set())),
                    ("serial_binding", maps["serial_binding_aufnr"].get(sn, set())),
                    ("fault", maps["fault_aufnr"].get(sn, set())),
                ])
            )
            order = aufnr.value
            existing_sales = normalize_sales_order(row.get("VBELN"))
            vbeln = (
                Candidate(existing_sales, "existing_repair")
                if existing_sales
                else resolve_candidate([
                    ("repair", maps["existing_vbeln"].get(sn, set())),
                    ("station", maps["station_vbeln"].get(sn, set())),
                    ("sales_orders_sap", sales_master.get(order, set())),
                    ("order_bom", bom_sales.get(order, set())),
                    ("fault", maps["fault_vbeln"].get(sn, set())),
                ])
            )
            if is_empty(row.get("AUFNR")) and not aufnr.value or is_empty(row.get("VBELN")) and not vbeln.value:
                unresolved.add(sn)
            assignments[row["_id"]] = {"aufnr": aufnr, "vbeln": vbeln}

        api_errors: dict[str, str] = {}
        api_items: dict[str, dict[str, Any]] = {}
        for offset in range(0, len(unresolved), batch_size):
            batch = sorted(unresolved)[offset : offset + batch_size]
            results = await self.sn_service.fetch_all(batch)
            items, errors = _merge_sn_items(results)
            api_items.update(items)
            api_errors.update(errors)
        api_orders = {normalize_production_order(item.get("AUFNR")) for item in api_items.values() if item.get("AUFNR")}
        if api_orders:
            extra_sales, extra_bom = await asyncio.gather(_sales_master(self.db, api_orders), _order_sales(self.db[Collections.ORDER_BOM_POSTINGS_SAP], api_orders, "AUFNR_1", "VBELN_EX"))
            for order, values in extra_sales.items():
                sales_master.setdefault(order, set()).update(values)
            for order, values in extra_bom.items():
                bom_sales.setdefault(order, set()).update(values)
        operations: list[UpdateOne] = []
        planned = {"AUFNR": 0, "VBELN": 0, "customer": 0}
        conflicts = 0
        customer_orders = {normalize_production_order(row.get("AUFNR")) for row in rows if not is_empty(row.get("AUFNR"))}
        customer_orders.update(
            normalize_production_order(assignment["aufnr"].value)
            for assignment in assignments.values()
            if assignment.get("aufnr") and assignment["aufnr"].value
        )
        customer_orders.update(normalize_production_order(item.get("AUFNR")) for item in api_items.values() if item.get("AUFNR"))
        customers, customer_conflicts = await _customer_master(self.db, customer_orders)
        for row in rows:
            sn = clean_value(row.get("PCODE"))
            assignment = assignments.get(row["_id"], {})
            aufnr: Candidate = assignment.get("aufnr", Candidate())
            vbeln: Candidate = assignment.get("vbeln", Candidate())
            item = api_items.get(sn)
            if item:
                if is_empty(row.get("AUFNR")) and item.get("AUFNR"):
                    api_conflicts = tuple(sorted(item.get("conflicts", {}).get("AUFNR", set())))
                    aufnr = Candidate(normalize_production_order(item["AUFNR"]), f"sap_sn_info:{','.join(item['sources'])}", tuple(sorted(set(aufnr.conflicts) | set(api_conflicts))))
                if is_empty(row.get("VBELN")) and item.get("VBELN"):
                    api_conflicts = tuple(sorted(item.get("conflicts", {}).get("VBELN", set())))
                    vbeln = Candidate(normalize_sales_order(item["VBELN"]), f"sap_sn_info:{','.join(item['sources'])}", tuple(sorted(set(vbeln.conflicts) | set(api_conflicts))))
                if not vbeln.value and aufnr.value:
                    vbeln = resolve_candidate([("sales_orders_sap", sales_master.get(aufnr.value, set())), ("order_bom", bom_sales.get(aufnr.value, set()))])
            order = normalize_production_order(aufnr.value or row.get("AUFNR"))
            customer = customers.get(order, "")
            updates: dict[str, Any] = {}
            audit: dict[str, Any] = {"run_id": run_id, "updated_at": datetime.now(timezone.utc)}
            if is_empty(row.get("AUFNR")) and aufnr.value:
                updates["AUFNR"] = aufnr.value
                audit["AUFNR"] = {"source": aufnr.source, "conflicting_values": list(aufnr.conflicts)}
                planned["AUFNR"] += 1
            if is_empty(row.get("VBELN")) and vbeln.value:
                updates["VBELN"] = vbeln.value
                audit["VBELN"] = {"source": vbeln.source, "conflicting_values": list(vbeln.conflicts)}
                planned["VBELN"] += 1
            if is_empty(row.get("customer")) and customer:
                updates["customer"] = customer
                audit["customer"] = {"source": "sales_orders_sap.data.NAME1_ZU", "production_order": order, "conflicting_values": customer_conflicts.get(order, [])}
                planned["customer"] += 1
            if any((aufnr.conflicts, vbeln.conflicts, customer_conflicts.get(order))):
                conflicts += 1
            has_conflicts = bool(aufnr.conflicts or vbeln.conflicts or customer_conflicts.get(order))
            if updates or has_conflicts:
                updates["rty_backfill"] = audit
                target_fields = [field for field in updates if field in {"AUFNR", "VBELN", "customer"}]
                filter_spec: dict[str, Any] = {"_id": row["_id"]}
                if target_fields:
                    filter_spec["$and"] = [_field_empty(field) for field in target_fields]
                operations.append(UpdateOne(filter_spec, {"$set": updates}))
        plan = RepairBackfillPlan(
            operations=operations,
            updates_planned=planned,
            conflict_records=conflicts,
            customer_conflicts=len(customer_conflicts),
        )
        if not dry_run:
            matched_updates = 0
            modified_updates = 0
            for offset in range(0, len(operations), 1000):
                result = await collection.bulk_write(operations[offset : offset + 1000])
                matched_updates += result.matched_count
                modified_updates += result.modified_count
        else:
            matched_updates = modified_updates = 0
        return {"success": not api_errors, "candidate_records": len(rows), "unique_sn": len(sns), "api_calls": (len(unresolved) + batch_size - 1) // batch_size, "api_errors": api_errors, "updates_planned": plan.updates_planned, "records_updated_planned": len(plan.operations), "matched_updates": matched_updates, "modified_updates": modified_updates, "conflict_records": plan.conflict_records, "customer_conflicts": plan.customer_conflicts}

    async def run(self, *, mode: str, end_date: date | None = None, start_date: date | None = None, prodh_list: list[str] | None = None, lookback_days: int = 7, only: str | None = None, dry_run: bool = False) -> dict[str, Any]:
        run_id = uuid.uuid4().hex
        # SAP's daily boundary follows the scheduler host's business date.
        end_date = end_date or date.today()
        started = datetime.now(timezone.utc)
        stages: dict[str, Any] = {}
        if only in (None, "sales"):
            try:
                stages["sales"] = await self.sales(start_date=start_date, end_date=end_date, prodh_list=prodh_list or ["00100"], lookback_days=lookback_days, bootstrap=mode == "bootstrap", dry_run=dry_run, run_id=run_id)
            except Exception as exc:
                stages["sales"] = {"success": False, "error": str(exc)}
        if only in (None, "repair"):
            try:
                stages["repair"] = await self.repair(dry_run=dry_run, run_id=run_id)
            except Exception as exc:
                stages["repair"] = {"success": False, "error": str(exc)}
        success = all(stage.get("success", False) for stage in stages.values())
        summary = {
            "run_id": run_id,
            "mode": mode,
            "dry_run": dry_run,
            "only": only,
            "parameters": {
                "start_date": start_date.isoformat() if start_date else None,
                "end_date": end_date.isoformat(),
                "lookback_days": lookback_days,
                "prodh_list": prodh_list or ["00100"],
            },
            "started_at": started.isoformat(),
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "stages": stages,
            "success": success,
        }
        await self.db[RUNS].insert_one(summary)
        return summary
