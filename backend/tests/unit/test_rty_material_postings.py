from unittest.mock import AsyncMock

import pytest

from app.services import rty_gateway


@pytest.mark.asyncio
async def test_material_filter_intersects_posting_orders_with_order_dates(monkeypatch):
    postings = [
        {"MATNR": "B2400036", "AUFNR_1": "000000000123"},
        {"MATNR": "B2400036", "AUFNR_1": "000000000124"},
        {"MATNR": "OTHER", "AUFNR_1": "000000000125"},
    ]
    orders = [
        {"aufnr": order, "plannedStartDate": date, "raw": {"data": {"LGORT": "A"}}}
        for order, date in [("123", "2026-06-01"), ("124", "2026-04-01"), ("125", "2026-06-01")]
    ]
    monkeypatch.setattr(rty_gateway.data_gateway, "all_bom_rows", AsyncMock(return_value=postings))
    monkeypatch.setattr(rty_gateway.data_gateway, "all_orders", AsyncMock(return_value=orders))

    rows = await rty_gateway._order_rows({
        "materialNumber": "B2400036", "dateFrom": "2026-05-06", "dateTo": "2026-11-06"
    })

    assert [row["aufnr"] for row in rows] == ["123"]
    rty_gateway.data_gateway.all_bom_rows.assert_awaited_once_with(materialCode="B2400036")
