"""Shipment-based denominator for the MFR dashboard."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

UNKNOWN_MODEL = "未知机型"


@dataclass
class ShipmentDenominator:
    """Shipped units in the window, summed from LFIMG once per delivery batch."""

    device_count: int = 0
    by_month: dict[str, int] = field(default_factory=dict)
    by_model: dict[str, int] = field(default_factory=dict)
    unknown_model_count: int = 0
    record_count: int = 0
    missing_serial_count: int = 0
    fallback_model_count: int = 0
    batch_count: int = 0
    source: str = "kk_sales_order_deliveries"


def _count(value: Any) -> int:
    return value if type(value) is int and value >= 0 else 0


def _quantity(value: Any) -> int:
    """Round a gateway quantity (LFIMG sum) to whole units."""
    if type(value) in (int, float) and value > 0:
        return int(round(value))
    return 0


def shipment_denominator(stats: dict[str, Any], model: str = "") -> ShipmentDenominator:
    """Fold the gateway statistics into the denominator used by the dashboard.

    The gateway already deduplicates devices by serial number and groups them by
    delivery date (WADAT) and production model, so this is pure reshaping: one
    HTTP call replaces paginating tens of thousands of delivery rows.
    """
    # Quantity is the shipped unit count summed from LFIMG once per delivery batch.
    from app.services.data_gateway_client import DataGatewayError

    quantities = [stats.get("quantity"), *(item.get("quantity") for item in stats.get("byModel", [])), *(item.get("quantity") for item in stats.get("byMonth", []))]
    if any(type(value) not in (int, float) or value < 0 for value in quantities):
        raise DataGatewayError("KK 出货统计缺少有效的 LFIMG 数量，无法计算 MFR 分母")
    by_model: dict[str, int] = {}
    for item in stats.get("byModel") or []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("model") or "").strip()
        if key:
            by_model[key] = _quantity(item.get("quantity"))

    by_month: dict[str, int] = {}
    for item in stats.get("byMonth") or []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("month") or "").strip()
        if key:
            by_month[key] = _quantity(item.get("quantity"))

    unknown = _quantity(stats.get("unknownModelCount"))
    total = _quantity(stats.get("quantity"))
    if model == UNKNOWN_MODEL:
        # The unknown bucket is a placeholder, not a production model.
        by_model.pop(UNKNOWN_MODEL, None)
        total = 0
    elif model:
        # A model drill-down only counts that model's shipments; devices without
        # a model never match a real model name.
        total = by_model.get(model, 0)
        by_model = dict.fromkeys([model], total)

    return ShipmentDenominator(
        device_count=total,
        by_month=by_month,
        by_model=by_model,
        unknown_model_count=unknown,
        record_count=_count(stats.get("recordCount")),
        batch_count=_count(stats.get("batchCount")),
        missing_serial_count=_count(stats.get("missingSerialCount")),
        fallback_model_count=_count(stats.get("fallbackModelCount")),
        source="kk_sales_order_deliveries",
    )


def device_denominator(devices: list[dict[str, Any]], model: str = "") -> ShipmentDenominator:
    """Fallback denominator used when the shipment statistics are unavailable."""
    by_month: dict[str, int] = {}
    by_model: dict[str, int] = {}
    for device in devices:
        key = str(device.get("orderModel") or "")
        by_model[key] = by_model.get(key, 0) + 1
        shipped = device.get("shipmentDate")
        if shipped is not None:
            month = shipped.strftime("%Y-%m")
            by_month[month] = by_month.get(month, 0) + 1
    return ShipmentDenominator(
        device_count=len(devices) if not model else by_model.get(model, 0),
        by_month=by_month,
        by_model=by_model,
        source="doa_devices",
    )
