from datetime import datetime

from app.services.mfr_shipments import device_denominator, shipment_denominator


def stats(**overrides):
    payload = {
        "deviceCount": 15962,
        "quantity": 15900,
        "recordCount": 16986,
        "missingSerialCount": 2,
        "unknownModelCount": 208,
        "fallbackModelCount": 12627,
        "byMonth": [
            {"month": "2026-10", "quantity": 15900, "devices": 15962},
            {"month": "2026-09", "quantity": 14210, "devices": 14210},
        ],
        "byModel": [
            {"model": "6210 C21", "quantity": 3941, "devices": 3941},
            {"model": "未知机型", "quantity": 208, "devices": 208},
        ],
    }
    payload.update(overrides)
    return payload


def test_shipment_denominator_exposes_counts_and_buckets():
    denominator = shipment_denominator(stats())
    assert denominator.source == "kk_sales_order_deliveries"
    assert denominator.device_count == 15900
    assert denominator.by_month["2026-10"] == 15900
    assert denominator.by_model["6210 C21"] == 3941


def test_shipment_denominator_filters_single_model():
    denominator = shipment_denominator(stats(), "6210 C21")
    assert denominator.device_count == 3941
    assert dict(denominator.by_model) == {"6210 C21": 3941}


def test_shipment_denominator_ignores_unknown_placeholder_on_drill_down():
    denominator = shipment_denominator(stats(), "未知机型")
    assert denominator.device_count == 0
    assert "未知机型" not in denominator.by_model


def test_shipment_denominator_prefers_quantity_and_falls_back_to_devices():
    fallback = shipment_denominator(stats(quantity=0, deviceCount=4200, byMonth=[{"month": "2026-10", "devices": 4200}]))
    assert fallback.device_count == 4200
    assert fallback.by_month["2026-10"] == 4200


def test_device_denominator_keeps_doa_fallback_source():
    devices = [{"orderModel": "Model A", "shipmentDate": datetime(2026, 10, 1)} for _ in range(3)]
    denominator = device_denominator(devices)
    assert denominator.source == "doa_devices"
    assert denominator.device_count == 3
    assert denominator.by_month == {"2026-10": 3}
