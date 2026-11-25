"""MFR aggregation for DOA devices grouped by DOA declaration date."""

from __future__ import annotations

import asyncio
import re
from collections import Counter, defaultdict
from datetime import date, timedelta

from app.schemas.mfr import (
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
from app.services.scs_gateway import scs_gateway

_SOURCE_TTL_SECONDS = 30.0
_CHANGE_BATCH_SIZE = 100
_CHANGE_QUERY_CONCURRENCY = 4
_FAULT_CHANGE_TYPES = ("换上", "换上-up", "换下")
_DOA_DEVICES = AsyncTTLCache(max_entries=1)
_KK_COUNTS = AsyncTTLCache(max_entries=16, copy_values=False)


def _fault_date(code: str) -> date | None:
    match = re.fullmatch(r"KX([0-9]{8})[0-9]{4}", code)
    if match is None:
        return None
    digits = match[1]
    try:
        return date(int(digits[:4]), int(digits[4:6]), int(digits[6:8]))
    except ValueError:
        return None


async def _shipments_in_range(start: date, end: date) -> Counter[tuple[str, str]]:
    async def cumulative(cutoff: date):
        return await _KK_COUNTS.get_or_set(
            cutoff,
            lambda: data_gateway.kk_cumulative_deliveries(date_to=cutoff),
            ttl_seconds=_SOURCE_TTL_SECONDS,
        )

    start_month = start.isoformat()[:7]
    if start.day == 1:
        through_end = await cumulative(end)
        before_start = ()
    else:
        through_end, before_start = await asyncio.gather(
            cumulative(end), cumulative(start - timedelta(days=1))
        )

    counts = Counter(
        {(order, month): count for order, month, count in through_end if month >= start_month}
    )
    counts.subtract(
        {(order, month): count for order, month, count in before_start if month == start_month}
    )
    if any(count < 0 for count in counts.values()):
        raise DataGatewayError("KK 累计出货汇总在两个截止日之间不一致")
    return +counts


async def build_device_dashboard(filters: MFRFilters) -> MFRDashboardResponse:
    try:
        start = date.fromisoformat(filters.dateFrom)
        end = date.fromisoformat(filters.dateTo)
    except ValueError as exc:
        raise ValueError("dateFrom/dateTo 必须是有效的 YYYY-MM-DD 日期范围") from exc
    if start > end:
        raise ValueError("dateFrom/dateTo 必须是有效的 YYYY-MM-DD 日期范围")

    if filters.model or filters.customerId or filters.customerIds:
        raise ValueError("MFR 暂只支持按日期筛选")

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
        _shipments_in_range(start, end),
    )

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
    selected, issues = select_devices(devices, valid_codes, unresolved_codes)
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
    unresolved_dates = 0
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
                unresolved_dates += 1
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
                    shipmentDate=device["shipmentDate"].isoformat() if device["shipmentDate"] else "",
                    productionOrder=str(production.get("value") or "")
                    if isinstance(production, dict)
                    else "",
                    deviceSn=identity,
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
    if unresolved_dates:
        issues["faultDateUnresolved"] = unresolved_dates

    shipped_by_month: Counter[str] = Counter()
    for (_, month), count in shipments.items():
        shipped_by_month[month] += count

    def rate(faults: int, fleet: int) -> float | None:
        return round(faults * 100 / fleet, 2) if fleet else None

    period_counts = Counter(month for month, _ in first_faults)
    daily_faults = Counter(first_faults.values())
    periods: list[str] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        periods.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    fleet = sum(shipped_by_month.values())
    cumulative = 0
    trend = []
    for period in periods:
        cumulative += shipped_by_month[period]
        trend.append(
            MFRTrendItem(
                period=period,
                key=period,
                faultCount=period_counts[period],
                fleetCount=cumulative,
                mfrRate=None
                if unresolved_dates
                else rate(
                    period_counts[period],
                    cumulative,
                ),
            )
        )
    daily = (
        [
            MFRDailyTrendItem(
                period=(start + timedelta(days=offset)).isoformat(),
                faultCount=daily_faults[start + timedelta(days=offset)],
            )
            for offset in range((end - start).days + 1)
        ]
        if len(periods) == 1
        else []
    )
    return MFRDashboardResponse(
        filters=filters,
        summary=MFRSummary(
            faultCount=len(first_faults),
            fleetCount=fleet,
            denominatorSource="kk_sales_order_deliveries",
            shipmentDeviceCount=fleet,
            mfrRate=None
            if unresolved_dates
            else rate(len(first_faults), fleet),
            sourceDeviceCount=len(devices),
            selectedDeviceCount=len(selected),
            deviceIssues=issues,
        ),
        trend=trend,
        dailyTrend=daily,
        faultDetails=fault_details,
    )
