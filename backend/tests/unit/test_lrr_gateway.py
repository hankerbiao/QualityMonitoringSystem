from __future__ import annotations

import pytest

from app.services import lrr_gateway
from app.services.data_gateway_client import DataGatewayClient, DataGatewayError


@pytest.mark.asyncio
async def test_load_bom_normalizes_gateway_rows_and_applies_exact_filters(monkeypatch):
    calls: list[dict[str, str]] = []

    async def all_bom_rows(**filters: str):
        calls.append(filters)
        return [
            {
                "id": "bom-1",
                "AUFNR_1": "000000000001",
                "VBELN_EX": "0000000009",
                "MENGE_A": "3",
                "MATNR": "MAT-1",
                "LGORT": "BASE-A",
                "BUDAT_MKPF": "20260831",
            },
            {
                "id": "bom-2",
                "AUFNR_1": "000000000002",
                "VBELN_EX": "0000000010",
                "MENGE_A": "4",
                "MATNR": "MAT-2",
                "LGORT": "BASE-B",
                "BUDAT_MKPF": "20260831",
            },
        ]

    async def all_orders(**_filters: str):
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)
    monkeypatch.setattr(lrr_gateway.data_gateway, "all_orders", all_orders)

    rows = await lrr_gateway.load_bom(
        production_order="1",
        date_from="2026-08-01",
        date_to="2026-08-31",
        month="2026-08",
    )

    assert [row["AUFNR_1"] for row in rows] == ["000000000001"]
    assert rows[0]["MENGE_A"] == "3"
    assert calls == [
        {
            "dateFrom": "2026-08-01",
            "dateTo": "2026-08-31",
            "materialCode": "",
            "keyword": "1",
        }
    ]


@pytest.mark.asyncio
async def test_load_bom_month_adds_gateway_date_bounds(monkeypatch):
    captured: dict[str, str] = {}

    async def all_bom_rows(**filters: str):
        captured.update(filters)
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_bom_rows", all_bom_rows)
    assert await lrr_gateway.load_bom(month="2026-02") == []
    assert captured["dateFrom"] == "2026-02-01"
    assert captured["dateTo"] == "2026-02-28"


@pytest.mark.asyncio
async def test_load_faults_accepts_omitted_sales_orders(monkeypatch):
    captured: dict[str, str] = {}

    async def fault_lookup(**filters: str):
        captured.update(filters)
        captured["productionOrders"] = ",".join(filters.get("production_orders", []))
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "fault_lookup", fault_lookup)
    assert await lrr_gateway.load_faults(production_orders={"000000000001"}) == []
    assert captured["productionOrders"] == "000000000001,1"


@pytest.mark.asyncio
async def test_load_faults_avoids_oversized_batch_filter(monkeypatch):
    captured: dict[str, str] = {}

    async def fault_lookup(**filters: str):
        captured.update(filters)
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "fault_lookup", fault_lookup)
    await lrr_gateway.load_faults(
        production_orders={str(index) for index in range(201)},
        date_from="2026-08-01",
        date_to="2026-08-31",
    )
    assert captured["date_from"] == "2026-08-01"


@pytest.mark.asyncio
async def test_load_faults_uses_month_bounds(monkeypatch):
    captured: dict[str, str] = {}

    async def fault_lookup(**filters: str):
        captured.update(filters)
        return []

    monkeypatch.setattr(lrr_gateway.data_gateway, "fault_lookup", fault_lookup)
    await lrr_gateway.load_faults(production_orders={"1"}, month="2026-02")
    assert captured["date_from"] == "2026-02-01"
    assert captured["date_to"] == "2026-02-28"


@pytest.mark.asyncio
async def test_options_uses_orders_without_loading_entire_bom(monkeypatch):
    async def all_orders(**_filters: str):
        return [
            {
                "aufnr": "1",
                "salesOrder": "0009",
                "inventoryLocation": "BASE-A",
                "customerId": "C-1",
                "raw": {"data": {"MATNR": "MAT-1", "KID": "C-1"}},
            }
        ]

    async def fail_all_view(*_args, **_kwargs):
        raise AssertionError("options must not load the full BOM view")

    monkeypatch.setattr(lrr_gateway.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(lrr_gateway.data_gateway, "all_view", fail_all_view)
    result = await lrr_gateway.options()
    assert result["productionOrders"] == ["000000000001"]
    assert result["salesOrders"] == ["9"]
    assert result["bases"] == ["BASE-A"]
    assert result["customerIds"] == ["C-1"]
    assert result["materialNumbers"] == ["MAT-1"]


@pytest.mark.asyncio
async def test_all_pages_rejects_result_larger_than_processing_limit():
    client = DataGatewayClient("http://gateway.test")

    async def request_json(*_args, **_kwargs):
        return {"items": [], "total": 101}

    client.request_json = request_json  # type: ignore[method-assign]
    with pytest.raises(DataGatewayError, match="超过本系统单次处理上限"):
        await client.all_pages("GET", "/api/views/ZSGV_ZSD124", max_rows=100)
