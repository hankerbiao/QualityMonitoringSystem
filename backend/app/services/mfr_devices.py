"""Resolve DOA devices to verified shipment dates without guessing."""

from collections import Counter, defaultdict
from datetime import date, datetime
from typing import Any


def _order_key(value: Any) -> str:
    text = str(value or "").strip()
    return text[-8:].lstrip("0") or "0" if text.isdigit() else ""


def _date(value: Any) -> date | None:
    text = str(value or "").strip().replace("/", "-")
    for length, fmt in ((10, "%Y-%m-%d"), (8, "%Y%m%d")):
        try:
            return datetime.strptime(text[:length], fmt).date()
        except ValueError:
            continue
    return None


def sales_key(value: Any) -> str:
    text = str(value or "").strip()
    return (text.lstrip("0") or "0") if text.isdigit() else text


def select_devices(
    devices: list[dict[str, Any]],
    orders: list[dict[str, Any]],
    start: date,
    end: date,
    doa_orders: dict[str, set[str]],
    valid_doa_codes: set[str],
    unresolved_doa_codes: set[str],
    model: str = "",
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Return unique identifiable devices and explicitly count unresolvable evidence."""
    plans: dict[str, set[tuple[str, str]]] = defaultdict(set)
    planned_dates: dict[str, set[date]] = defaultdict(set)
    for order in orders:
        number = _order_key(order.get("aufnr"))
        if not number:
            continue
        planned = _date(order.get("plannedStartDate"))
        if planned is not None:
            planned_dates[number].add(planned)
        order_model = str(order.get("productionModel") or "").strip() or "未知机型"
        sales_order = sales_key(order.get("salesOrder"))
        plans[number].add((order_model, sales_order))

    sales_orders = {sales_key(order.get("salesOrder")) for order in orders} - {""}

    selected: list[dict[str, Any]] = []
    issues: Counter[str] = Counter()
    identity_keys: dict[tuple[str, str], set[str]] = defaultdict(set)
    for device in devices:
        for row in device.get("evidence") or []:
            if not isinstance(row, dict):
                continue
            for field in ("contextId", "productBarcode"):
                value = str(row.get(field) or "").strip()
                if value:
                    identity_keys[(field, value)].add(device["deviceKey"])
    ambiguous_ids = {key for keys in identity_keys.values() if len(keys) > 1 for key in keys}
    for device in devices:
        evidence = device.get("evidence")
        if not isinstance(evidence, list):
            issues["doaStatusUnresolved"] += 1
            continue
        codes = {str(row.get("doaCode") or "").strip() for row in evidence if isinstance(row, dict)}
        relevant = {code for code in codes if doa_orders.get(code, set()) & sales_orders}
        if not relevant & valid_doa_codes:
            if codes & unresolved_doa_codes or (
                not relevant and (not codes or "" in codes or codes - doa_orders.keys())
            ):
                issues["doaStatusUnresolved"] += 1
            continue
        if device.get("identityBasis") not in {"product_barcode", "product_context"}:
            issues["identityUnverified"] += 1
            continue
        if device["deviceKey"] in ambiguous_ids:
            issues["identityConflict"] += 1
            continue
        production = device.get("productionOrder")
        if not isinstance(production, dict) or production.get("status") != "valid":
            issues["productionOrderUnresolved"] += 1
            continue
        order_key = _order_key(production.get("value"))
        choices = plans.get(order_key, set())
        if not order_key or not choices:
            issues["planDateUnresolved"] += 1
            continue
        if len(choices) != 1:
            issues["planOrModelConflict"] += 1
            continue
        order_model, sales_order = next(iter(choices))
        matched_codes = {
            code for code in relevant & valid_doa_codes if doa_orders.get(code) == {sales_order}
        }
        if not sales_order or not matched_codes:
            issues["salesOrderMismatch"] += 1
            continue
        product_sales = device.get("salesOrder")
        if isinstance(product_sales, dict) and product_sales.get("status") == "conflict":
            issues["salesOrderMismatch"] += 1
            continue
        if (
            isinstance(product_sales, dict)
            and product_sales.get("status") == "valid"
            and sales_key(product_sales.get("value")) != sales_order
        ):
            issues["salesOrderMismatch"] += 1
            continue
        shipment_values = [
            row.get("shipmentDate") for row in evidence
            if isinstance(row, dict) and str(row.get("doaCode") or "").strip() in matched_codes
        ]
        shipment_dates = {_date(value) for value in shipment_values}
        if not shipment_values or None in shipment_dates:
            issues["shipmentDateUnresolved"] += 1
            continue
        if len(shipment_dates) != 1:
            issues["shipmentDateConflict"] += 1
            continue
        shipment = next(iter(shipment_dates))
        if not start <= shipment <= end or (model and order_model != model):
            continue
        dates = planned_dates.get(order_key, set())
        planned = next(iter(dates)) if len(dates) == 1 else None
        selected.append({**device, "plannedDate": planned, "shipmentDate": shipment, "orderModel": order_model})
        for field in ("factoryDate", "warrantyEndDate"):
            value = device.get(field)
            if not isinstance(value, dict) or value.get("status") != "valid":
                issues["lifecycleDateIncomplete"] += 1
                break
    return selected, dict(issues)
