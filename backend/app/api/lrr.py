"""Order BOM material LRR dashboard API."""

from __future__ import annotations

import asyncio
import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, Query, Request

from app.core.logger import audit_log
from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.lrr import LRRData, LRRFaultDetail, LRRListResponse, LRROptions, LRRSummary

router = APIRouter()


def normalize_production_order(value: Any) -> str:
    text = str(value or "").strip()
    if not text or (text.isdigit() and not text.lstrip("0")):
        return ""
    return text.zfill(12) if text.isdigit() else text


def normalize_sales_order(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = text.rsplit("--", 1)[0]
    return text.lstrip("0") or "0" if text.isdigit() else text


def material_no(value: Any) -> str:
    text = str(value or "").strip()
    return text[-8:] if text else ""


def quantity(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal(0)
    try:
        return Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError, TypeError):
        return Decimal(0)


def _variants(value: str, normalizer) -> list[str]:
    raw = str(value or "").strip()
    normalized = normalizer(value)
    return list(dict.fromkeys(item for item in (raw, normalized) if item))


def _bom_query(production_order: str | None, sales_order: str | None, storage_location: str | None) -> dict:
    query: dict[str, Any] = {}
    if production_order:
        query["AUFNR_1"] = {"$in": _variants(production_order, normalize_production_order)}
    if sales_order:
        query["VBELN_EX"] = {"$in": _variants(sales_order, normalize_sales_order)}
    if storage_location:
        query["LGORT"] = storage_location.strip()
    return query


def aggregate_lrr(bom_docs: list[dict], fault_docs: list[dict]) -> tuple[list[LRRData], list[LRRFaultDetail]]:
    """Aggregate quantities and expand each fault to its associated BOM materials."""
    materials: dict[str, dict[str, Any]] = {}
    sales_orders: dict[str, list[str]] = defaultdict(list)
    order_locations: dict[str, str] = {}
    for bom in bom_docs:
        pn = material_no(bom.get("MATNR"))
        order = normalize_production_order(bom.get("AUFNR_1"))
        sale = normalize_sales_order(bom.get("VBELN_EX"))
        if not pn or not order:
            continue
        item = materials.setdefault(pn, {"qty": Decimal(0), "desc": "", "orders": set()})
        item["qty"] += quantity(bom.get("MENGE_A"))
        if not item["desc"]:
            item["desc"] = str(bom.get("MAKTX") or "").strip()
        item["orders"].add(order)
        order_locations.setdefault(order, str(bom.get("LGORT") or "").strip())
        if sale and order not in sales_orders[sale]:
            sales_orders[sale].append(order)

    positive = {pn: value for pn, value in materials.items() if value["qty"] > 0}
    fault_counts: dict[str, int] = defaultdict(int)
    details: list[LRRFaultDetail] = []
    seen_links: set[tuple[str, str, str]] = set()
    for fault in fault_docs:
        fault_id = str(fault.get("_id") or id(fault))
        fault_order = normalize_production_order(fault.get("mfg_order"))
        has_order = fault_order and any(fault_order in value["orders"] for value in positive.values())
        targets = [fault_order] if has_order else sales_orders.get(normalize_sales_order(fault.get("sale_no")), [])
        for target in targets:
            for pn, value in positive.items():
                if target not in value["orders"]:
                    continue
                link = (fault_id, target, pn)
                if link in seen_links:
                    continue
                seen_links.add(link)
                fault_counts[pn] += 1
                details.append(LRRFaultDetail(
                    materialNo=pn,
                    materialDesc=value["desc"],
                    productionOrder=target,
                    salesOrder=str(fault.get("sale_no") or ""),
                    storageLocation=order_locations.get(target, str(fault.get("LGORT") or "")),
                    sn=str(fault.get("sn") or ""),
                    faultType=str(fault.get("fault_category") or ""),
                    faultDesc=str(fault.get("fault_desc") or ""),
                    repairTime=str(fault.get("repair_time") or ""),
                ))

    rows: list[LRRData] = []
    for pn, value in positive.items():
        issued = value["qty"]
        faults = fault_counts[pn]
        rows.append(LRRData(
            id=pn,
            materialNo=pn,
            materialDesc=value["desc"],
            issuedQuantity=float(issued),
            faultCount=faults,
            lrrRate=round(float(Decimal(faults) / issued * 100), 2),
        ))
    return rows, details


def _sort_rows(rows: list[LRRData], sort_by: str, sort_dir: str) -> list[LRRData]:
    key = sort_by if sort_by in {"materialNo", "issuedQuantity", "faultCount", "lrrRate"} else "lrrRate"
    return sorted(rows, key=lambda row: (getattr(row, key) is None, getattr(row, key) or 0), reverse=sort_dir == "desc")


async def _load_bom_and_faults(production_order: str | None, sales_order: str | None, storage_location: str | None):
    db = get_database()
    projection = {
        "_id": 1,
        "AUFNR_1": 1,
        "VBELN_EX": 1,
        "LGORT": 1,
        "MATNR": 1,
        "MAKTX": 1,
        "MENGE_A": 1,
    }
    bom_docs = await db[Collections.ORDER_BOM_POSTINGS_SAP].find(
        _bom_query(production_order, sales_order, storage_location),
        projection=projection,
    ).to_list(length=None)
    order_values = sorted(
        {
            str(d.get("AUFNR_1") or "").strip()
            for d in bom_docs
            if normalize_production_order(d.get("AUFNR_1"))
        }
    )
    sale_values = sorted(
        {
            str(d.get("VBELN_EX") or "").strip()
            for d in bom_docs
            if normalize_sales_order(d.get("VBELN_EX"))
        }
    )
    orders = {normalize_production_order(value) for value in order_values}
    sales = {normalize_sales_order(value) for value in sale_values}
    branches = []
    if orders:
        branches.append(
            {
                "mfg_order": {
                    "$in": sorted(
                        {
                            variant
                            for order in order_values
                            for variant in _variants(order, normalize_production_order)
                        }
                    )
                }
            }
        )
    if sales:
        sales_match = sorted(
            {
                variant
                for sale in sale_values
                for variant in _variants(sale, normalize_sales_order)
            }
        )
        sales_match_regex = [
            {"sale_no": {"$regex": rf"^0*{re.escape(normalize_sales_order(sale))}(?:--\d+)?$"}}
            for sale in sale_values
            if normalize_sales_order(sale).isdigit()
        ]
        branches.append({"$or": [{"sale_no": {"$in": sales_match}}, *sales_match_regex]})
    fault_query = {"$or": branches} if branches else {"_id": "__none__"}
    faults = await db[Collections.FAULT_INFO].find(fault_query).to_list(length=None)
    return bom_docs, faults


@router.get("/list", response_model=LRRListResponse)
@audit_log("QUERY", "lrr_list")
async def get_lrr_list(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    productionOrder: str | None = Query(None),
    salesOrder: str | None = Query(None),
    storageLocation: str | None = Query(None),
    sortBy: str = Query("lrrRate"),
    sortDir: str = Query("desc"),
):
    bom_docs, fault_docs = await _load_bom_and_faults(productionOrder, salesOrder, storageLocation)
    rows, _ = aggregate_lrr(bom_docs, fault_docs)
    rows = _sort_rows(rows, sortBy, sortDir)
    issued_total = sum((quantity(row.issuedQuantity) for row in rows), Decimal(0))
    fault_total = sum(row.faultCount for row in rows)
    start = (page - 1) * limit
    return LRRListResponse(
        items=rows[start : start + limit],
        total=len(rows),
        page=page,
        limit=limit,
        has_more=start + limit < len(rows),
        summary=LRRSummary(
            materialKinds=len(rows),
            issuedQuantity=float(issued_total),
            totalFaults=fault_total,
            overallLrr=round(fault_total / issued_total * 100, 2) if issued_total > 0 else None,
        ),
    )


@router.get("/options", response_model=LRROptions)
@audit_log("QUERY", "lrr_options")
async def get_lrr_options(request: Request):
    collection = get_database()[Collections.ORDER_BOM_POSTINGS_SAP]
    production_orders, sales_orders, storage_locations = await asyncio.gather(
        collection.distinct("AUFNR_1"),
        collection.distinct("VBELN_EX"),
        collection.distinct("LGORT"),
    )
    return LRROptions(
        productionOrders=sorted({normalize_production_order(value) for value in production_orders if normalize_production_order(value)}),
        salesOrders=sorted({normalize_sales_order(value) for value in sales_orders if normalize_sales_order(value)}),
        storageLocations=sorted({str(value or "").strip() for value in storage_locations if str(value or "").strip()}),
    )


@router.get("/fault-details", response_model=list[LRRFaultDetail])
@audit_log("QUERY", "lrr_fault_details")
async def get_lrr_fault_details(
    request: Request,
    productionOrder: str | None = Query(None),
    salesOrder: str | None = Query(None),
    storageLocation: str | None = Query(None),
    limit: int = Query(20000, ge=1, le=50000),
):
    bom_docs, fault_docs = await _load_bom_and_faults(productionOrder, salesOrder, storageLocation)
    _, details = aggregate_lrr(bom_docs, fault_docs)
    return details[:limit]
