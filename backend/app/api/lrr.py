"""Order BOM LRR dashboard API."""

from __future__ import annotations

import asyncio
import re
from collections import defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from app.core.logger import audit_log
from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.lrr import (
    LRRData,
    LRRFaultDetail,
    LRRFaultDetailsResponse,
    LRRListResponse,
    LRROptions,
    LRRSummary,
)

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


def _compact_date(value: str | None, label: str) -> str | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").strftime("%Y%m%d")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{label}必须是 YYYY-MM-DD") from exc


def _date_query(field: str, date_from: str | None, date_to: str | None) -> dict[str, Any]:
    start = _compact_date(date_from, "开始日期")
    end = _compact_date(date_to, "结束日期")
    if start and end and start > end:
        raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期")
    bounds = {key: value for key, value in (("$gte", start), ("$lte", end)) if value}
    return {field: bounds} if bounds else {}


def _bom_query(
    production_order: str | None,
    sales_order: str | None,
    date_from: str | None = None,
    date_to: str | None = None,
    order_keyword: str | None = None,
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
    keyword = str(order_keyword or "").strip()
    if keyword:
        normalized_sales_order = normalize_sales_order(keyword)
        keyword_conditions: list[dict[str, Any]] = [
            {"AUFNR_1": {"$in": _variants(keyword, normalize_production_order)}}
        ]
        if normalized_sales_order.isdigit():
            keyword_conditions.append(
                {"VBELN_EX": {"$regex": rf"^0*{re.escape(normalized_sales_order)}(?:--\d+)?$"}}
            )
        else:
            keyword_conditions.append(
                {"VBELN_EX": {"$in": _variants(keyword, normalize_sales_order)}}
            )
        query["$or"] = keyword_conditions
    query.update(_date_query("BUDAT_MKPF", date_from, date_to))
    return query


def _repair_query(
    order_values: list[str],
    sale_values: list[str],
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict:
    """Build the repair-record query for a set of BOM order references."""
    branches = []
    if order_values:
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
    if sale_values:
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
    query: dict[str, Any] = {"$or": branches} if branches else {"_id": "__none__"}
    query.update(_date_query("ZDATE_WX", date_from, date_to))
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
        if group_by == "productionOrder":
            # A sales order can span several production orders. Counting a sales-only
            # repair in every linked order would inflate both row and summary LRR.
            matched_groups = groups_by_production_order.get(production_order, set())
        elif sales_order:
            matched_groups = groups_by_sales_order.get(sales_order, set())
        else:
            candidate_groups = groups_by_production_order.get(production_order, set())
            matched_groups = candidate_groups if len(candidate_groups) == 1 else set()
        for order_no in sorted(matched_groups):
            link = (fault_id, order_no)
            if link in seen_links:
                continue
            seen_links.add(link)
            fault_counts[order_no] += int(fault.get("_fault_count", 1))
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
    date_from: str | None,
    date_to: str | None,
    order_keyword: str | None,
    group_by: str,
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
            _bom_query(production_order, sales_order, date_from, date_to, order_keyword),
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
    repair_query = _repair_query(
        order_values,
        sale_values if group_by == "salesOrder" else [],
        date_from,
        date_to,
    )
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


async def _load_lrr_list_data(
    production_order: str | None,
    sales_order: str | None,
    date_from: str | None,
    date_to: str | None,
    order_keyword: str | None,
    group_by: str,
) -> tuple[list[dict], list[dict]]:
    """Load compact BOM and repair aggregates for the paginated dashboard."""
    db = get_database()
    bom_docs = (
        await db[Collections.ORDER_BOM_POSTINGS_SAP]
        .aggregate(
            [
                {
                    "$match": _bom_query(
                        production_order, sales_order, date_from, date_to, order_keyword
                    )
                },
                {
                    "$group": {
                        "_id": {
                            "productionOrder": "$AUFNR_1",
                            "salesOrder": "$VBELN_EX",
                            "storageLocation": "$LGORT",
                        },
                        "MENGE_A": {
                            "$sum": {
                                "$convert": {
                                    "input": "$MENGE_A",
                                    "to": "decimal",
                                    "onError": 0,
                                    "onNull": 0,
                                }
                            }
                        },
                    }
                },
                {
                    "$project": {
                        "_id": 0,
                        "AUFNR_1": "$_id.productionOrder",
                        "VBELN_EX": "$_id.salesOrder",
                        "LGORT": "$_id.storageLocation",
                        "MENGE_A": 1,
                    }
                },
            ]
        )
        .to_list(length=None)
    )
    order_values = sorted(
        {
            str(doc.get("AUFNR_1") or "").strip()
            for doc in bom_docs
            if normalize_production_order(doc.get("AUFNR_1"))
        }
    )
    sale_values = sorted(
        {
            str(doc.get("VBELN_EX") or "").strip()
            for doc in bom_docs
            if normalize_sales_order(doc.get("VBELN_EX"))
        }
    )
    repairs = (
        await db[Collections.REPAIR_RECORDS_SAP]
        .aggregate(
            [
                {
                    "$match": _repair_query(
                        order_values,
                        sale_values if group_by == "salesOrder" else [],
                        date_from,
                        date_to,
                    )
                },
                {
                    "$group": {
                        "_id": {"productionOrder": "$AUFNR", "salesOrder": "$VBELN"},
                        "_fault_count": {"$sum": 1},
                    }
                },
                {
                    "$project": {
                        "_id": 0,
                        "AUFNR": "$_id.productionOrder",
                        "VBELN": "$_id.salesOrder",
                        "_fault_count": 1,
                    }
                },
            ]
        )
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
    dateFrom: str | None = Query(None, description="BOM 过账和维修日期起始日 (YYYY-MM-DD)"),
    dateTo: str | None = Query(None, description="BOM 过账和维修日期截止日 (YYYY-MM-DD)"),
    orderKeyword: str | None = Query(None, max_length=64),
    groupBy: str = Query("productionOrder", pattern="^(productionOrder|salesOrder)$"),
    sortBy: str = Query("lrrRate"),
    sortDir: str = Query("desc"),
):
    bom_docs, repair_docs = await _load_lrr_list_data(
        productionOrder, salesOrder, dateFrom, dateTo, orderKeyword, groupBy
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


@router.get("/fault-details", response_model=LRRFaultDetailsResponse)
@audit_log("QUERY", "lrr_fault_details")
async def get_lrr_fault_details(
    request: Request,
    productionOrder: str | None = Query(None),
    salesOrder: str | None = Query(None),
    dateFrom: str | None = Query(None),
    dateTo: str | None = Query(None),
    orderKeyword: str | None = Query(None, max_length=64),
    groupBy: str = Query("productionOrder", pattern="^(productionOrder|salesOrder)$"),
    limit: int = Query(50000, ge=1, le=50000),
):
    bom_docs, repair_docs = await _load_bom_and_repairs(
        productionOrder, salesOrder, dateFrom, dateTo, orderKeyword, groupBy
    )
    _, details = aggregate_lrr(bom_docs, repair_docs, group_by=groupBy)
    return LRRFaultDetailsResponse(
        items=details[:limit], total=len(details), truncated=len(details) > limit
    )
