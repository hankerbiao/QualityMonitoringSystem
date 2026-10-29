from unittest.mock import AsyncMock

import pytest

from app.services import rty_export, rty_gateway


@pytest.mark.asyncio
async def test_rty_list_cycle_and_sales_summary_use_order_quantity(monkeypatch):
    orders = [
        rty_gateway.normalize_order_row(
            {
                "aufnr": "30238069",
                "plannedStartDate": "2026-10-16",
                "raw": {
                    "data": {
                        "AUFNR": "30238069",
                        "VBELN": "SO",
                        "MAKTX_TH": "3210 C3",
                        "LGORT": "1000",
                        "GAMNG": 6,
                        "WMENG": 0,
                    }
                },
            }
        )
    ]
    monkeypatch.setattr(rty_gateway, "_orders", AsyncMock(return_value=orders))
    monkeypatch.setattr(
        rty_gateway, "_fault_sns_by_orders", AsyncMock(return_value={"30238069": {"SN1"}})
    )
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_composite_groups", AsyncMock(return_value={}))
    listing = await rty_gateway._build_rty_list({}, 1, 50, {})
    cycle = await rty_gateway._build_cycle_data("normal", None, {}, "2026-01-01", "2026-10-29")
    summary = await rty_gateway.sales_order_summary(["SO"], "normal")
    for row in [listing["items"][0], cycle[0], summary[0]]:
        assert row.inputCount == 6
        assert row.rtyRate == 83.33


@pytest.mark.asyncio
async def test_template_rate_uses_order_quantity_and_retains_completion_quantity(monkeypatch):
    orders = [{"AUFNR": "1", "MAKTX_TH": "M", "GAMNG": 12, "WMENG": 10}]
    faults = [({"AUFNR": "1", "PCODE": "SN1"}, {("M", "SN1")})]
    monkeypatch.setattr(rty_export, "_load_sources", AsyncMock(return_value=(orders, faults)))
    monkeypatch.setattr(rty_export, "_export_orders", AsyncMock(return_value=orders))
    result = await rty_export.build_template_export(
        {"dateFrom": "2026-01-01", "dateTo": "2026-10-29"}
    )
    assert result.summary[0]["completedQuantity"] == 10
    assert result.summary[0]["completionRate"] == pytest.approx(11 / 12)
    assert result.topProblems[0]["productionQuantity"] == 12
