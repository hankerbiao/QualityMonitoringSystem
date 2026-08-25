"""RTY API calculated from SAP sales-order production quantities and repair records."""

import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from app.core.logger import audit_log, log_info
from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.common import PaginatedResponse, Response
from app.schemas.rty import DefectDetail, RTYData, SalesOrderSummary

router = APIRouter()

YEAR_START = "2026-01-01"
YEAR_END = "2026-12-31"
REPAIR_YEAR_START = "20260101"
REPAIR_YEAR_END = "20261231"
MAX_DETAIL_ROW_COUNT = 50_000
_REPAIR_DUPLICATE_METADATA = frozenset(
    {
        "_id",
        "_source_key",
        "MANDT",
        "_sync_run_id",
        "_synced_at",
        "order_backfill",
        "customer_backfill",
        "customer",
    }
)


def _split_values(value: str | None) -> list[str]:
    return list(
        dict.fromkeys(item.strip() for item in re.split(r"[,，\n]+", value or "") if item.strip())
    )


def _validate_date(value: str) -> str:
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="日期格式必须为 YYYY-MM-DD") from exc


def _sales_date_match(date_from: str | None, date_to: str | None) -> dict[str, str]:
    """RTY is 2026-only because repair history outside 2026 has been removed."""
    lower = max(YEAR_START, _validate_date(date_from)) if date_from else YEAR_START
    upper = min(YEAR_END, _validate_date(date_to)) if date_to else YEAR_END
    if lower > upper:
        return {"$gte": "9999-12-31", "$lte": "0000-01-01"}
    return {"$gte": lower, "$lte": upper}


def _normalize_order(value: Any) -> str:
    value = str(value or "").strip()
    if not value:
        return ""
    return value.lstrip("0") or "0" if value.isdigit() else value


def _order_variants(values: list[str]) -> list[str]:
    """Match SAP's compact sales-order AUFNR and 12-digit repair AUFNR formats."""
    variants: set[str] = set()
    for value in values:
        normalized = _normalize_order(value)
        if not normalized:
            continue
        variants.add(value.strip())
        variants.add(normalized)
        if normalized.isdigit():
            variants.add(normalized.zfill(12))
    return sorted(variants)


async def _sales_filter(
    db,
    *,
    sales_order: str | None = None,
    production_order: str | None = None,
    serial_number: str | None = None,
    base: str | None = None,
    product_model: str | None = None,
    customer: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
    """Build a sales_orders_sap filter, including SN-to-production-order resolution."""
    match: dict[str, Any] = {"gstrs_date": _sales_date_match(date_from, date_to)}
    for field, value in (("data.VBELN", sales_order), ("aufnr", production_order)):
        values = _split_values(value)
        if not values:
            continue
        if field == "aufnr":
            values = _order_variants(values)
        match[field] = {"$in": values} if len(values) > 1 else values[0]
    if base and base != "all":
        match["data.LGORT"] = base
    if product_model and product_model != "all":
        match["data.MAKTX_TH"] = product_model
    if customer:
        match["data.NAME1_ZU"] = customer
    if serial_number:
        repairs = (
            await db[Collections.REPAIR_RECORDS_SAP]
            .find({"PCODE": serial_number.strip()}, {"AUFNR": 1})
            .to_list(length=10_000)
        )
        orders = _order_variants([str(repair.get("AUFNR") or "") for repair in repairs])
        match["aufnr"] = {"$in": orders} if orders else {"$in": []}
    return match


def _group_field(
    sales_order: str | None,
    production_order: str | None,
    base: str | None,
    product_model: str | None,
    customer: str | None,
) -> str:
    if production_order:
        return "aufnr"
    if sales_order:
        return "data.VBELN"
    if customer:
        return "data.NAME1_ZU"
    if product_model and product_model != "all":
        return "data.MAKTX_TH"
    if base and base != "all":
        return "data.LGORT"
    return "data.VBELN"


async def _sales_groups(
    db, sales_filter: dict[str, Any], group_field: str, page: int, limit: int
) -> tuple[int, list[dict[str, Any]]]:
    """Aggregate 2026 production quantity from WMENG, one document per production order."""
    pipeline = [
        {"$match": sales_filter},
        {"$sort": {"gstrs_date": 1, "aufnr": 1}},
        {
            "$group": {
                "_id": f"${group_field}",
                "first": {"$first": "$$ROOT"},
                "input_count": {
                    "$sum": {
                        "$convert": {
                            "input": "$data.WMENG",
                            "to": "double",
                            "onError": 0,
                            "onNull": 0,
                        }
                    }
                },
                "sales_orders": {"$addToSet": "$data.VBELN"},
                "production_orders": {"$addToSet": "$aufnr"},
                "customers": {"$addToSet": "$data.NAME1_ZU"},
            }
        },
        {"$match": {"_id": {"$nin": [None, ""]}}},
        {
            "$facet": {
                "metadata": [{"$count": "total"}],
                "data": [
                    {"$sort": {"_id": 1}},
                    {"$skip": (page - 1) * limit},
                    {"$limit": limit},
                ],
            }
        },
    ]
    result = await db[Collections.SALES_ORDERS_SAP].aggregate(pipeline).to_list(length=1)
    facet = result[0] if result else {"metadata": [], "data": []}
    total = facet["metadata"][0]["total"] if facet.get("metadata") else 0
    return total, facet.get("data", [])


def _clean_values(values: list[Any]) -> list[str]:
    return sorted({str(value).strip() for value in values if str(value or "").strip()})


async def _repair_rows_for_orders(db, production_orders: set[str]) -> list[dict[str, Any]]:
    if not production_orders:
        return []
    return (
        await db[Collections.REPAIR_RECORDS_SAP]
        .find(
            {
                "AUFNR": {"$in": _order_variants(list(production_orders))},
                "ZDATE_WX": {"$gte": REPAIR_YEAR_START, "$lte": REPAIR_YEAR_END},
            }
        )
        .to_list(length=MAX_DETAIL_ROW_COUNT + 1)
    )


def _deduplicate_repair_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse the same repair event ingested from multiple SAP clients."""
    seen: dict[tuple[tuple[str, str], ...], int] = {}
    unique: list[dict[str, Any]] = []
    for row in rows:
        key = tuple(
            sorted(
                (str(field), repr(value))
                for field, value in row.items()
                if field not in _REPAIR_DUPLICATE_METADATA
            )
        )
        if key in seen:
            existing = unique[seen[key]]
            if not existing.get("customer") and row.get("customer"):
                existing["customer"] = row["customer"]
            continue
        seen[key] = len(unique)
        unique.append(row)
    return unique


async def _fault_counts(db, groups: list[dict[str, Any]]) -> dict[str, int]:
    orders_by_group: dict[str, set[str]] = {}
    group_ids_by_order: dict[str, set[str]] = {}
    for group in groups:
        group_id = str(group.get("_id") or "")
        orders = {_normalize_order(value) for value in group.get("production_orders", [])}
        orders.discard("")
        orders_by_group[group_id] = orders
        for order in orders:
            group_ids_by_order.setdefault(order, set()).add(group_id)

    repairs = _deduplicate_repair_rows(await _repair_rows_for_orders(db, set(group_ids_by_order)))
    failed_sns: dict[str, set[str]] = {group_id: set() for group_id in orders_by_group}
    for repair in repairs:
        order = _normalize_order(repair.get("AUFNR"))
        sn = str(repair.get("PCODE") or "").strip()
        if sn:
            for group_id in group_ids_by_order.get(order, set()):
                failed_sns[group_id].add(sn)
    return {group_id: len(sns) for group_id, sns in failed_sns.items()}


def _repair_to_detail(item: dict[str, Any]) -> DefectDetail:
    return DefectDetail(
        id=str(item.get("_id")),
        defectCode=str(item.get("ZNGWD") or "未知"),
        description=str(item.get("ZWXWD") or ""),
        count=1,
        sn=str(item.get("PCODE") or ""),
        sale_no=str(item.get("VBELN") or ""),
        mfg_order=str(item.get("AUFNR") or ""),
        product_family=str(item.get("ZJXMC") or ""),
        fault_2nd_appear="",
        fault_3rd_appear="",
        repairTime=str(item.get("ZDATE_WX") or ""),
        repairPerson=str(item.get("ZUSER") or ""),
        repair_effectiveness="",
        customer=str(item.get("customer") or ""),
    )


async def _repair_details_for_orders(db, production_orders: set[str]) -> list[DefectDetail]:
    repairs = _deduplicate_repair_rows(await _repair_rows_for_orders(db, production_orders))
    if len(repairs) > MAX_DETAIL_ROW_COUNT:
        raise HTTPException(status_code=413, detail="维修明细超过上限 50000，请缩小筛选范围")
    details = [_repair_to_detail(repair) for repair in repairs]
    details.sort(key=lambda item: item.repairTime, reverse=True)
    return details


@router.get("/list", response_model=PaginatedResponse[RTYData])
@audit_log("QUERY", "rty_list")
async def get_rty_list(
    request: Request,
    page: int = Query(1, ge=1, description="页码"),
    limit: int = Query(50, ge=1, le=500, description="每页数量"),
    salesOrder: str | None = Query(None, description="销售订单号 (data.VBELN)"),
    productionOrder: str | None = Query(None, description="生产订单号 (aufnr)"),
    serialNumber: str | None = Query(None, description="维修 SN (PCODE)"),
    base: str | None = Query(None, description="基地/库位 (data.LGORT)"),
    productModel: str | None = Query(None, description="生产机型 (data.MAKTX_TH)"),
    customer: str | None = Query(None, description="客户 (data.NAME1_ZU)"),
    dateFrom: str | None = Query(None, description="生产开始日期 (gstrs_date)"),
    dateTo: str | None = Query(None, description="生产开始日期 (gstrs_date)"),
):
    """RTY = (WMENG production quantity - distinct repair SN) / WMENG production quantity."""
    del request
    db = get_database()
    targets_doc = await db[Collections.CONFIGS].find_one({"key": "model_targets"})
    targets = (targets_doc or {}).get("targets", {}) or {}
    sales_filter = await _sales_filter(
        db,
        sales_order=salesOrder,
        production_order=productionOrder,
        serial_number=serialNumber,
        base=base,
        product_model=productModel,
        customer=customer,
        date_from=dateFrom,
        date_to=dateTo,
    )
    group_field = _group_field(salesOrder, productionOrder, base, productModel, customer)
    total, groups = await _sales_groups(db, sales_filter, group_field, page, limit)
    fault_counts = await _fault_counts(db, groups)

    items: list[RTYData] = []
    for group in groups:
        first = group.get("first") or {}
        data = first.get("data") or {}
        input_count = float(group.get("input_count") or 0)
        defect_count = fault_counts.get(str(group.get("_id") or ""), 0)
        model = str(data.get("MAKTX_TH") or "")
        sales_orders = _clean_values(group.get("sales_orders", []))
        production_orders = _clean_values(group.get("production_orders", []))
        customers = _clean_values(group.get("customers", []))
        items.append(
            RTYData(
                id=str(group.get("_id") or "unknown"),
                time=str(first.get("gstrs_date") or ""),
                model="普通机型",
                productModel=model,
                customer=customers[0] if len(customers) == 1 else "",
                base=str(data.get("LGORT") or ""),
                defectCount=defect_count,
                inputCount=round(input_count),
                rtyRate=round((1 - defect_count / input_count) * 100, 2) if input_count else 100.0,
                targetRate=float(targets.get(model, 100)),
                salesOrder=sales_orders[0] if len(sales_orders) == 1 else "",
                productionOrder=production_orders[0] if len(production_orders) == 1 else "",
                salesOrders=sales_orders,
                productionOrders=production_orders,
                productLine="",
                serialNumbers=[],
                status="",
            )
        )
    log_info(f"2026 销售订单 WMENG RTY: {total} 组，本页 {len(items)} 组")
    return PaginatedResponse(
        items=items, total=total, page=page, limit=limit, has_more=page * limit < total
    )


@router.get("/defects/by-filters", response_model=Response[list[DefectDetail]])
@audit_log("QUERY", "defect_by_filters")
async def get_defect_details_by_filters(
    request: Request,
    salesOrder: str | None = Query(None),
    productionOrder: str | None = Query(None),
    serialNumber: str | None = Query(None),
    base: str | None = Query(None),
    productModel: str | None = Query(None),
    customer: str | None = Query(None),
    dateFrom: str | None = Query(None),
    dateTo: str | None = Query(None),
):
    del request
    db = get_database()
    sales_filter = await _sales_filter(
        db,
        sales_order=salesOrder,
        production_order=productionOrder,
        serial_number=serialNumber,
        base=base,
        product_model=productModel,
        customer=customer,
        date_from=dateFrom,
        date_to=dateTo,
    )
    orders = (
        await db[Collections.SALES_ORDERS_SAP]
        .find(sales_filter, {"aufnr": 1})
        .to_list(length=10_000)
    )
    details = await _repair_details_for_orders(
        db, {str(order.get("aufnr") or "") for order in orders}
    )
    return Response(success=True, data=details, message=f"查询到 {len(details)} 条维修故障记录")


@router.get("/defects", response_model=Response[list[DefectDetail]])
async def get_defect_details(sns: str = Query(..., description="机器序列号列表，逗号分隔")):
    sn_list = _split_values(sns)
    if not sn_list:
        return Response(success=True, data=[], message="无 SN 参数")
    db = get_database()
    repairs = (
        await db[Collections.REPAIR_RECORDS_SAP]
        .find(
            {
                "PCODE": {"$in": sn_list},
                "ZDATE_WX": {"$gte": REPAIR_YEAR_START, "$lte": REPAIR_YEAR_END},
            }
        )
        .to_list(length=MAX_DETAIL_ROW_COUNT + 1)
    )
    repairs = _deduplicate_repair_rows(repairs)
    if len(repairs) > MAX_DETAIL_ROW_COUNT:
        raise HTTPException(status_code=413, detail="维修明细超过上限 50000，请缩小筛选范围")
    details = [_repair_to_detail(repair) for repair in repairs]
    details.sort(key=lambda item: item.repairTime, reverse=True)
    return Response(success=True, data=details, message=f"查询到 {len(details)} 条维修故障记录")


@router.get("/defects/by-order", response_model=Response[list[DefectDetail]])
async def get_defect_details_by_order(productionOrder: str = Query(..., description="生产订单号")):
    db = get_database()
    details = await _repair_details_for_orders(db, set(_split_values(productionOrder)))
    return Response(success=True, data=details, message=f"查询到 {len(details)} 条维修故障记录")


@router.get("/sales-order-summary", response_model=Response[list[SalesOrderSummary]])
async def get_sales_order_summary(
    salesOrders: str = Query(..., description="销售订单号列表，逗号分隔"),
):
    db = get_database()
    summaries: list[SalesOrderSummary] = []
    for order in _split_values(salesOrders):
        total, groups = await _sales_groups(
            db, await _sales_filter(db, sales_order=order), "data.VBELN", 1, 1
        )
        if not total or not groups:
            summaries.append(
                SalesOrderSummary(salesOrder=order, inputCount=0, defectCount=0, rtyRate=100.0)
            )
            continue
        group = groups[0]
        input_count = float(group.get("input_count") or 0)
        defect_count = (await _fault_counts(db, [group])).get(str(group.get("_id")), 0)
        summaries.append(
            SalesOrderSummary(
                salesOrder=order,
                inputCount=round(input_count),
                defectCount=defect_count,
                rtyRate=round((1 - defect_count / input_count) * 100, 2) if input_count else 100.0,
            )
        )
    return Response(success=True, data=summaries, message=f"查询到 {len(summaries)} 个销售订单")


@router.get("/production-orders/by-sales-order", response_model=Response[list[str]])
async def get_production_orders_by_sales_order(
    salesOrder: str = Query(..., description="销售订单号 (VBELN)"),
):
    db = get_database()
    docs = (
        await db[Collections.SALES_ORDERS_SAP]
        .find(await _sales_filter(db, sales_order=salesOrder), {"aufnr": 1})
        .to_list(length=10_000)
    )
    return Response(success=True, data=sorted(_clean_values([doc.get("aufnr") for doc in docs])))


async def _option_totals(db, field: str) -> list[dict[str, Any]]:
    pipeline = [
        {
            "$match": {
                "gstrs_date": {"$gte": YEAR_START, "$lte": YEAR_END},
                field: {"$nin": [None, ""]},
            }
        },
        {
            "$group": {
                "_id": f"${field}",
                "count": {
                    "$sum": {
                        "$convert": {
                            "input": "$data.WMENG",
                            "to": "double",
                            "onError": 0,
                            "onNull": 0,
                        }
                    }
                },
            }
        },
        {"$sort": {"_id": 1}},
    ]
    return await db[Collections.SALES_ORDERS_SAP].aggregate(pipeline).to_list(length=10_000)


@router.get("/product-models", response_model=Response[list[dict]])
async def get_product_models():
    docs = await _option_totals(get_database(), "data.MAKTX_TH")
    return Response(
        success=True,
        data=[{"model": str(doc["_id"]), "count": round(float(doc["count"]))} for doc in docs],
    )


@router.get("/bases", response_model=Response[list[dict]])
async def get_bases():
    docs = await _option_totals(get_database(), "data.LGORT")
    return Response(
        success=True,
        data=[{"base": str(doc["_id"]), "count": round(float(doc["count"]))} for doc in docs],
    )


@router.get("/customers", response_model=Response[list[str]])
async def get_customers():
    docs = await _option_totals(get_database(), "data.NAME1_ZU")
    return Response(success=True, data=[str(doc["_id"]) for doc in docs])


@router.get("/sales-orders", response_model=Response[list[str]])
async def get_sales_orders(q: str = Query(""), limit: int = Query(10, ge=1, le=50)):
    docs = await _option_totals(get_database(), "data.VBELN")
    orders = [str(doc["_id"]) for doc in docs]
    if q:
        orders = [order for order in orders if q.lower() in order.lower()]
    return Response(success=True, data=orders[:limit], message=f"返回 {min(limit, len(orders))} 条")
