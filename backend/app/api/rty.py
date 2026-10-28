"""RTY HTTP endpoints backed exclusively by the data-gateway service."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response as HTTPResponse

from app.auth_permissions import dashboard_dependency
from app.core.logger import audit_log
from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.common import PaginatedResponse, Response
from app.schemas.rty import (
    DefectDetail,
    ExcludedOrder,
    RTYCycleDetails,
    RTYData,
    RTYTemplateExport,
    SalesOrderSummary,
    StationPassDetail,
    StationPassExport,
    StationPassRate,
)
from app.services import cycle_details, reinsert_rate, repair_quality, rty_export, rty_gateway
from app.services.rty_shared import YEAR_END, YEAR_START, validate_date
from app.services.settings_service import SettingsService

router = APIRouter()

OrderScope = Literal["normal", "l6"]
OrderScopeQuery = Annotated[OrderScope, Query(description="订单范围: normal 或 l6")]
CalculationMethod = Literal["normal", "composite"]
CalculationMethodQuery = Annotated[
    CalculationMethod | None, Query(description="计算方法: normal 或 composite")
]
StationGroupBy = Literal["salesOrder", "productionOrder", "productModel"]
StationGroupByQuery = Annotated[StationGroupBy, Query(description="统计维度")]


async def require_reinsert_access(
    user: Annotated[dict, Depends(dashboard_dependency("reinsert-rate"))],
):
    if user.get("role") != "admin":
        statuses = await SettingsService(get_database()).get_dashboard_statuses()
        if statuses["reinsert-rate"] == "admin-only":
            raise HTTPException(status_code=403, detail="重插率分析仅管理员可见")
    return user


@router.get("/reinsert-rate/options", dependencies=[Depends(require_reinsert_access)])
async def get_reinsert_options():
    return Response(success=True, data=await repair_quality.options())


@router.get("/reinsert-rate", dependencies=[Depends(require_reinsert_access)])
async def get_reinsert_rate(
    dateFrom: str, dateTo: str,
    productModels: Annotated[list[str] | None, Query()] = None,
    customers: Annotated[list[str] | None, Query()] = None,
    bases: Annotated[list[str] | None, Query()] = None,
):
    orders, faults, usage, _ = await reinsert_rate.load_sources(
        dateFrom, dateTo, productModels, customers, bases
    )
    return Response(success=True, data=reinsert_rate.aggregate(orders, faults, usage, dateFrom, dateTo))


@router.get("/reinsert-rate/details", dependencies=[Depends(require_reinsert_access)])
async def get_reinsert_details(
    dateFrom: str, dateTo: str,
    kind: Literal["reinsert", "repairs", "orders", "postings", "invalid"],
    base: str = "", month: str = "", component: str = "", pn: str = "", model: str | None = None,
    productModels: Annotated[list[str] | None, Query()] = None,
    customers: Annotated[list[str] | None, Query()] = None,
    bases: Annotated[list[str] | None, Query()] = None,
    page: int = Query(1, ge=1), pageSize: int = Query(50, ge=1, le=200),
):
    if kind != "invalid" and (not base or month not in reinsert_rate._months(
        validate_date(dateFrom), validate_date(dateTo)
    )):
        raise HTTPException(status_code=422, detail="请选择有效的基地和月份")
    if kind == "postings" and (not component or not pn):
        raise HTTPException(status_code=422, detail="发料明细需要部件和PN")
    orders, faults, usage, postings = await reinsert_rate.load_sources(
        dateFrom, dateTo, productModels, customers, bases
    )
    return Response(success=True, data=reinsert_rate.details(
        orders, faults, usage, postings, base, month, component, pn, kind, page, pageSize, model
    ))


async def require_repair_quality_access(
    user: Annotated[dict, Depends(dashboard_dependency("repair-quality"))],
):
    if user.get("role") != "admin":
        statuses = await SettingsService(get_database()).get_dashboard_statuses()
        if statuses["repair-quality"] == "admin-only":
            raise HTTPException(status_code=403, detail="维修通过率分析仅管理员可见")
    return user


@router.get(
    "/repair-quality",
    response_model=Response[dict],
    dependencies=[Depends(require_repair_quality_access)],
)
async def get_repair_quality(
    dateFrom: str = Query(...),
    dateTo: str = Query(...),
    productModels: Annotated[list[str] | None, Query()] = None,
    customers: Annotated[list[str] | None, Query()] = None,
    bases: Annotated[list[str] | None, Query()] = None,
):
    data = await repair_quality.analyze(
        dateFrom,
        dateTo,
        product_models=productModels,
        customers=customers,
        bases=bases,
    )
    return Response(success=True, data=data, message=f"分析到 {data['snCount']} 个维修 SN")


@router.get(
    "/repair-quality/options",
    response_model=Response[dict[str, list[str]]],
    dependencies=[Depends(require_repair_quality_access)],
)
async def get_repair_quality_options():
    return Response(success=True, data=await repair_quality.options())


@router.get(
    "/repair-quality/details",
    response_model=Response[dict],
    dependencies=[Depends(require_repair_quality_access)],
)
async def get_repair_quality_details(
    dateFrom: str = Query(...),
    dateTo: str = Query(...),
    customer: str = Query(..., min_length=1),
    base: str = Query(..., min_length=1),
    bucket: Literal["all", "1", "2", "3", "4", "5", "6", "7", "8", "9+"] = "all",
    productModels: Annotated[list[str] | None, Query()] = None,
    customers: Annotated[list[str] | None, Query()] = None,
    bases: Annotated[list[str] | None, Query()] = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(50, ge=1, le=200),
    exportAll: bool = False,
):
    data = await repair_quality.details(
        dateFrom, dateTo, customer, base, bucket,
        product_models=productModels, customers=customers, bases=bases,
        page=page, page_size=pageSize, export_all=exportAll,
    )
    return Response(success=True, data=data)


@router.get(
    "/repair-quality/export",
    response_model=Response[dict],
    dependencies=[Depends(require_repair_quality_access)],
)
async def get_repair_quality_export(
    dateFrom: str = Query(...),
    dateTo: str = Query(...),
    productModels: Annotated[list[str] | None, Query()] = None,
    customers: Annotated[list[str] | None, Query()] = None,
    bases: Annotated[list[str] | None, Query()] = None,
):
    data = await repair_quality.build_export(
        dateFrom, dateTo, product_models=productModels, customers=customers, bases=bases
    )
    return Response(success=True, data=data)


def _split_values(value: str) -> list[str]:
    return [item.strip() for item in value.replace("，", ",").split(",") if item.strip()]


def _order_filters(
    *,
    sales_order: str | None = None,
    production_order: str | None = None,
    serial_number: str | None = None,
    base: str | None = None,
    product_model: str | None = None,
    customer: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    order_scope: OrderScope = "normal",
    calculation_method: CalculationMethod | None = None,
    overseas: str = "",
) -> dict[str, str]:
    result = {
        "salesOrder": sales_order or "",
        "productionOrder": production_order or "",
        "serialNumber": serial_number or "",
        "base": base or "",
        "productModel": product_model or "",
        "customer": customer or "",
        "dateFrom": date_from or YEAR_START,
        "dateTo": date_to or YEAR_END,
        "orderScope": order_scope,
        "calculationMethod": calculation_method or "",
    }
    if overseas:
        result["overseas"] = overseas
    return result


async def _targets() -> dict[str, float]:
    document = await get_database()[Collections.CONFIGS].find_one({"key": "model_targets"})
    return (document or {}).get("targets", {}) or {}


@router.get(
    "/cycle-data",
    response_model=Response[list[RTYData]],
    dependencies=[Depends(dashboard_dependency("rty"))],
)
async def get_rty_cycle_data(
    orderScope: OrderScopeQuery = "normal",
    customer: str | None = None,
    customers: Annotated[list[str] | None, Query()] = None,
    dateFrom: str | None = None,
    dateTo: str | None = None,
):
    date_from = validate_date(dateFrom) if dateFrom else YEAR_START
    date_to = validate_date(dateTo) if dateTo else YEAR_END
    if date_from > date_to:
        raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期")

    rows = await rty_gateway.cycle_data(
        orderScope,
        customer,
        await _targets(),
        customers=customers,
        date_from=date_from,
        date_to=date_to,
    )
    return Response(success=True, data=rows, message=f"查询到 {len(rows)} 条周期统计数据")


@router.get(
    "/station-pass-rates",
    response_model=Response[list[StationPassRate]],
    dependencies=[Depends(dashboard_dependency("station-pass-rate"))],
)
async def get_station_pass_rates(
    dateFrom: str | None = None,
    dateTo: str | None = None,
    serialNumber: str | None = None,
    productModels: Annotated[list[str] | None, Query()] = None,
    customers: Annotated[list[str] | None, Query()] = None,
    bases: Annotated[list[str] | None, Query()] = None,
    productModel: str | None = None,
    customer: str | None = None,
    base: str | None = None,
    groupBy: StationGroupByQuery = "salesOrder",
    orderScope: OrderScopeQuery = "normal",
    overseas: bool = False,
):
    rows = await rty_gateway.station_rates(
        dateFrom,
        dateTo,
        serialNumber,
        [*(productModels or []), *([productModel] if productModel else [])],
        [*(bases or []), *([base] if base else [])],
        groupBy,
        orderScope,
        customers=[*(customers or []), *([customer] if customer else [])],
        overseas=overseas,
    )
    return Response(success=True, data=rows, message=f"查询到 {len(rows)} 个工位")


@router.get(
    "/station-pass-details",
    response_model=Response[list[StationPassDetail]],
    dependencies=[Depends(dashboard_dependency("station-pass-rate"))],
)
async def get_station_pass_details(
    stationCode: str = Query(..., min_length=1),
    dateFrom: str | None = None,
    dateTo: str | None = None,
    detailType: Literal["input", "defect"] = "input",
    serialNumber: str | None = None,
    productModels: Annotated[list[str] | None, Query()] = None,
    customers: Annotated[list[str] | None, Query()] = None,
    bases: Annotated[list[str] | None, Query()] = None,
    productModel: str | None = None,
    customer: str | None = None,
    base: str | None = None,
    groupBy: StationGroupBy = "salesOrder",
    dimensionValue: str | None = None,
    orderScope: OrderScopeQuery = "normal",
    overseas: bool = False,
):
    rows = await rty_gateway.station_details(
        stationCode.strip(),
        dateFrom,
        dateTo,
        detailType,
        serial_number=serialNumber,
        product_models=[*(productModels or []), *([productModel] if productModel else [])],
        bases=[*(bases or []), *([base] if base else [])],
        group_by=groupBy,
        dimension_value=dimensionValue,
        order_scope=orderScope,
        customers=[*(customers or []), *([customer] if customer else [])],
        overseas=overseas,
    )
    return Response(success=True, data=rows, message=f"查询到 {len(rows)} 条明细")


@router.get(
    "/station-pass-export",
    response_model=Response[StationPassExport],
    dependencies=[Depends(dashboard_dependency("station-pass-rate"))],
)
@audit_log("QUERY", "station_pass_export")
async def get_station_pass_export(
    request: Request,
    dateFrom: str | None = None,
    dateTo: str | None = None,
    serialNumber: str | None = None,
    productModels: Annotated[list[str] | None, Query()] = None,
    customers: Annotated[list[str] | None, Query()] = None,
    bases: Annotated[list[str] | None, Query()] = None,
    productModel: str | None = None,
    customer: str | None = None,
    base: str | None = None,
    orderScope: OrderScopeQuery = "normal",
    overseas: bool = False,
):
    del request
    data = await rty_export.build_export_response(
        "source",
        _order_filters(
            serial_number=serialNumber,
            base=base,
            product_model=productModel,
            customer=customer,
            date_from=dateFrom,
            date_to=dateTo,
            order_scope=orderScope,
            overseas="true" if overseas else "",
        ),
        product_models=productModels,
        bases=bases,
        customers=customers,
    )
    return HTTPResponse(
        data, media_type="application/json", headers={"Cache-Control": "private, no-store"}
    )


@router.get(
    "/cycle-details",
    response_model=Response[RTYCycleDetails],
    dependencies=[Depends(dashboard_dependency("rty"))],
)
@audit_log("QUERY", "rty_cycle_details")
async def get_cycle_details(
    request: Request,
    dateFrom: str | None = None,
    dateTo: str | None = None,
    customer: str | None = None,
    orderScope: OrderScopeQuery = "normal",
    productModels: Annotated[list[str] | None, Query()] = None,
    bases: Annotated[list[str] | None, Query()] = None,
    customers: Annotated[list[str] | None, Query()] = None,
):
    del request
    data = await cycle_details.build_cycle_details(
        _order_filters(
            date_from=dateFrom,
            date_to=dateTo,
            customer=customer,
            order_scope=orderScope,
        ),
        product_models=productModels,
        bases=bases,
        customers=[*(customers or []), *([customer] if customer else [])],
    )
    return Response(
        success=True,
        data=data,
        message=f"查询到 {len(data.orders)} 个订单、{len(data.faults)} 条维修明细",
    )


@router.get(
    "/cycle-export",
    response_model=Response[StationPassExport],
    dependencies=[Depends(dashboard_dependency("rty"))],
)
@audit_log("QUERY", "rty_cycle_export")
async def get_cycle_export(
    request: Request,
    dateFrom: str | None = None,
    dateTo: str | None = None,
    customer: str | None = None,
    orderScope: OrderScopeQuery = "normal",
    productModels: Annotated[list[str] | None, Query()] = None,
    bases: Annotated[list[str] | None, Query()] = None,
    customers: Annotated[list[str] | None, Query()] = None,
):
    del request
    data = await rty_export.build_export_response(
        "source",
        _order_filters(
            date_from=dateFrom,
            date_to=dateTo,
            customer=customer,
            order_scope=orderScope,
        ),
        product_models=productModels,
        bases=bases,
        customers=[*(customers or []), *([customer] if customer else [])],
    )
    return HTTPResponse(
        data, media_type="application/json", headers={"Cache-Control": "private, no-store"}
    )


@router.get(
    "/export",
    response_model=Response[RTYTemplateExport],
    dependencies=[Depends(dashboard_dependency("rty"))],
)
@audit_log("QUERY", "rty_template_export")
async def get_rty_template_export(
    request: Request,
    salesOrder: str | None = None,
    productionOrder: str | None = None,
    serialNumber: str | None = None,
    base: str | None = None,
    productModel: str | None = None,
    customer: str | None = None,
    dateFrom: str | None = None,
    dateTo: str | None = None,
    orderScope: OrderScopeQuery = "normal",
    calculationMethod: CalculationMethodQuery = None,
    productModels: Annotated[list[str] | None, Query()] = None,
    bases: Annotated[list[str] | None, Query()] = None,
    customers: Annotated[list[str] | None, Query()] = None,
):
    del request
    data = await rty_export.build_export_response(
        "template",
        _order_filters(
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
        ),
        product_models=productModels,
        bases=bases,
        customers=customers,
    )
    return HTTPResponse(
        data, media_type="application/json", headers={"Cache-Control": "private, no-store"}
    )


@router.get(
    "/list",
    response_model=PaginatedResponse[RTYData],
    dependencies=[Depends(dashboard_dependency("rty"))],
)
@audit_log("QUERY", "rty_list")
async def get_rty_list(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    salesOrder: str | None = None,
    productionOrder: str | None = None,
    serialNumber: str | None = None,
    base: str | None = None,
    productModel: str | None = None,
    customer: str | None = None,
    dateFrom: str | None = None,
    dateTo: str | None = None,
    orderScope: OrderScopeQuery = "normal",
    calculationMethod: CalculationMethodQuery = None,
    productModels: Annotated[list[str] | None, Query()] = None,
    bases: Annotated[list[str] | None, Query()] = None,
    customers: Annotated[list[str] | None, Query()] = None,
):
    del request
    return await rty_gateway.rty_list(
        {**_order_filters(
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
        ), "_productModels": productModels or [], "_bases": bases or [], "_customers": customers or []},
        page,
        limit,
        await _targets(),
    )


@router.get(
    "/excluded-orders",
    response_model=PaginatedResponse[ExcludedOrder],
    dependencies=[Depends(dashboard_dependency("rty"))],
)
@audit_log("QUERY", "rty_excluded_orders")
async def get_excluded_orders(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    salesOrder: str | None = None,
    productionOrder: str | None = None,
    serialNumber: str | None = None,
    base: str | None = None,
    productModel: str | None = None,
    customer: str | None = None,
    dateFrom: str | None = None,
    dateTo: str | None = None,
    orderScope: OrderScopeQuery = "normal",
    productModels: Annotated[list[str] | None, Query()] = None,
    bases: Annotated[list[str] | None, Query()] = None,
    customers: Annotated[list[str] | None, Query()] = None,
):
    del request
    return await rty_gateway.excluded_orders(
        {**_order_filters(
            sales_order=salesOrder,
            production_order=productionOrder,
            serial_number=serialNumber,
            base=base,
            product_model=productModel,
            customer=customer,
            date_from=dateFrom,
            date_to=dateTo,
            order_scope=orderScope,
        ), "_productModels": productModels or [], "_bases": bases or [], "_customers": customers or []},
        page,
        limit,
    )


@router.get(
    "/defects/by-filters",
    response_model=Response[list[DefectDetail]],
    dependencies=[Depends(dashboard_dependency("rty"))],
)
@audit_log("QUERY", "defect_by_filters")
async def get_defect_details_by_filters(
    request: Request,
    salesOrder: str | None = None,
    productionOrder: str | None = None,
    serialNumber: str | None = None,
    base: str | None = None,
    productModel: str | None = None,
    customer: str | None = None,
    dateFrom: str | None = None,
    dateTo: str | None = None,
    orderScope: OrderScopeQuery = "normal",
    calculationMethod: CalculationMethodQuery = None,
    productModels: Annotated[list[str] | None, Query()] = None,
    bases: Annotated[list[str] | None, Query()] = None,
    customers: Annotated[list[str] | None, Query()] = None,
):
    del request, calculationMethod
    filters = _order_filters(
        sales_order=salesOrder,
        production_order=productionOrder,
        serial_number=serialNumber,
        base=base,
        product_model=productModel,
        customer=customer,
        date_from=dateFrom,
        date_to=dateTo,
        order_scope=orderScope,
    )
    filters.update(
        _productModels=productModels or [],
        _bases=bases or [],
        _customers=customers or [],
    )
    orders = await rty_gateway._orders(filters)
    rows = await rty_gateway.details_by_orders(
        {row["aufnr"] for row in orders},
        productModel,
    )
    return Response(success=True, data=rows, message="网关故障明细查询完成")


@router.get(
    "/defects",
    response_model=Response[list[DefectDetail]],
    dependencies=[Depends(dashboard_dependency("rty"))],
)
async def get_defect_details(sns: str = Query(..., description="机器序列号列表，逗号分隔")):
    values = _split_values(sns)
    if not values:
        return Response(success=True, data=[], message="无 SN 参数")
    rows = await rty_gateway._faults_for_sns(set(values))
    rows = await rty_gateway.authorized_fault_rows(rows)
    data = [rty_gateway.to_detail(row) for row in rty_gateway._dedup_faults(rows)]
    return Response(success=True, data=data, message=f"查询到 {len(data)} 条维修故障记录")


@router.get(
    "/defects/by-order",
    response_model=Response[list[DefectDetail]],
    dependencies=[Depends(dashboard_dependency("rty"))],
)
async def get_defect_details_by_order(productionOrder: str = Query(...)):
    rows = await rty_gateway.details_by_orders(set(_split_values(productionOrder)))
    return Response(success=True, data=rows, message="网关故障明细查询完成")


@router.get(
    "/sales-order-summary",
    response_model=Response[list[SalesOrderSummary]],
    dependencies=[Depends(dashboard_dependency("rty"))],
)
async def get_sales_order_summary(
    salesOrders: str = Query(...), orderScope: OrderScopeQuery = "normal"
):
    rows = await rty_gateway.sales_order_summary(_split_values(salesOrders), orderScope)
    return Response(success=True, data=rows, message="网关销售订单汇总完成")


async def _scope_orders(order_scope: OrderScope) -> list[dict[str, object]]:
    return await rty_gateway._orders(
        {"orderScope": order_scope, "dateFrom": YEAR_START, "dateTo": YEAR_END}
    )


@router.get(
    "/production-orders/by-sales-order",
    response_model=Response[list[str]],
    dependencies=[Depends(dashboard_dependency("rty"))],
)
async def get_production_orders_by_sales_order(
    salesOrder: str = Query(...), orderScope: OrderScopeQuery = "normal"
):
    rows = await rty_gateway._orders({"salesOrder": salesOrder, "orderScope": orderScope})
    return Response(success=True, data=sorted({str(row["aufnr"]) for row in rows}))


def _option_totals(rows: list[dict[str, object]], field: str) -> dict[str, float]:
    totals: dict[str, float] = {}
    for row in rows:
        data = row.get("data") if isinstance(row.get("data"), dict) else {}
        value = str(data.get(field) or "").strip()
        if not value:
            continue
        raw_quantity = data.get("WMENG") or 0
        try:
            totals[value] = totals.get(value, 0) + float(raw_quantity)
        except (TypeError, ValueError):
            continue
    return totals


@router.get(
    "/product-models",
    response_model=Response[list[dict[str, object]]],
    dependencies=[Depends(dashboard_dependency(("rty", "station-pass-rate")))],
)
async def get_product_models(orderScope: OrderScopeQuery = "normal"):
    totals = _option_totals(await _scope_orders(orderScope), "MAKTX_TH")
    return Response(
        success=True,
        data=[{"model": key, "count": round(value)} for key, value in sorted(totals.items())],
    )


@router.get(
    "/bases",
    response_model=Response[list[dict[str, object]]],
    dependencies=[Depends(dashboard_dependency(("rty", "station-pass-rate")))],
)
async def get_bases(orderScope: OrderScopeQuery = "normal"):
    totals = _option_totals(await _scope_orders(orderScope), "LGORT")
    return Response(
        success=True,
        data=[{"base": key, "count": round(value)} for key, value in sorted(totals.items())],
    )


@router.get(
    "/customers",
    response_model=Response[list[str]],
    dependencies=[Depends(dashboard_dependency(("rty", "station-pass-rate")))],
)
async def get_customers(orderScope: OrderScopeQuery = "normal"):
    return Response(
        success=True, data=sorted(_option_totals(await _scope_orders(orderScope), "KID"))
    )


@router.get(
    "/filter-options",
    response_model=Response[dict[str, list]],
    dependencies=[Depends(dashboard_dependency(("rty", "station-pass-rate")))],
)
async def get_filter_options(orderScope: OrderScopeQuery = "normal"):
    rows = await _scope_orders(orderScope)
    models = _option_totals(rows, "MAKTX_TH")
    bases = _option_totals(rows, "LGORT")
    return Response(
        success=True,
        data={
            "productModels": [
                {"model": key, "count": round(value)} for key, value in sorted(models.items())
            ],
            "bases": [{"base": key, "count": round(value)} for key, value in sorted(bases.items())],
            "customers": sorted(_option_totals(rows, "KID")),
        },
    )


@router.get(
    "/sales-orders",
    response_model=Response[list[str]],
    dependencies=[Depends(dashboard_dependency("rty"))],
)
async def get_sales_orders(
    q: str = "", limit: int = Query(10, ge=1, le=50), orderScope: OrderScopeQuery = "normal"
):
    rows = await _scope_orders(orderScope)
    orders = sorted(_option_totals(rows, "VBELN"))
    if q:
        orders = [order for order in orders if q.lower() in order.lower()]
    return Response(success=True, data=orders[:limit], message=f"返回 {min(limit, len(orders))} 条")
