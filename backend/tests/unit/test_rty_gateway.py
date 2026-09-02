from unittest.mock import AsyncMock

import pytest

from app.services import rty_gateway


@pytest.mark.asyncio
async def test_rty_list_aggregates_orders_and_distinct_fault_sns(monkeypatch):
    gateway = rty_gateway.data_gateway
    monkeypatch.setattr(gateway, "all_orders", AsyncMock(return_value=[
        {"id": "SG:1", "source": "SG", "aufnr": "1", "salesOrder": "SO", "productionModel": "M", "inventoryLocation": "B", "plannedStartDate": "2026-01-02", "orderQuantity": 3, "raw": {"data": {"AUFNR": "1", "VBELN": "SO", "MAKTX_TH": "M", "LGORT": "B", "WMENG": 3, "IF_L6": ""}}},
        {"id": "SG:2", "source": "SG", "aufnr": "2", "salesOrder": "SO", "productionModel": "M", "inventoryLocation": "B", "plannedStartDate": "2026-01-03", "orderQuantity": 2, "raw": {"data": {"AUFNR": "2", "VBELN": "SO", "MAKTX_TH": "M", "LGORT": "B", "WMENG": 2, "IF_L6": ""}}},
    ]))
    monkeypatch.setattr(gateway, "all_faults", AsyncMock(return_value=[
        {"id": "f1", "productionOrder": "000000000001", "serialNumber": "SN1", "raw": {"AUFNR": "000000000001", "PCODE": "SN1", "ZDATE_WX": "20260103"}},
        {"id": "f2", "productionOrder": "1", "serialNumber": "SN1", "raw": {"AUFNR": "1", "PCODE": "SN1", "ZDATE_WX": "20260103"}},
    ]))
    result = await rty_gateway.rty_list({"orderScope": "normal", "dateFrom": "2026-01-01", "dateTo": "2026-12-31"}, 1, 50, {"M": 95})
    assert result["total"] == 1
    assert result["items"][0].inputCount == 5
    assert result["items"][0].defectCount == 1
    assert result["items"][0].rtyRate == 80.0


@pytest.mark.asyncio
async def test_all_pages_handles_null_items(monkeypatch):
    gateway = rty_gateway.data_gateway
    monkeypatch.setattr(gateway, "request_json", AsyncMock(return_value={"items": None, "page": 1, "pageSize": 100, "total": 0}))
    assert await gateway.all_pages("GET", "/api/orders") == []
