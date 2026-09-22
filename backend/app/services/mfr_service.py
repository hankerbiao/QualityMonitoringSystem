"""MFR dashboard aggregation backed exclusively by the data gateway."""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timezone
from typing import Any

from app.schemas.mfr import (
    MFRDashboardResponse,
    MFRDimensionItem,
    MFRFilters,
    MFRSummary,
    MFRTrendItem,
)
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.data_gateway_client import data_gateway
from app.services.scs_gateway import scs_gateway

MFR_CACHE_TTL_SECONDS = 60.0
_MFR_DASHBOARD_CACHE = AsyncTTLCache()


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


def _order_key(value: Any) -> str:
    """Normalize SAP order numbers that differ only by numeric leading zeroes."""
    text = str(value or "").strip()
    return text.lstrip("0") or "0" if text.isdigit() else text


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


async def build_mfr_dashboard(filters: MFRFilters) -> MFRDashboardResponse:
    key = filters.model_dump_json()
    return await _MFR_DASHBOARD_CACHE.get_or_set(
        key,
        lambda: _build_mfr_dashboard(filters),
        ttl_seconds=MFR_CACHE_TTL_SECONDS,
    )


async def _build_mfr_dashboard(filters: MFRFilters) -> MFRDashboardResponse:
    start = _parse_date(filters.dateFrom)
    end = _parse_date(filters.dateTo)
    if not start or not end or start > end:
        raise ValueError("dateFrom/dateTo 必须是有效的 YYYY-MM-DD 日期范围")
    periods = _month_range(start, end)

    orders: dict[str, dict[str, Any]] = {}

    async def order_documents():
        # MFR needs the complete in-warranty fleet, not only the selected
        # production-date window. The gateway client bounds and caches this.
        items = await data_gateway.all_orders(max_rows=1_000_000)
        for item in items:
            raw = item.get("raw") if isinstance(item.get("raw"), dict) else {}
            data = raw.get("data") if isinstance(raw.get("data"), dict) else raw
            if not data:
                data = {
                    "VBELN": item.get("salesOrder") or "",
                    "MAKTX_TH": item.get("productionModel") or "",
                    "MAKTX": item.get("materialDescription") or "",
                    "WMENG": item.get("orderQuantity") or 0,
                    "GSTRS": item.get("plannedStartDate") or "",
                }
            yield {**raw, "data": data, "quantity": item.get("orderQuantity") or 0}

    async for document in order_documents():
        order_no = str((document.get("data") or {}).get("VBELN") or "").strip()
        if not order_no:
            continue
        order_key = _order_key(order_no)
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
        existing = orders.get(order_key)
        if existing is None:
            orders[order_key] = incoming
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
    doa_rows = await scs_gateway.all("SCS_DOA", company5000="true")
    for document in doa_rows:
        service_no = document["service_order"]
        order_key = _order_key(document["sales_order"])
        if service_no and order_key in order_numbers:
            service_to_order[service_no] = order_key
        order = orders.get(order_key)
        if order is not None:
            if not order["factory_date"]:
                order["factory_date"] = _parse_date(document["factory_date"])
            if not order["warranty_date"]:
                order["warranty_date"] = _parse_date(document["warranty_end_date"])

    # MFR counts valid replacement records (failure events). A machine with
    # multiple distinct failures contributes once per event; this is different
    # from a unique-affected-machine rate.
    faults_by_period_model: dict[tuple[str, str], int] = {}
    if service_to_order:
        changes = await scs_gateway.all(
            "SCS_CHANGE", company5000="true", dateFrom=start.isoformat(), dateTo=end.isoformat()
        )
        for document in changes:
            if document["is_revoked"] or document["change_type"] not in {"换上", "换上-up"}:
                continue
            linked_order = service_to_order.get(document["service_order"])
            operation_date = _parse_date(document["create_at"])
            if not linked_order or not operation_date:
                continue
            period = operation_date.strftime("%Y-%m")
            if period in periods:
                order = orders[linked_order]
                key = (period, order["model"])
                faults_by_period_model[key] = faults_by_period_model.get(key, 0) + 1
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
    for (_period, model), fault_events in faults_by_period_model.items():
        if not filters.model or model == filters.model:
            faults_by_model[model] = faults_by_model.get(model, 0) + fault_events

    fleet_by_model: dict[str, float] = {}
    for (_period, model), value in fleet_by_period_model.items():
        if not filters.model or model == filters.model:
            fleet_by_model[model] = fleet_by_model.get(model, 0) + value

    by_model_keys = set(faults_by_model) | set(fleet_by_model)
    by_model: list[MFRDimensionItem] = []
    for model in sorted(by_model_keys):
        faults = faults_by_model.get(model, 0)
        fleet = fleet_by_model.get(model, 0)
        by_model.append(
            MFRDimensionItem(
                key=model, faultCount=faults, fleetCount=fleet, mfrRate=_rate(faults, fleet)
            )
        )

    trend: list[MFRTrendItem] = []
    for period in periods:
        faults = sum(
            fault_events
            for (item_period, model), fault_events in faults_by_period_model.items()
            if item_period == period and (not filters.model or model == filters.model)
        )
        fleet = sum(
            value
            for (item_period, model), value in fleet_by_period_model.items()
            if item_period == period and (not filters.model or model == filters.model)
        )
        trend.append(
            MFRTrendItem(
                period=period,
                key=period,
                faultCount=faults,
                fleetCount=fleet,
                mfrRate=_rate(faults, fleet),
            )
        )

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
