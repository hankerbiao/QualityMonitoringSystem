"""RTY API calculated from SAP sales-order production quantities and repair records."""

import asyncio
import time
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from loguru import logger

from app.core.logger import audit_log, log_info
from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.common import PaginatedResponse, Response
from app.schemas.rty import DefectDetail, RTYData, SalesOrderSummary, StationPassRate
from app.services import rty_queries as _rty_queries
from app.services.rty_queries import (
    COMPOSITE_MODEL_ITEMS,
    MAX_BINDING_ROW_COUNT,
    MAX_CYCLE_SALES_ROW_COUNT,
    MAX_DETAIL_ROW_COUNT,
    REPAIR_YEAR_END,
    REPAIR_YEAR_START,
)
from app.services.rty_queries import (
    build_sales_filter as _sales_filter,
)
from app.services.rty_queries import (
    group_field as _group_field,
)
from app.services.rty_queries import (
    normalize_order as _normalize_order,
)
from app.services.rty_queries import (
    option_totals as _option_totals,
)
from app.services.rty_queries import (
    order_variants as _order_variants,
)
from app.services.rty_queries import (
    sales_groups as _sales_groups,
)
from app.services.rty_queries import (
    split_values as _split_values,
)
from app.services.station_pass_fields import normalize_station_code

router = APIRouter()

OrderScope = Literal["normal", "l6"]
OrderScopeQuery = Annotated[OrderScope, Query(description="订单范围: normal 或 l6")]
CalculationMethod = Literal["normal", "composite"]
CalculationMethodQuery = Annotated[
    CalculationMethod | None, Query(description="计算方法: normal 或 composite")
]


def _sales_date_match(date_from: str | None, date_to: str | None) -> dict[str, str]:
    return _rty_queries._sales_date_match(date_from, date_to)


def _validate_date(value: str) -> str:
    return _rty_queries.validate_date(value)


def _rty_order_scope_match(order_scope: OrderScope = "normal") -> dict[str, Any]:
    return _rty_queries.rty_order_scope_match(order_scope)


_REPAIR_BUSINESS_KEY_FIELDS = (
    "PCODE",
    "AUFNR",
    "VBELN",
    "ZDATE_WX",
    "ZTIME",
    "ZMCOD1",
    "ZNGWD",
    "ZWXWD",
    "ZJXMC",
    "ZUSER",
)


def _clean_values(values: list[Any]) -> list[str]:
    return sorted({str(value).strip() for value in values if str(value or "").strip()})


def _normalize_sales_order(value: Any) -> str:
    """Use one canonical sales-order representation across SAP clients."""
    return _normalize_order(value)


def _station_code(value: Any) -> str:
    """Normalize station values such as ``M-OP205:初检前测`` to ``OP205``."""
    return normalize_station_code(value)


def _station_record_date(row: dict[str, Any]) -> str:
    """Use the actual station start date, with legacy GSTRS as a fallback."""
    value = row.get("ACTUAL_START_TIME") or row.get("GSTRS")
    return "".join(char for char in str(value or "") if char.isdigit())[:8]


async def _station_pass_rates(
    db: Any, date_from: str | None = None, date_to: str | None = None
) -> list[StationPassRate]:
    """Calculate station RTY from deduplicated station passes and repair records."""
    start = _validate_date(date_from).replace("-", "") if date_from else REPAIR_YEAR_START
    end = _validate_date(date_to).replace("-", "") if date_to else REPAIR_YEAR_END
    if start > end:
        raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期")

    pipeline = [
        {
            "$match": {
                "station_pass_date": {"$gte": start, "$lte": end},
                "station_code_norm": {"$nin": [None, ""]},
                "PCODE": {"$nin": [None, ""]},
            }
        },
        {
            "$group": {
                "_id": {"stationCode": "$station_code_norm", "sn": "$PCODE"},
                "stationName": {"$first": "$station_name_norm"},
                "sourceDocumentCount": {"$sum": 1},
            }
        },
        {
            "$lookup": {
                "from": Collections.REPAIR_RECORDS_SAP,
                "let": {"stationCode": "$_id.stationCode", "sn": "$_id.sn"},
                "pipeline": [
                    {
                        "$match": {
                            "ZDATE_WX": {"$gte": start, "$lte": end},
                            "$expr": {
                                "$and": [
                                    {"$eq": ["$repair_station_code_norm", "$$stationCode"]},
                                    {"$eq": ["$PCODE", "$$sn"]},
                                ]
                            },
                        }
                    },
                    {"$limit": 1},
                ],
                "as": "repairs",
            }
        },
        {
            "$project": {
                "stationCode": "$_id.stationCode",
                "stationName": 1,
                "sourceDocumentCount": 1,
                "isDefect": {"$gt": [{"$size": "$repairs"}, 0]},
            }
        },
        {
            "$group": {
                "_id": "$stationCode",
                "stationName": {"$first": "$stationName"},
                "inputCount": {"$sum": 1},
                "defectCount": {"$sum": {"$cond": ["$isDefect", 1, 0]}},
                "sourceDocumentCount": {"$sum": "$sourceDocumentCount"},
            }
        },
        {"$sort": {"_id": 1}},
    ]
    started_at = time.perf_counter()
    results = (
        await db[Collections.STATION_RECORDS_SAP]
        .aggregate(pipeline, allowDiskUse=True)
        .to_list(None)
    )
    duration_ms = (time.perf_counter() - started_at) * 1000
    input_documents = sum(row.get("sourceDocumentCount", 0) for row in results)
    message = (
        f"station_pass_rates date_from={start} date_to={end} duration_ms={duration_ms:.2f} "
        f"input_documents={input_documents} output_stations={len(results)}"
    )
    if duration_ms > 8_000:
        logger.warning(message)
    else:
        log_info(message)
    return [
        StationPassRate(
            stationCode=row["_id"],
            stationName=row.get("stationName") or "",
            inputCount=row["inputCount"],
            defectCount=row["defectCount"],
            passRate=round((1 - row["defectCount"] / row["inputCount"]) * 100, 2),
        )
        for row in results
    ]


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


async def _composite_bindings(db, head_orders: set[str]) -> list[dict[str, Any]]:
    if not head_orders:
        return []
    return (
        await db[Collections.SERIAL_BINDINGS_SAP]
        .find(
            {"AUFNR_HEAD": {"$in": _order_variants(list(head_orders))}},
            {"AUFNR_HEAD": 1, "AUFNR_ITEM": 1, "ZCODE_HEAD": 1, "ZCODE_ITEM": 1},
        )
        .to_list(length=MAX_BINDING_ROW_COUNT + 1)
    )


async def _composite_child_repairs(
    db,
    head_orders: set[str],
    composite_model: str,
    projection: dict[str, int] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, set[str]]]:
    """Return BOX repairs and the binding from BOX SN to machine-head SN."""
    bindings = await _composite_bindings(db, head_orders)
    if len(bindings) > MAX_BINDING_ROW_COUNT:
        raise HTTPException(status_code=413, detail="刀片绑定记录超过上限 100000，请缩小筛选范围")

    item_to_heads: dict[str, set[str]] = {}
    item_orders: set[str] = set()
    for binding in bindings:
        head_sn = str(binding.get("ZCODE_HEAD") or "").strip()
        item_sn = str(binding.get("ZCODE_ITEM") or "").strip()
        item_order = str(binding.get("AUFNR_ITEM") or "").strip()
        if head_sn and item_sn:
            item_to_heads.setdefault(item_sn, set()).add(head_sn)
        if item_order:
            item_orders.add(item_order)
    if not item_orders:
        return [], item_to_heads

    child_repairs = (
        await db[Collections.REPAIR_RECORDS_SAP]
        .find(
            {
                "AUFNR": {"$in": _order_variants(list(item_orders))},
                "ZDATE_WX": {"$gte": REPAIR_YEAR_START, "$lte": REPAIR_YEAR_END},
                "ZJXMC": {"$in": list(COMPOSITE_MODEL_ITEMS[composite_model])},
            },
            projection,
        )
        .to_list(length=MAX_DETAIL_ROW_COUNT + 1)
    )
    if len(child_repairs) > MAX_DETAIL_ROW_COUNT:
        raise HTTPException(status_code=413, detail="BOX 维修明细超过上限 50000，请缩小筛选范围")
    return _deduplicate_repair_rows(child_repairs), item_to_heads


def _repair_business_key(row: dict[str, Any]) -> tuple[str, ...]:
    """Identify one repair event independently of SAP client and sync metadata."""
    values: list[str] = []
    for field in _REPAIR_BUSINESS_KEY_FIELDS:
        value = row.get(field)
        if field == "AUFNR":
            values.append(_normalize_order(value))
        elif field == "VBELN":
            values.append(_normalize_sales_order(value))
        else:
            values.append(str(value or "").strip())
    return tuple(values)


def _deduplicate_repair_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse cross-client copies using the stable repair business fields."""
    seen: dict[tuple[str, ...], int] = {}
    unique: list[dict[str, Any]] = []
    for row in rows:
        key = _repair_business_key(row)
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

    repairs = await (
        db[Collections.REPAIR_RECORDS_SAP]
        .find(
            {
                "AUFNR": {"$in": _order_variants(list(group_ids_by_order))},
                "ZDATE_WX": {"$gte": REPAIR_YEAR_START, "$lte": REPAIR_YEAR_END},
            },
            {"AUFNR": 1, "PCODE": 1},
        )
        .to_list(length=MAX_DETAIL_ROW_COUNT + 1)
    )
    if len(repairs) > MAX_DETAIL_ROW_COUNT:
        raise HTTPException(status_code=413, detail="维修记录超过上限 50000，请缩小筛选范围")
    failed_sns: dict[str, set[str]] = {group_id: set() for group_id in orders_by_group}
    for repair in repairs:
        order = _normalize_order(repair.get("AUFNR"))
        sn = str(repair.get("PCODE") or "").strip()
        if sn:
            for group_id in group_ids_by_order.get(order, set()):
                failed_sns[group_id].add(sn)

    composite_groups: dict[str, tuple[str, set[str]]] = {}
    for group in groups:
        model = str(((group.get("first") or {}).get("data") or {}).get("MAKTX_TH") or "")
        if model not in COMPOSITE_MODEL_ITEMS:
            continue
        group_id = str(group.get("_id") or "")
        composite_groups[group_id] = (model, orders_by_group[group_id])

    for group_id, (composite_model, head_orders) in composite_groups.items():
        child_repairs, item_to_heads = await _composite_child_repairs(
            db, head_orders, composite_model, projection={"AUFNR": 1, "PCODE": 1}
        )
        for repair in child_repairs:
            failed_sns[group_id].update(
                item_to_heads.get(str(repair.get("PCODE") or "").strip(), set())
            )
    return {group_id: len(sns) for group_id, sns in failed_sns.items()}


async def _cycle_data(db, order_scope: OrderScope, customer: str | None = None) -> list[RTYData]:
    """Build the small monthly/model data set used by the cycle dashboard.

    The detail list is intentionally paginated, but the cycle dashboard needs all
    months.  Computing it once here avoids fetching every detail page and avoids
    repeating the repair query for each page in the browser.
    """
    sales_filter = await _sales_filter(db, customer=customer, order_scope=order_scope)
    sales_docs = await (
        db[Collections.SALES_ORDERS_SAP]
        .find(
            sales_filter,
            {
                "aufnr": 1,
                "gstrs_date": 1,
                "data.VBELN": 1,
                "data.WMENG": 1,
                "data.MAKTX_TH": 1,
                "data.KID": 1,
                "data.LGORT": 1,
            },
        )
        .sort([("gstrs_date", 1), ("aufnr", 1)])
        .to_list(length=MAX_CYCLE_SALES_ROW_COUNT + 1)
    )
    if len(sales_docs) > MAX_CYCLE_SALES_ROW_COUNT:
        raise HTTPException(status_code=413, detail="销售订单周期统计数据超过上限")

    # A sales order can span multiple bases. Keep each base separate so the
    # cycle dashboard can filter it without dropping a later base row.
    order_groups: dict[tuple[str, str], dict[str, Any]] = {}
    order_to_groups: dict[str, set[tuple[str, str]]] = {}
    for doc in sales_docs:
        raw_data = doc.get("data") or {}
        sales_order = str(raw_data.get("VBELN") or "").strip()
        production_order = str(doc.get("aufnr") or "").strip()
        if not sales_order or not production_order:
            continue
        base = str(raw_data.get("LGORT") or "").strip()
        group_id = (sales_order, base)
        group = order_groups.setdefault(
            group_id,
            {
                "month": str(doc.get("gstrs_date") or "")[:7],
                "model": str(raw_data.get("MAKTX_TH") or ""),
                "base": base,
                "input": 0.0,
                "orders": set(),
                "fault_sns": set(),
            },
        )
        group["input"] += _wmeng_value(raw_data.get("WMENG"))
        group["orders"].add(production_order)
        order_to_groups.setdefault(_normalize_order(production_order), set()).add(group_id)

    if not order_groups:
        return []

    repairs = await (
        db[Collections.REPAIR_RECORDS_SAP]
        .find(
            {
                "AUFNR": {
                    "$in": _order_variants(
                        [order for group in order_groups.values() for order in group["orders"]]
                    )
                },
                "ZDATE_WX": {"$gte": REPAIR_YEAR_START, "$lte": REPAIR_YEAR_END},
            },
            {"AUFNR": 1, "PCODE": 1},
        )
        .to_list(length=MAX_DETAIL_ROW_COUNT + 1)
    )
    if len(repairs) > MAX_DETAIL_ROW_COUNT:
        raise HTTPException(status_code=413, detail="维修记录超过上限 50000，请缩小筛选范围")
    for repair in repairs:
        sn = str(repair.get("PCODE") or "").strip()
        if not sn:
            continue
        for group_id in order_to_groups.get(_normalize_order(repair.get("AUFNR")), set()):
            order_groups[group_id]["fault_sns"].add(sn)

    # Composite products count BOX faults against the bound head SN.  Query all
    # bindings and child repairs in bulk instead of once per sales-order group.
    composite_orders_by_model: dict[str, set[str]] = {}
    for group in order_groups.values():
        if group["model"] in COMPOSITE_MODEL_ITEMS:
            composite_orders_by_model.setdefault(group["model"], set()).update(group["orders"])
    if composite_orders_by_model:
        head_order_values = {
            order for orders in composite_orders_by_model.values() for order in orders
        }
        bindings = await (
            db[Collections.SERIAL_BINDINGS_SAP]
            .find(
                {"AUFNR_HEAD": {"$in": _order_variants(list(head_order_values))}},
                {"AUFNR_HEAD": 1, "AUFNR_ITEM": 1, "ZCODE_HEAD": 1, "ZCODE_ITEM": 1},
            )
            .to_list(length=MAX_BINDING_ROW_COUNT + 1)
        )
        if len(bindings) > MAX_BINDING_ROW_COUNT:
            raise HTTPException(
                status_code=413, detail="刀片绑定记录超过上限 100000，请缩小筛选范围"
            )
        item_orders: set[str] = set()
        item_to_heads: dict[str, set[str]] = {}
        item_to_sales: dict[str, set[str]] = {}
        for binding in bindings:
            head_order = _normalize_order(binding.get("AUFNR_HEAD"))
            item_order = str(binding.get("AUFNR_ITEM") or "").strip()
            head_sn = str(binding.get("ZCODE_HEAD") or "").strip()
            item_sn = str(binding.get("ZCODE_ITEM") or "").strip()
            if item_order:
                item_orders.add(item_order)
            if item_sn and head_sn:
                item_to_heads.setdefault(item_sn, set()).add(head_sn)
            if item_order and head_order:
                item_to_sales.setdefault(_normalize_order(item_order), set()).update(
                    order_to_groups.get(head_order, set())
                )
        if item_orders and item_to_heads:
            child_repairs = await (
                db[Collections.REPAIR_RECORDS_SAP]
                .find(
                    {
                        "AUFNR": {"$in": _order_variants(list(item_orders))},
                        "ZDATE_WX": {"$gte": REPAIR_YEAR_START, "$lte": REPAIR_YEAR_END},
                        "ZJXMC": {
                            "$in": [
                                child
                                for model in composite_orders_by_model
                                for child in COMPOSITE_MODEL_ITEMS[model]
                            ]
                        },
                    },
                    {"AUFNR": 1, "PCODE": 1},
                )
                .to_list(length=MAX_DETAIL_ROW_COUNT + 1)
            )
            if len(child_repairs) > MAX_DETAIL_ROW_COUNT:
                raise HTTPException(
                    status_code=413, detail="BOX 维修明细超过上限 50000，请缩小筛选范围"
                )
            for repair in child_repairs:
                head_sns = item_to_heads.get(str(repair.get("PCODE") or "").strip(), set())
                for head_sn in head_sns:
                    for group_id in item_to_sales.get(_normalize_order(repair.get("AUFNR")), set()):
                        order_groups[group_id]["fault_sns"].add(head_sn)

    targets_doc = await db[Collections.CONFIGS].find_one({"key": "model_targets"})
    targets = (targets_doc or {}).get("targets", {}) or {}
    month_groups: dict[tuple[str, str, str], dict[str, Any]] = {}
    for group in order_groups.values():
        key = (group["month"], group["model"], group["base"])
        aggregate = month_groups.setdefault(key, {"input": 0.0, "fault_sns": set()})
        aggregate["input"] += group["input"]
        aggregate["fault_sns"].update(group["fault_sns"])

    rows: list[RTYData] = []
    for (month, model, base), aggregate in sorted(month_groups.items()):
        input_count = round(aggregate["input"])
        defect_count = len(aggregate["fault_sns"])
        rows.append(
            RTYData(
                id=f"cycle:{month}:{model}:{base}",
                time=month,
                model="复合机型" if model in COMPOSITE_MODEL_ITEMS else "普通机型",
                productModel=model,
                customer=str(customer or "").strip(),
                base=base,
                defectCount=defect_count,
                inputCount=input_count,
                rtyRate=round((1 - defect_count / input_count) * 100, 2) if input_count else 100.0,
                targetRate=float(targets.get(model, 100)),
                salesOrder="",
                productionOrder="",
                salesOrders=[],
                productionOrders=[],
                productLine="",
                serialNumbers=[],
                status="",
            )
        )
    return rows


def _wmeng_value(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _repair_to_detail(item: dict[str, Any]) -> DefectDetail:
    return DefectDetail(
        id=str(item.get("_id")),
        defectCode=str(item.get("ZNGWD") or "未知"),
        description=str(item.get("ZWXWD") or ""),
        count=1,
        sn=str(item.get("PCODE") or ""),
        sale_no=_normalize_sales_order(item.get("VBELN")),
        mfg_order=str(item.get("AUFNR") or ""),
        product_family=str(item.get("ZJXMC") or ""),
        fault_2nd_appear="",
        fault_3rd_appear="",
        repairTime=str(item.get("ZDATE_WX") or ""),
        repairPerson=str(item.get("ZUSER") or ""),
        repair_effectiveness="",
        customer=str(item.get("customer") or ""),
    )


async def _repair_details_for_orders(
    db, production_orders: set[str], composite_model: str | None = None
) -> list[DefectDetail]:
    repairs = _deduplicate_repair_rows(await _repair_rows_for_orders(db, production_orders))
    if composite_model in COMPOSITE_MODEL_ITEMS:
        child_repairs, item_to_heads = await _composite_child_repairs(
            db, production_orders, composite_model
        )
        child_repairs = [
            repair
            for repair in child_repairs
            if str(repair.get("PCODE") or "").strip() in item_to_heads
        ]
        repairs = _deduplicate_repair_rows([*repairs, *child_repairs])
    if len(repairs) > MAX_DETAIL_ROW_COUNT:
        raise HTTPException(status_code=413, detail="维修明细超过上限 50000，请缩小筛选范围")
    details = [_repair_to_detail(repair) for repair in repairs]
    details.sort(key=lambda item: item.repairTime, reverse=True)
    return details


@router.get("/cycle-data", response_model=Response[list[RTYData]])
async def get_rty_cycle_data(
    orderScope: OrderScopeQuery = "normal",
    customer: str | None = Query(None, description="客户 ID (data.KID)"),
):
    """Return monthly/model aggregates for the cycle dashboard in one request."""
    rows = await _cycle_data(get_database(), orderScope, customer)
    return Response(success=True, data=rows, message=f"查询到 {len(rows)} 条周期统计数据")


@router.get("/station-pass-rates", response_model=Response[list[StationPassRate]])
async def get_station_pass_rates(
    dateFrom: str | None = Query(None, description="过站日期起始日 (YYYY-MM-DD)"),
    dateTo: str | None = Query(None, description="过站日期截止日 (YYYY-MM-DD)"),
):
    """Return station-level pass rates, matching station SPEC to repair ZNGGZ."""
    rows = await _station_pass_rates(get_database(), dateFrom, dateTo)
    return Response(success=True, data=rows, message=f"查询到 {len(rows)} 个工位")


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
    customer: str | None = Query(None, description="客户 ID (data.KID)"),
    dateFrom: str | None = Query(None, description="生产开始日期 (gstrs_date)"),
    dateTo: str | None = Query(None, description="生产开始日期 (gstrs_date)"),
    orderScope: OrderScopeQuery = "normal",
    calculationMethod: CalculationMethodQuery = None,
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
        order_scope=orderScope,
        calculation_method=calculationMethod,
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
                model="复合机型" if model in COMPOSITE_MODEL_ITEMS else "普通机型",
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
    orderScope: OrderScopeQuery = "normal",
    calculationMethod: CalculationMethodQuery = None,
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
        order_scope=orderScope,
        calculation_method=calculationMethod,
    )
    orders = (
        await db[Collections.SALES_ORDERS_SAP]
        .find(sales_filter, {"aufnr": 1})
        .to_list(length=10_000)
    )
    details = await _repair_details_for_orders(
        db,
        {str(order.get("aufnr") or "") for order in orders},
        productModel if productModel in COMPOSITE_MODEL_ITEMS else None,
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
    orderScope: OrderScopeQuery = "normal",
):
    db = get_database()
    summaries: list[SalesOrderSummary] = []
    for order in _split_values(salesOrders):
        total, groups = await _sales_groups(
            db,
            await _sales_filter(db, sales_order=order, order_scope=orderScope),
            "data.VBELN",
            1,
            1,
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
    orderScope: OrderScopeQuery = "normal",
):
    db = get_database()
    docs = (
        await db[Collections.SALES_ORDERS_SAP]
        .find(await _sales_filter(db, sales_order=salesOrder, order_scope=orderScope), {"aufnr": 1})
        .to_list(length=10_000)
    )
    return Response(success=True, data=sorted(_clean_values([doc.get("aufnr") for doc in docs])))


@router.get("/product-models", response_model=Response[list[dict]])
async def get_product_models(orderScope: OrderScopeQuery = "normal"):
    docs = await _option_totals(get_database(), "data.MAKTX_TH", orderScope)
    return Response(
        success=True,
        data=[{"model": str(doc["_id"]), "count": round(float(doc["count"]))} for doc in docs],
    )


@router.get("/bases", response_model=Response[list[dict]])
async def get_bases(orderScope: OrderScopeQuery = "normal"):
    docs = await _option_totals(get_database(), "data.LGORT", orderScope)
    return Response(
        success=True,
        data=[{"base": str(doc["_id"]), "count": round(float(doc["count"]))} for doc in docs],
    )


@router.get("/customers", response_model=Response[list[str]])
async def get_customers(orderScope: OrderScopeQuery = "normal"):
    docs = await _option_totals(get_database(), "data.KID", orderScope)
    return Response(success=True, data=[str(doc["_id"]) for doc in docs])


@router.get("/filter-options", response_model=Response[dict[str, list]])
async def get_filter_options(orderScope: OrderScopeQuery = "normal"):
    """Load all detail filters with one database round trip from the browser."""
    db = get_database()
    models, bases, customers = await asyncio.gather(
        _option_totals(db, "data.MAKTX_TH", orderScope),
        _option_totals(db, "data.LGORT", orderScope),
        _option_totals(db, "data.KID", orderScope),
    )
    return Response(
        success=True,
        data={
            "productModels": [
                {"model": str(doc["_id"]), "count": round(float(doc["count"]))} for doc in models
            ],
            "bases": [
                {"base": str(doc["_id"]), "count": round(float(doc["count"]))} for doc in bases
            ],
            "customers": [str(doc["_id"]) for doc in customers],
        },
    )


@router.get("/sales-orders", response_model=Response[list[str]])
async def get_sales_orders(
    q: str = Query(""),
    limit: int = Query(10, ge=1, le=50),
    orderScope: OrderScopeQuery = "normal",
):
    docs = await _option_totals(get_database(), "data.VBELN", orderScope)
    orders = [str(doc["_id"]) for doc in docs]
    if q:
        orders = [order for order in orders if q.lower() in order.lower()]
    return Response(success=True, data=orders[:limit], message=f"返回 {min(limit, len(orders))} 条")
