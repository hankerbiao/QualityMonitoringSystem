from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api import alert_report as api
from app.libs import alert_token
from app.schemas.alert_report import AlertContext
from app.services import alert_report, rty_export
from app.services.data_gateway_client import DataGatewayError


async def test_export_reads_full_rty_source_without_display_limit(monkeypatch):
    raw = {
        key: f"source-{key}"
        for key in rty_export.FAULT_FIELDS
    }
    raw["PCODE"] = "000001"
    faults = [(dict(raw), {("Model A", "000001")}) for _ in range(1001)]
    loader = AsyncMock(return_value=([], faults))
    monkeypatch.setattr(rty_export, "_load_sources", loader)
    monkeypatch.setattr(
        alert_report, "details_by_orders", AsyncMock(side_effect=AssertionError("Display data"))
    )

    result = await alert_report.build_alert_fault_export(
        AlertContext(
            productModel="Model A",
            base="1000",
            customer="C1",
            salesOrder="0000123",
            productionOrder="000000000001",
            serialNumber="000001",
            dateFrom="2026-10-01 00:00:00",
            dateTo="2026-10-27 23:59:59",
        )
    )

    loader.assert_awaited_once_with({
        "productModel": "Model A",
        "base": "1000",
        "customer": "C1",
        "salesOrder": "0000123",
        "productionOrder": "000000000001",
        "serialNumber": "000001",
        "dateFrom": "2026-10-01",
        "dateTo": "2026-10-27",
        "orderScope": "normal",
    })
    assert len(result) == 1001
    assert result[0] == raw
    assert tuple(result[0]) == rty_export.FAULT_FIELDS


async def test_export_preserves_open_date_boundaries(monkeypatch):
    loader = AsyncMock(return_value=([], []))
    monkeypatch.setattr(rty_export, "_load_sources", loader)

    assert await alert_report.build_alert_fault_export(AlertContext(base="1000")) == []

    loader.assert_awaited_once_with({
        "base": "1000",
        "orderScope": "normal",
        "dateFrom": "1900-01-01",
        "dateTo": "9999-12-31",
    })


@pytest.fixture
def export_app(monkeypatch, mock_settings):
    monkeypatch.setattr(alert_token, "get_settings", lambda: mock_settings)
    app = FastAPI()
    app.include_router(api.router, prefix="/api/alert-report")
    return app


async def test_export_uses_only_signed_context_without_login(export_app, monkeypatch):
    context = {"base": "1000", "productModel": "Model A", "dateFrom": "2026-10-01"}
    token = alert_token.create_alert_token(context)
    rows = [{"PCODE": "000001", "ZNGWD3": "完整不良现象", "ZWXWD3": "更换部件"}]
    export = AsyncMock(return_value=rows)
    monkeypatch.setattr(api, "build_alert_fault_export", export)

    async with AsyncClient(transport=ASGITransport(app=export_app), base_url="http://test") as client:
        response = await client.get(
            f"/api/alert-report/{token}/export?base=3000&productModel=Other"
        )

    assert response.status_code == 200
    assert response.json()["data"] == rows
    export.assert_awaited_once_with(AlertContext(**context))


@pytest.mark.parametrize("invalid", ["tampered", "expired"])
async def test_invalid_tokens_cannot_read_export_sources(export_app, monkeypatch, invalid):
    token = alert_token.create_alert_token({"base": "1000"}, ttl_days=-1 if invalid == "expired" else 7)
    if invalid == "tampered":
        payload, signature = token.split(".")
        token = f"{payload}.{'A' if signature[0] != 'A' else 'B'}{signature[1:]}"
    export = AsyncMock()
    monkeypatch.setattr(api, "build_alert_fault_export", export)

    async with AsyncClient(transport=ASGITransport(app=export_app), base_url="http://test") as client:
        response = await client.get(f"/api/alert-report/{token}/export")

    assert response.json()["success"] is False
    assert response.json()["data"] is None
    export.assert_not_awaited()


async def test_export_source_failure_does_not_return_partial_rows(export_app, monkeypatch):
    token = alert_token.create_alert_token({"base": "1000"})
    monkeypatch.setattr(
        api, "build_alert_fault_export", AsyncMock(side_effect=DataGatewayError("source unavailable"))
    )

    async with AsyncClient(transport=ASGITransport(app=export_app), base_url="http://test") as client:
        response = await client.get(f"/api/alert-report/{token}/export")

    assert response.json()["success"] is False
    assert response.json()["data"] is None
    assert response.json()["error"] == "故障明细导出失败，请稍后重试"
