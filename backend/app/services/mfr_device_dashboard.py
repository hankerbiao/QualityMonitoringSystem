"""MFR aggregation for DOA devices grouped by DOA declaration date."""

from __future__ import annotations

import asyncio
from collections import Counter, defaultdict
from datetime import date, timedelta

from app.schemas.mfr import (
    MFRChangeIssueDetail,
    MFRDailyTrendItem,
    MFRDashboardResponse,
    MFRFaultDetail,
    MFRFilters,
    MFRSummary,
    MFRTrendItem,
)
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.data_gateway_client import DataGatewayError, data_gateway
from app.services.mfr_devices import is_company_5000, select_devices
from app.services.scs_gateway import doa_declaration_date as _fault_date
from app.services.scs_gateway import scs_gateway

_SOURCE_TTL_SECONDS = 30.0
_WARRANTY_MONTHS = 36
_CHANGE_BATCH_SIZE = 100
_CHANGE_QUERY_CONCURRENCY = 4
_FAULT_CHANGE_TYPES = ("换上", "换上-up", "换下")
_DOA_DEVICES = AsyncTTLCache(max_entries=1)
_KK_COUNTS = AsyncTTLCache(max_entries=16, copy_values=False)
_KK_MODEL_BATCHES = AsyncTTLCache(max_entries=6, copy_values=False)
_MODEL_OPTIONS = AsyncTTLCache(max_entries=1)


def _month_index(day: date) -> int:
    return (day.year - 1) * 12 + day.month - 1


async def _model_shipments(start: date, end: date) -> tuple[tuple[int, str, float], ...]:
    year, month = divmod(max(0, _month_index(start) - _WARRANTY_MONTHS + 1), 12)
    cutoff = date(year + 1, month + 1, 1)

    async def load():
        rows = await data_gateway.kk_shipment_batches(
            date_from=cutoff.isoformat(), date_to=end.isoformat()
        )
        return tuple(
            (
                _month_index(date.fromisoformat(row["shipmentDate"])),
                str(row.get("model") or "").strip(),
                row["quantity"],
            )
            for row in rows
        )

    return await _KK_MODEL_BATCHES.get_or_set((cutoff, end), load, ttl_seconds=3600)


async def _shipments_by_month(end: date) -> Counter[int]:
    shipments = await _KK_COUNTS.get_or_set(
        end,
        lambda: data_gateway.kk_cumulative_deliveries(date_to=end),
        ttl_seconds=_SOURCE_TTL_SECONDS,
    )
    counts: Counter[int] = Counter()
    for _, period, count in shipments:
        year, month = map(int, period.split("-"))
        counts[_month_index(date(year, month, 1))] += count
    return counts


async def build_device_dashboard(filters: MFRFilters) -> MFRDashboardResponse:
    try:
        start = date.fromisoformat(filters.dateFrom)
        end = date.fromisoformat(filters.dateTo)
    except ValueError as exc:
        raise ValueError("dateFrom/dateTo 必须是有效的 YYYY-MM-DD 日期范围") from exc
    if start > end:
        raise ValueError("dateFrom/dateTo 必须是有效的 YYYY-MM-DD 日期范围")

    if filters.customerId or filters.customerIds:
        raise ValueError("MFR 支持按日期和机型筛选")
    model = filters.model.strip()

    async def load_devices():
        try:
            devices = await scs_gateway.doa_devices()
        except DataGatewayError as exc:
            if exc.status_code == 404:
                raise DataGatewayError(
                    "当前数据网关未提供 SCS DOA 设备接口，请更新或切换网关", status_code=502
                ) from exc
            raise
        if not devices:
            raise DataGatewayError(
                "SCS DOA 设备接口没有数据，请核查设备同步状态和数据网关版本",
                status_code=502,
            )
        return devices

    devices, shipments = await asyncio.gather(
        _DOA_DEVICES.get_or_set("devices", load_devices, ttl_seconds=_SOURCE_TTL_SECONDS),
        _model_shipments(start, end) if model else _shipments_by_month(end),
    )
    try:
        model_options = set(
            await _MODEL_OPTIONS.get_or_set("orders", data_gateway.order_models, ttl_seconds=3600)
        )
    except DataGatewayError:
        model_options = set()
    unknown_shipments: Counter[int] = Counter()
    shipped_by_month = shipments
    if model:
        shipped_by_month = Counter()
        for month, shipment_model, quantity in shipments:
            if shipment_model:
                model_options.add(shipment_model)
            else:
                unknown_shipments[month] += quantity
            if model.casefold() == (shipment_model or "未知机型").casefold():
                shipped_by_month[month] += quantity

    doa_states: dict[str, set[tuple[str, str]]] = defaultdict(set)
    valid_codes: set[str] = set()
    unresolved_codes: set[str] = set()
    for device in devices:
        for row in device.get("evidence") or []:
            if not isinstance(row, dict):
                continue
            code = str(row.get("doaCode") or "").strip()
            if not code:
                continue
            doa_states[code].add(
                (str(row.get("judgment") or "").strip(), str(row.get("doaStatus") or "").strip())
            )
    for code, states in doa_states.items():
        if len(states) != 1:
            unresolved_codes.add(code)
            continue
        judgment, status = next(iter(states))
        if not judgment or not status:
            unresolved_codes.add(code)
        elif judgment == "是":
            valid_codes.add(code)
    selected, issues, device_issue_details = select_devices(devices, valid_codes, unresolved_codes)
    model_options.update(device["orderModel"] for device in selected)
    if model:
        selected = [
            device for device in selected if device["orderModel"].casefold() == model.casefold()
        ]
    selected_by_key = {device["deviceKey"]: device for device in selected}
    service_devices: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for device in devices:
        for row in device.get("evidence") or []:
            if not isinstance(row, dict):
                continue
            code = str(row.get("doaCode") or "").strip()
            if not code or not is_company_5000(row):
                continue
            aliases = row.get("serviceOrderAliases")
            for value in [row.get("serviceOrder"), *(aliases if isinstance(aliases, list) else [])]:
                service = str(value or "").strip()
                if service:
                    service_devices[service][device["deviceKey"]].add(code)

    service_orders = []
    for service, candidates in service_devices.items():
        for key in candidates.keys() & selected_by_key.keys():
            codes = candidates[key] & selected_by_key[key]["matchedDoaCodes"]
            dates = {_fault_date(code) for code in codes}
            # Keep invalid or conflicting dates so the existing diagnostics still run.
            if dates and (
                len(dates) > 1 or any(day is None or start <= day <= end for day in dates)
            ):
                service_orders.append(service)
                break

    limiter = asyncio.Semaphore(_CHANGE_QUERY_CONCURRENCY)

    async def load_changes(batch: list[str]):
        async with limiter:
            return await scs_gateway.all(
                "SCS_CHANGE", changeType=",".join(_FAULT_CHANGE_TYPES), serviceOrder=",".join(batch)
            )

    change_batches = await asyncio.gather(
        *(
            load_changes(service_orders[offset : offset + _CHANGE_BATCH_SIZE])
            for offset in range(0, len(service_orders), _CHANGE_BATCH_SIZE)
        )
    )
    changes = sorted(
        (change for batch in change_batches for change in batch),
        key=lambda change: change["change_type"],
    )

    first_faults: dict[tuple[str, str], date] = {}
    fault_details: list[MFRFaultDetail] = []
    change_issue_details: list[MFRChangeIssueDetail] = []
    for change in changes:
        if change["is_revoked"] or change["change_type"] not in _FAULT_CHANGE_TYPES:
            continue
        candidates = service_devices.get(change["service_order"], {})
        selected_candidates = candidates.keys() & selected_by_key.keys()
        for key in sorted(selected_candidates):
            device = selected_by_key[key]
            codes = candidates[key] & device["matchedDoaCodes"]
            if not codes:
                continue
            dates = {_fault_date(code) for code in codes}
            if len(dates) != 1 or None in dates:
                change_issue_details.append(
                    MFRChangeIssueDetail(
                        reason="faultDateUnresolved",
                        deviceKey=key,
                        deviceSn=str(device.get("deviceSn") or ""),
                        changeDeviceSn=str(change.get("device_sn") or ""),
                        serviceOrder=change["service_order"],
                        doaCodes=sorted(codes),
                        changeId=str(change.get("id") or ""),
                        changeType=change["change_type"],
                        occurredAt=str(change.get("create_at") or ""),
                        partNumber=str(change.get("part_number") or ""),
                        partSn=str(change.get("part_sn") or ""),
                    )
                )
                continue
            fault_date = next(iter(dates))
            if not start <= fault_date <= end:
                continue
            month = fault_date.strftime("%Y-%m")
            identity = str(device.get("deviceSn") or "").strip()
            month_device = (month, identity or key)
            first_faults[month_device] = min(first_faults.get(month_device, fault_date), fault_date)
            production = device.get("productionOrder")
            fault_details.append(
                MFRFaultDetail(
                    model=device["orderModel"],
                    plannedDate="",
                    shipmentDate=device["shipmentDate"].isoformat()
                    if device["shipmentDate"]
                    else "",
                    productionOrder=str(production.get("value") or "")
                    if isinstance(production, dict)
                    else "",
                    deviceSn=identity,
                    deviceKey=key,
                    serviceOrder=change["service_order"],
                    doaCode=min(codes),
                    faultDate=fault_date.isoformat(),
                    changeId=str(change.get("id") or ""),
                    changeType=str(change.get("change_type") or ""),
                    occurredAt=str(change.get("create_at") or ""),
                    partNumber=str(change.get("part_number") or ""),
                    partSn=str(change.get("part_sn") or ""),
                    partName=str(change.get("part_name") or ""),
                    customer=str(change.get("customer") or ""),
                )
            )
    if change_issue_details:
        issues["faultDateUnresolved"] = len(change_issue_details)

    def rate(faults: int, denominator: float) -> float | None:
        return round(faults * 100 / denominator, 2) if denominator else None

    period_counts = Counter(month for month, _ in first_faults)
    daily_faults = Counter(first_faults.values())
    year, month = start.year, start.month
    trend: list[MFRTrendItem] = []
    fleet = 0
    while (year, month) <= (end.year, end.month):
        period = f"{year:04d}-{month:02d}"
        month_index = _month_index(date(year, month, 1))
        fleet = sum(
            shipped_by_month[index]
            for index in range(month_index - _WARRANTY_MONTHS + 1, month_index + 1)
        )
        trend.append(
            MFRTrendItem(
                period=period,
                key=period,
                faultCount=period_counts[period],
                fleetCount=fleet,
                mfrRate=rate(period_counts[period], fleet),
            )
        )
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    fleet_months = sum(item.fleetCount or 0 for item in trend)
    daily = (
        [
            MFRDailyTrendItem(
                period=(start + timedelta(days=offset)).isoformat(),
                faultCount=daily_faults[start + timedelta(days=offset)],
            )
            for offset in range((end - start).days + 1)
        ]
        if len(trend) == 1
        else []
    )
    return MFRDashboardResponse(
        filters=filters,
        summary=MFRSummary(
            faultCount=len(first_faults),
            fleetCount=fleet,
            denominatorSource="kk_sales_order_deliveries",
            shipmentDeviceCount=round(fleet),
            shipmentUnknownModelCount=round(sum(unknown_shipments.values())),
            mfrRate=rate(len(first_faults), fleet_months),
            sourceDeviceCount=len(devices),
            selectedDeviceCount=len(selected),
            deviceIssues=issues,
        ),
        trend=trend,
        dailyTrend=daily,
        modelOptions=sorted(model_options, key=str.casefold),
        faultDetails=fault_details,
        deviceIssueDetails=device_issue_details,
        changeIssueDetails=change_issue_details,
    )
