"""Order BOM LRR dashboard API."""

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


def _bom_query(
    production_order: str | None, sales_order: str | None, storage_location: str | None
) -> dict:
    query: dict[str, Any] = {}
    if production_order:
        query["AUFNR_1"] = {"$in": _variants(production_order, normalize_production_order)}
    if sales_order:
        normalized_sales_order = normalize_sales_order(sales_order)
        if normalized_sales_order.isdigit():
            query["VBELN_EX"] = {"$regex": rf"^0*{re.escape(normalized_sales_order)}(?:--\d+)?$"}
        else:
            query["VBELN_EX"] = {"$in": _variants(sales_order, normalize_sales_order)}
    if storage_location:
        query["LGORT"] = storage_location.strip()
    return query


def aggregate_lrr(
    bom_docs: list[dict],
    fault_docs: list[dict],
    group_by: str = "productionOrder",
    *,
    include_details: bool = True,
) -> tuple[list[LRRData], list[LRRFaultDetail]]:
    """Calculate LRR by production order or sales order."""
    if group_by not in {"productionOrder", "salesOrder"}:
        raise ValueError(f"Unsupported LRR grouping: {group_by}")

    groups: dict[str, dict[str, Any]] = {}
    for bom in bom_docs:
        production_order = normalize_production_order(bom.get("AUFNR_1"))
        sales_order = normalize_sales_order(bom.get("VBELN_EX"))
        order_no = production_order if group_by == "productionOrder" else sales_order
        if not order_no:
            continue
        group = groups.setdefault(
            order_no,
            {
                "quantity": Decimal(0),
                "production_orders": set(),
                "sales_orders": set(),
                "storage_locations": set(),
            },
        )
        group["quantity"] += quantity(bom.get("MENGE_A"))
        if production_order:
            group["production_orders"].add(production_order)
        if sales_order:
            group["sales_orders"].add(sales_order)
        storage_location = str(bom.get("LGORT") or "").strip()
        if storage_location:
            group["storage_locations"].add(storage_location)

    active_groups = {order_no: group for order_no, group in groups.items() if group["quantity"] > 0}
    groups_by_production_order: dict[str, set[str]] = defaultdict(set)
    groups_by_sales_order: dict[str, set[str]] = defaultdict(set)
    for order_no, group in active_groups.items():
        for production_order in group["production_orders"]:
            groups_by_production_order[production_order].add(order_no)
        for sales_order in group["sales_orders"]:
            groups_by_sales_order[sales_order].add(order_no)

    fault_counts: dict[str, int] = defaultdict(int)
    details: list[LRRFaultDetail] = []
    seen_links: set[tuple[str, str]] = set()
    for fault in fault_docs:
        fault_id = str(fault.get("_id") or id(fault))
        production_order = normalize_production_order(fault.get("mfg_order") or fault.get("AUFNR"))
        sales_order = normalize_sales_order(fault.get("sale_no") or fault.get("VBELN"))
        matched_groups = set()
        if production_order:
            matched_groups.update(groups_by_production_order.get(production_order, set()))
        if sales_order:
            matched_groups.update(groups_by_sales_order.get(sales_order, set()))
        for order_no in sorted(matched_groups):
            link = (fault_id, order_no)
            if link in seen_links:
                continue
            seen_links.add(link)
            fault_counts[order_no] += 1
            if include_details:
                group = active_groups[order_no]
                details.append(
                    LRRFaultDetail(
                        orderDimension=group_by,
                        orderNo=order_no,
                        productionOrder=production_order,
                        salesOrder=str(fault.get("sale_no") or fault.get("VBELN") or ""),
                        storageLocation=",".join(sorted(group["storage_locations"])),
                        sn=str(fault.get("sn") or fault.get("PCODE") or ""),
                        faultType=str(fault.get("fault_category") or fault.get("ZNGWD") or ""),
                        faultDesc=str(fault.get("fault_desc") or fault.get("ZWXWD") or ""),
                        repairTime=str(fault.get("repair_time") or fault.get("ZDATE_WX") or ""),
                    )
                )

    rows: list[LRRData] = []
    for order_no, group in active_groups.items():
        issued = group["quantity"]
        faults = fault_counts[order_no]
        rows.append(
            LRRData(
                id=f"{group_by}:{order_no}",
                orderDimension=group_by,
                orderNo=order_no,
                productionOrder=",".join(sorted(group["production_orders"])),
                salesOrder=",".join(sorted(group["sales_orders"])),
                issuedQuantity=float(issued),
                faultCount=faults,
                lrrRate=round(float(Decimal(faults) / issued * 100), 2),
            )
        )
    return rows, details


def _sort_rows(rows: list[LRRData], sort_by: str, sort_dir: str) -> list[LRRData]:
    key = (
        sort_by if sort_by in {"orderNo", "issuedQuantity", "faultCount", "lrrRate"} else "lrrRate"
    )
    return sorted(
        rows,
        key=lambda row: (getattr(row, key) is None, getattr(row, key) or 0),
        reverse=sort_dir == "desc",
    )


async def _load_bom_and_repairs(
    production_order: str | None,
    sales_order: str | None,
    storage_location: str | None,
    *,
    include_fault_details: bool = True,
):
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
    bom_docs = (
        await db[Collections.ORDER_BOM_POSTINGS_SAP]
        .find(
            _bom_query(production_order, sales_order, storage_location),
            projection=projection,
        )
        .to_list(length=None)
    )
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
                "AUFNR": {
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
            {variant for sale in sale_values for variant in _variants(sale, normalize_sales_order)}
        )
        normalized_numeric_sales = sorted(
            {
                normalize_sales_order(sale)
                for sale in sale_values
                if normalize_sales_order(sale).isdigit()
            },
            key=lambda value: (-len(value), value),
        )
        sales_conditions: list[dict[str, Any]] = [{"VBELN": {"$in": sales_match}}]
        if normalized_numeric_sales:
            alternatives = "|".join(re.escape(sale) for sale in normalized_numeric_sales)
            sales_conditions.append({"VBELN": {"$regex": rf"^0*(?:{alternatives})(?:--\d+)?$"}})
        branches.append({"$or": sales_conditions})
    repair_query = {"$or": branches} if branches else {"_id": "__none__"}
    repair_projection: dict[str, int] = {
        "_id": 1,
        "AUFNR": 1,
        "VBELN": 1,
    }
    if include_fault_details:
        repair_projection.update(
            {
                "PCODE": 1,
                "ZNGWD": 1,
                "ZWXWD": 1,
                "ZDATE_WX": 1,
            }
        )
    repairs = (
        await db[Collections.REPAIR_RECORDS_SAP]
        .find(repair_query, projection=repair_projection)
        .to_list(length=None)
    )
    return bom_docs, repairs


@router.get("/list", response_model=LRRListResponse)
@audit_log("QUERY", "lrr_list")
async def get_lrr_list(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    productionOrder: str | None = Query(None),
    salesOrder: str | None = Query(None),
    storageLocation: str | None = Query(None),
    groupBy: str = Query("productionOrder", pattern="^(productionOrder|salesOrder)$"),
    sortBy: str = Query("lrrRate"),
    sortDir: str = Query("desc"),
):
    bom_docs, repair_docs = await _load_bom_and_repairs(
        productionOrder, salesOrder, storageLocation, include_fault_details=False
    )
    rows, _ = aggregate_lrr(bom_docs, repair_docs, group_by=groupBy, include_details=False)
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
            orderCount=len(rows),
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
        productionOrders=sorted(
            {
                normalize_production_order(value)
                for value in production_orders
                if normalize_production_order(value)
            }
        ),
        salesOrders=sorted(
            {normalize_sales_order(value) for value in sales_orders if normalize_sales_order(value)}
        ),
        storageLocations=sorted(
            {str(value or "").strip() for value in storage_locations if str(value or "").strip()}
        ),
    )


@router.get("/fault-details", response_model=list[LRRFaultDetail])
@audit_log("QUERY", "lrr_fault_details")
async def get_lrr_fault_details(
    request: Request,
    productionOrder: str | None = Query(None),
    salesOrder: str | None = Query(None),
    storageLocation: str | None = Query(None),
    groupBy: str = Query("productionOrder", pattern="^(productionOrder|salesOrder)$"),
    limit: int = Query(20000, ge=1, le=50000),
):
    bom_docs, repair_docs = await _load_bom_and_repairs(
        productionOrder, salesOrder, storageLocation
    )
    _, details = aggregate_lrr(bom_docs, repair_docs, group_by=groupBy)
    return details[:limit]
