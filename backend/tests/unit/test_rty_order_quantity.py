from unittest.mock import AsyncMock

import pytest

from app.services import rty_export, rty_gateway


@pytest.mark.asyncio
async def test_order_type_filters_cycle_and_order_list_without_filtering_all_types(monkeypatch):
    records = [
        {
            "aufnr": number,
            "plannedStartDate": "2026-03-01",
            "orderQuantity": qty,
            "raw": {
                "data": {
                    "AUFNR": number,
                    "GSTRS": "2026-03-01",
                    "GAMNG": qty,
                    "MAKTX_TH": "M",
                    "AUART": kind,
                }
            },
        }
        for number, kind, qty in [("1", "PP01", 10), ("2", "G001", 6)]
    ]
    monkeypatch.setattr(rty_gateway.data_gateway, "all_orders", AsyncMock(return_value=records))
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_orders", AsyncMock(return_value={}))
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_composite_groups", AsyncMock(return_value={}))
    filters = {"dateFrom": "2026-03-01", "dateTo": "2026-03-31", "orderType": "PP01"}
    assert [row["aufnr"] for row in await rty_gateway._orders(filters)] == ["1"]
    cycle = await rty_gateway._build_cycle_data(
        "normal", None, {}, "2026-03-01", "2026-03-31", "PP01"
    )
    assert cycle[0].inputCount == 10
    assert len(await rty_gateway._orders({**filters, "orderType": ""})) == 2
    assert len(await rty_gateway._orders({"orderTypes": "PP01,G001"})) == 2
    assert [row["aufnr"] for row in await rty_gateway._orders({"orderTypes": "G001"})] == ["2"]


@pytest.mark.asyncio
async def test_export_filters_order_type(monkeypatch):
    orders = [
        {
            "id": f"id:{number}",
            "aufnr": number,
            "plannedStartDate": "2026-03-01",
            "raw": {"data": {"AUFNR": number, "GSTRS": "2026-03-01", "AUART": kind}},
        }
        for number, kind in [("1", "PP01"), ("2", "G001")]
    ]
    monkeypatch.setattr(rty_export.data_gateway, "all_orders", AsyncMock(return_value=orders))
    monkeypatch.setattr(rty_export, "_full_orders", AsyncMock(return_value=orders))
    filters = {
        "dateFrom": "2026-03-01",
        "dateTo": "2026-03-31",
        "orderScope": "normal",
        "orderType": "PP01",
    }
    result = await rty_export._load_orders(filters)
    assert [row["AUFNR"] for row in result] == ["1"]
    assert len(await rty_export._load_orders({**filters, "orderType": ""})) == 2
    assert (
        len(await rty_export._load_orders({**filters, "orderType": "", "orderTypes": "PP01,G001"}))
        == 2
    )
    assert [
        row["AUFNR"]
        for row in await rty_export._load_orders({**filters, "orderType": "", "orderTypes": "G001"})
    ] == ["2"]


@pytest.mark.asyncio
async def test_station_rate_and_detail_respect_multiple_order_types(monkeypatch):
    orders = [
        {
            "aufnr": number,
            "plannedStartDate": "2026-03-01",
            "orderQuantity": 1,
            "raw": {
                "data": {
                    "AUFNR": number,
                    "GSTRS": "2026-03-01",
                    "GAMNG": 1,
                    "MAKTX_TH": "M",
                    "AUART": kind,
                }
            },
        }
        for number, kind in [("1", "PP01"), ("2", "G001"), ("3", "PP02")]
    ]
    records = [
        {
            "AUFNR": number,
            "PCODE": f"SN{number}",
            "SPEC": "OP10",
            "MAKTX_TH": "M",
            "GSTRS": "20260301",
        }
        for number in ("1", "2", "3")
    ]
    monkeypatch.setattr(rty_gateway.data_gateway, "all_orders", AsyncMock(return_value=orders))
    monkeypatch.setattr(rty_gateway, "_station_records_in_range", AsyncMock(return_value=records))
    monkeypatch.setattr(rty_gateway, "_station_repairs_for_sns", AsyncMock(return_value=[]))
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_orders", AsyncMock(return_value={}))
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_composite_groups", AsyncMock(return_value={}))
    rates = await rty_gateway.station_rates(
        "2026-03-01", "2026-03-31", group_by="productModel", order_types=["PP01", "G001"]
    )
    details = await rty_gateway.station_details(
        "OP10",
        "2026-03-01",
        "2026-03-31",
        "input",
        group_by="productModel",
        order_types=["PP01", "G001"],
    )
    assert rates[0].totalInputCount == rates[0].inputCount == 2
    assert {row.sn for row in details} == {"SN1", "SN2"}


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
