"""MFR dashboard aggregation.

The change collection deliberately remains free of derived 5000-company fields.
Change rows are associated to 5000 orders through the existing service-order ->
DOA -> sales-order relationship.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timezone
from typing import Any

from app.models.documents import Collections
from app.schemas.mfr import (
    MFRDashboardResponse,
    MFRDimensionItem,
    MFRFilters,
    MFRSummary,
    MFRTrendItem,
)


def _parse_date(value: Any) -> date | None:
    if value is None:
        return None
    text = str(value).strip().replace("/", "-")
    if not text:
        return None
    for candidate in (text[:10], text[:8]):
        for fmt in ("%Y-%m-%d", "%Y%m%d"):
            try:
                return datetime.strptime(candidate, fmt).date()
            except ValueError:
                continue
    return None


def _first_date(document: dict[str, Any], paths: tuple[tuple[str, ...], ...]) -> date | None:
    for path in paths:
        value: Any = document
        for part in path:
            if not isinstance(value, dict):
                value = None
                break
            value = value.get(part)
        parsed = _parse_date(value)
        if parsed:
            return parsed
    return None


def _model(data: dict[str, Any]) -> str:
    return str(data.get("MAKTX_TH") or data.get("CPXH") or data.get("MAKTX") or "未知机型").strip()


def _quantity(document: dict[str, Any]) -> float:
    value = document.get("quantity")
    if value in (None, ""):
        data = document.get("data") or {}
        value = data.get("WMENG", data.get("GAMNG", 0))
    try:
        return max(float(str(value).replace(",", "")), 0)
    except (TypeError, ValueError):
        return 0


def _month_range(start: date, end: date) -> list[str]:
    current = date(start.year, start.month, 1)
    last = date(end.year, end.month, 1)
    result: list[str] = []
    while current <= last:
        result.append(current.strftime("%Y-%m"))
        if current.month == 12:
            current = date(current.year + 1, 1, 1)
        else:
            current = date(current.year, current.month + 1, 1)
    return result


def _month_point(period: str) -> date:
    year, month = (int(part) for part in period.split("-"))
    month_end = date(year, month, monthrange(year, month)[1])
    today = datetime.now(timezone.utc).date()
    return min(month_end, today)


def _rate(faults: int, fleet: float) -> float | None:
    return round(faults / fleet * 100, 2) if fleet > 0 else None


async def build_mfr_dashboard(
    db: Any,
    filters: MFRFilters,
) -> MFRDashboardResponse:
    start = _parse_date(filters.dateFrom)
    end = _parse_date(filters.dateTo)
    if not start or not end or start > end:
        raise ValueError("dateFrom/dateTo 必须是有效的 YYYY-MM-DD 日期范围")
    periods = _month_range(start, end)

    orders: dict[str, dict[str, Any]] = {}
    orders_collection = db[Collections.SALES_ORDERS_SAP]
    order_projection = {
        "data.VBELN": 1,
        "data.MAKTX_TH": 1,
        "data.CPXH": 1,
        "data.MAKTX": 1,
        "data.WMENG": 1,
        "data.GAMNG": 1,
        "data.出厂日期": 1,
        "data.生产日期": 1,
        "data.FACTORY_DATE": 1,
        "data.保修结束日期": 1,
        "data.质保到期日": 1,
        "data.WARRANTY_END_DATE": 1,
        "quantity": 1,
        "factory_date": 1,
        "warranty_end_date": 1,
    }
    async for document in orders_collection.find({}, projection=order_projection):
        order_no = str((document.get("data") or {}).get("VBELN") or "").strip()
        if not order_no:
            continue
        data = document.get("data") or {}
        factory_date = _first_date(
            document,
            (
                ("factory_date",),
                ("data", "出厂日期"),
                ("data", "生产日期"),
                ("data", "FACTORY_DATE"),
            ),
        )
        warranty_date = _first_date(
            document,
            (
                ("warranty_end_date",),
                ("data", "保修结束日期"),
                ("data", "质保到期日"),
                ("data", "WARRANTY_END_DATE"),
            ),
        )
        incoming = {
            "model": _model(data),
            "quantity": _quantity(document),
            "factory_date": factory_date,
            "warranty_date": warranty_date,
        }
        existing = orders.get(order_no)
        if existing is None:
            orders[order_no] = incoming
        else:
            # A VBELN can have multiple AUFNR/line documents. Sum quantities,
            # while retaining the first complete lifecycle date pair.
            existing["quantity"] += incoming["quantity"]
            if not existing["factory_date"]:
                existing["factory_date"] = incoming["factory_date"]
            if not existing["warranty_date"]:
                existing["warranty_date"] = incoming["warranty_date"]

    order_numbers = set(orders)
    service_to_order: dict[str, str] = {}
    doa_collection = db[Collections.SCS_DOA_RESULTS]
    # Resolve the 5000 scope from the current sales-order universe rather than
    # copying is_5000 onto change rows or trusting a stale derived flag.
    if order_numbers:
        order_numbers_list = list(order_numbers)
        doa_query = {
            "$or": [
                {"scs_enrichment.sales_order": {"$in": order_numbers_list}},
                {"data.销售订单号": {"$in": order_numbers_list}},
            ]
        }
        doa_projection = {
            "data.服务单号": 1,
            "data.销售订单号": 1,
            "scs_enrichment.sales_order": 1,
        }
        async for document in doa_collection.find(doa_query, projection=doa_projection):
            data = document.get("data") or {}
            enrichment = document.get("scs_enrichment") or {}
            service_no = str(data.get("服务单号") or "").strip()
            order_no = str(enrichment.get("sales_order") or data.get("销售订单号") or "").strip()
            if service_no and order_no in order_numbers:
                service_to_order[service_no] = order_no

    faults_by_period_model: dict[tuple[str, str], set[str]] = {}
    change_collection = db[Collections.SCS_CHANGE_RESULTS]
    if service_to_order:
        change_query = {
            "data.服务单号": {"$in": list(service_to_order)},
            "data.操作类型": {"$in": ["换上", "换上-up"]},
            "data.操作时间": {
                "$gte": f"{start.isoformat()} 00:00:00",
                "$lte": f"{end.isoformat()} 23:59:59",
            },
        }
        change_projection = {
            "_id": 1,
            "data.是否撤销": 1,
            "data.服务单号": 1,
            "data.操作时间": 1,
            "data.报修设备": 1,
        }
        async for document in change_collection.find(change_query, projection=change_projection):
            data = document.get("data") or {}
            if str(data.get("是否撤销") or "").strip() == "是":
                continue
            order_no = service_to_order.get(str(data.get("服务单号") or "").strip())
            if not order_no:
                continue
            operation_date = _parse_date(data.get("操作时间"))
            if not operation_date:
                continue
            period = operation_date.strftime("%Y-%m")
            if period not in periods:
                continue
            order = orders[order_no]
            identity = str(data.get("报修设备") or data.get("服务单号") or document.get("_id"))
            faults_by_period_model.setdefault((period, order["model"]), set()).add(identity)

    month_points = {period: _month_point(period) for period in periods}
    fleet_by_period_model: dict[tuple[str, str], float] = {}
    with_dates = missing_dates = 0
    for order in orders.values():
        if order["factory_date"] and order["warranty_date"]:
            with_dates += 1
        else:
            missing_dates += 1
        for period, point in month_points.items():
            if (
                order["factory_date"]
                and order["warranty_date"]
                and order["factory_date"] <= point <= order["warranty_date"]
            ):
                key = (period, order["model"])
                fleet_by_period_model[key] = fleet_by_period_model.get(key, 0) + order["quantity"]

    faults_by_model: dict[str, int] = {}
    for (_period, model), identities in faults_by_period_model.items():
        if not filters.model or model == filters.model:
            faults_by_model[model] = faults_by_model.get(model, 0) + len(identities)

    fleet_by_model: dict[str, float] = {}
    for (_period, model), value in fleet_by_period_model.items():
        if not filters.model or model == filters.model:
            fleet_by_model[model] = fleet_by_model.get(model, 0) + value

    by_model_keys = set(faults_by_model) | set(fleet_by_model)
    by_model: list[MFRDimensionItem] = []
    for model in sorted(by_model_keys):
        faults = faults_by_model.get(model, 0)
        fleet = fleet_by_model.get(model, 0)
        by_model.append(MFRDimensionItem(key=model, faultCount=faults, fleetCount=fleet, mfrRate=_rate(faults, fleet)))

    trend: list[MFRTrendItem] = []
    for period in periods:
        faults = sum(
            len(identities)
            for (item_period, model), identities in faults_by_period_model.items()
            if item_period == period and (not filters.model or model == filters.model)
        )
        fleet = sum(
            value
            for (item_period, model), value in fleet_by_period_model.items()
            if item_period == period and (not filters.model or model == filters.model)
        )
        trend.append(MFRTrendItem(period=period, key=period, faultCount=faults, fleetCount=fleet, mfrRate=_rate(faults, fleet)))

    fault_count = sum(item.faultCount for item in by_model)
    fleet_count = sum(item.fleetCount for item in by_model)
    total_orders = with_dates + missing_dates
    coverage = round(with_dates / total_orders * 100, 2) if total_orders else 0
    return MFRDashboardResponse(
        filters=filters,
        summary=MFRSummary(
            faultCount=fault_count,
            fleetCount=fleet_count,
            mfrRate=_rate(fault_count, fleet_count),
            warrantyDateCoverage=coverage,
            ordersWithWarrantyDates=with_dates,
            ordersMissingWarrantyDates=missing_dates,
        ),
        trend=trend,
        byModel=by_model,
    )
