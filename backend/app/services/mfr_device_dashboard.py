"""MFR aggregation for DOA devices grouped by production-order plan date."""

from __future__ import annotations

import asyncio
from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import Any

from app.schemas.mfr import (
    MFRDailyTrendItem,
    MFRDashboardResponse,
    MFRDimensionItem,
    MFRFaultDetail,
    MFRFilters,
    MFRSummary,
    MFRTrendItem,
)
from app.services.data_gateway_client import DataGatewayError, data_gateway
from app.services.mfr_devices import sales_key, select_devices
from app.services.scs_gateway import scs_gateway


def _rate(events: int, devices: int) -> float | None:
    return round(events / devices * 100, 2) if devices else None


def _aliases(device: dict[str, Any], allowed_codes: set[str]) -> set[str]:
    result: set[str] = set()
    for row in device.get("evidence", []):
        if not isinstance(row, dict) or str(row.get("doaCode") or "").strip() not in allowed_codes:
            continue
        aliases = row.get("serviceOrderAliases")
        if isinstance(aliases, list):
            result.update(str(alias).strip() for alias in aliases if alias)
        if row.get("serviceOrder"):
            result.add(str(row["serviceOrder"]).strip())
    return result - {""}


async def build_device_dashboard(filters: MFRFilters) -> MFRDashboardResponse:
    try:
        start = date.fromisoformat(filters.dateFrom)
        end = date.fromisoformat(filters.dateTo)
    except ValueError as exc:
        raise ValueError("dateFrom/dateTo 必须是有效的 YYYY-MM-DD 日期范围") from exc
    if start > end:
        raise ValueError("dateFrom/dateTo 必须是有效的 YYYY-MM-DD 日期范围")

    async def load_devices():
        try:
            return await scs_gateway.doa_devices()
        except DataGatewayError as exc:
            if exc.status_code == 404:
                raise DataGatewayError(
                    "当前数据网关未提供 SCS DOA 设备接口，请更新或切换网关", status_code=502
                ) from exc
            raise

    devices, orders, change_up, change_up_up = await asyncio.gather(
        load_devices(),
        data_gateway.all_orders(),
        scs_gateway.all("SCS_CHANGE", changeType="换上"),
        scs_gateway.all("SCS_CHANGE", changeType="换上-up"),
    )
    if not devices:
        raise DataGatewayError(
            "SCS DOA 设备接口没有数据，请核查设备同步状态和数据网关版本",
            status_code=502,
        )

    doa_orders: dict[str, set[str]] = defaultdict(set)
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
            order_no = sales_key(row.get("doaSalesOrder"))
            if order_no:
                doa_orders[code].add(order_no)
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
        elif judgment == "是" and status != "待受理":
            valid_codes.add(code)
    selected, issues = select_devices(
        devices, orders, start, end, doa_orders, valid_codes, unresolved_codes, filters.model
    )
    sales_orders = {sales_key(order.get("salesOrder")) for order in orders} - {""}
    allowed_codes = {code for code, sales in doa_orders.items() if sales and sales <= sales_orders}
    selected_by_key = {device["deviceKey"]: device for device in selected}
    service_devices: dict[str, set[str]] = defaultdict(set)
    all_by_key = {device["deviceKey"]: device for device in devices}
    for device in devices:
        for service in _aliases(device, allowed_codes):
            service_devices[service].add(device["deviceKey"])

    faults: Counter[str] = Counter()
    fault_details: list[MFRFaultDetail] = []
    unmatched_changes = 0
    affected_devices: set[str] = set()
    for change in [*change_up, *change_up_up]:
        if change["is_revoked"] or change["change_type"] not in {"换上", "换上-up"}:
            continue
        keys = service_devices.get(change["service_order"], set())
        if not keys:
            continue
        serial = str(change.get("device_sn") or "").strip()
        if serial:
            keys = {
                key for key in keys if str(all_by_key[key].get("deviceSn") or "").strip() == serial
            }
        if len(keys) != 1:
            # Only report cases attributable to a service of a selected device.
            if service_devices[change["service_order"]] & selected_by_key.keys():
                unmatched_changes += 1
                affected_devices.update(service_devices[change["service_order"]] & selected_by_key.keys())
            continue
        key = next(iter(keys))
        if key in selected_by_key:
            faults[key] += 1
            device = selected_by_key[key]
            fault_details.append(MFRFaultDetail(
                model=device["orderModel"], plannedDate=device["plannedDate"].isoformat(),
                productionOrder=str(device["productionOrder"].get("value") or ""),
                deviceSn=str(device.get("deviceSn") or ""),
                serviceOrder=str(change.get("service_order") or ""),
                changeId=str(change.get("id") or ""), changeType=str(change.get("change_type") or ""),
                occurredAt=str(change.get("create_at") or ""),
                partNumber=str(change.get("part_number") or ""), partSn=str(change.get("part_sn") or ""),
                partName=str(change.get("part_name") or ""), customer=str(change.get("customer") or ""),
            ))

    model_counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    period_counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    daily_faults: Counter[date] = Counter()
    for device in selected:
        planned = device["plannedDate"]
        count = faults[device["deviceKey"]]
        for bucket in (
            model_counts[device["orderModel"]],
            period_counts[planned.strftime("%Y-%m")],
        ):
            bucket[0] += count
            bucket[1] += 1
        daily_faults[planned] += count

    affected_models = {selected_by_key[key]["orderModel"] for key in affected_devices}
    affected_periods = {selected_by_key[key]["plannedDate"].strftime("%Y-%m") for key in affected_devices}
    model_rows = [
        MFRDimensionItem(
            key=key, faultCount=values[0], fleetCount=values[1],
            mfrRate=None if key in affected_models else _rate(*values),
        )
        for key, values in sorted(model_counts.items())
    ]
    periods: list[str] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        periods.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    trend = [
        MFRTrendItem(
            period=period,
            key=period,
            faultCount=period_counts[period][0],
            fleetCount=period_counts[period][1],
            mfrRate=None if period in affected_periods else _rate(*period_counts[period]),
        )
        for period in periods
    ]
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
    event_count = sum(faults.values())
    return MFRDashboardResponse(
        filters=filters,
        summary=MFRSummary(
            faultCount=event_count,
            fleetCount=len(selected),
            mfrRate=None if unmatched_changes else _rate(event_count, len(selected)),
            sourceDeviceCount=len(devices),
            selectedDeviceCount=len(selected),
            deviceIssues=issues,
            unmatchedChangeCount=unmatched_changes,
        ),
        trend=trend,
        dailyTrend=daily,
        byModel=model_rows,
        faultDetails=fault_details,
    )
