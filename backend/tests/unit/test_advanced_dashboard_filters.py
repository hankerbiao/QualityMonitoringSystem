from unittest.mock import AsyncMock

import pytest

from app.api import lrr
from app.services import advanced_filters, rty_gateway


@pytest.mark.asyncio
async def test_station_multi_value_filters_match_and_keep_order_quantity(monkeypatch):
    orders = [
        {
            "aufnr": number,
            "plannedStartDate": "2026-03-01",
            "raw": {
                "data": {
                    "AUFNR": number,
                    "GSTRS": "2026-03-01",
                    "GAMNG": quantity,
                    "MAKTX_TH": "M",
                    "VBELN": sales,
                }
            },
        }
        for number, sales, quantity in [("1", "S1", 10), ("2", "S1", 20), ("3", "S2", 30)]
    ]
    records = [
        {"AUFNR": n, "PCODE": f"SN{n}", "SPEC": "OP10", "MAKTX_TH": "M", "GSTRS": "20260301"}
        for n in ("1", "2", "3")
    ]
    monkeypatch.setattr(rty_gateway.data_gateway, "all_orders", AsyncMock(return_value=orders))
    monkeypatch.setattr(rty_gateway, "_station_records_in_range", AsyncMock(return_value=records))
    monkeypatch.setattr(rty_gateway, "_station_repairs_for_sns", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        rty_gateway,
        "_fault_sns_by_orders",
        AsyncMock(return_value={"1": {"SN1", "OTHER"}, "2": {"SN2"}}),
    )
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_composite_groups", AsyncMock(return_value={}))
    filters = {
        "serial_numbers": ["SN1", "SN2", "SN3"],
        "production_orders": ["1", "2"],
        "sales_orders": ["S1"],
    }
    rates = await rty_gateway.station_rates(
        "2026-03-01", "2026-03-31", group_by="productModel", **filters
    )
    details = await rty_gateway.station_details(
        "OP10", "2026-03-01", "2026-03-31", "input", group_by="productModel", **filters
    )
    assert rates[0].inputCount == 2
    assert rates[0].totalInputCount == 30
    assert rates[0].totalDefectCount == 2
    assert {row.sn for row in details} == {"SN1", "SN2"}


@pytest.mark.asyncio
async def test_lrr_filters_orders_and_sn_with_independent_cache_keys(monkeypatch):
    bom = [{"AUFNR_1": "1", "VBELN_EX": "S1"}, {"AUFNR_1": "2", "VBELN_EX": "S2"}]
    monkeypatch.setattr(advanced_filters, "orders_for_sns", AsyncMock(return_value={"1", "2"}))
    result = await lrr._advanced_bom(
        bom, ("SN1", "SN2"), ("1", "2"), ("S1",), "2026-01-01", "2026-01-31"
    )
    assert result == [bom[0]]
    assert lrr._advanced_faults([{"PCODE": "SN1"}, {"PCODE": "SN3"}], ("SN1", "SN2")) == [
        {"PCODE": "SN1"}
    ]
    assert (
        lrr.LRRListQuery(serial_numbers=("SN1",)).fingerprint
        != lrr.LRRListQuery(serial_numbers=("SN2",)).fingerprint
    )


@pytest.mark.asyncio
async def test_sn_order_resolution_uses_station_and_fault_associations(monkeypatch):
    monkeypatch.setattr(
        rty_gateway,
        "_station_records_in_range",
        AsyncMock(
            return_value=[{"PCODE": "SN1", "AUFNR": "0001"}, {"PCODE": "other", "AUFNR": "3"}]
        ),
    )
    monkeypatch.setattr(
        rty_gateway, "_faults_for_sns", AsyncMock(return_value=[{"PCODE": "SN1", "AUFNR": "2"}])
    )
    assert await advanced_filters.orders_for_sns({"SN1"}, "2026-01-01", "2026-01-31") == {"1", "2"}
    assert await advanced_filters.orders_for_sns(
        {"SN1"}, "2026-01-01", "2026-01-31", include_faults=False
    ) == {"1"}


@pytest.mark.asyncio
async def test_repair_quality_filters_selected_orders_and_keeps_sn_lifecycle(monkeypatch):
    from app.services import repair_quality

    orders = [{"id": "id1", "aufnr": "1"}, {"id": "id2", "aufnr": "2"}]
    full = [
        {"_id": f"id{n}", "data": {"AUFNR": n, "VBELN": "SO", "ZDATE_STARTED": "20260301"}}
        for n in ("1", "2")
    ]
    monkeypatch.setattr(repair_quality.data_gateway, "all_orders", AsyncMock(return_value=orders))
    monkeypatch.setattr(repair_quality.data_gateway, "export_rows", AsyncMock(return_value=full))
    monkeypatch.setattr(
        rty_gateway,
        "_faults_for_orders",
        AsyncMock(return_value=[{"PCODE": "SN1", "AUFNR": "1"}, {"PCODE": "SN2", "AUFNR": "2"}]),
    )
    monkeypatch.setattr(
        rty_gateway,
        "_faults_for_sns",
        AsyncMock(
            return_value=[
                {"PCODE": "SN1", "AUFNR": "1", "_id": "a"},
                {"PCODE": "SN1", "AUFNR": "2", "_id": "b"},
            ]
        ),
    )
    selected, repairs, _ = await repair_quality._load_sources_uncached(
        "2026-03-01",
        "2026-03-31",
        serial_numbers=["SN1"],
        production_orders=["1", "2"],
        sales_orders=["SO"],
    )
    assert [row["AUFNR"] for row in selected] == ["1"]
    assert [row["_id"] for row in repairs] == ["a", "b"]


@pytest.mark.asyncio
async def test_reinsert_filters_orders_and_faults_before_aggregation(monkeypatch):
    from app.services import reinsert_rate

    orders = [
        {"AUFNR": "1", "VBELN": "S1", "GAMNG": "10"},
        {"AUFNR": "2", "VBELN": "S2", "GAMNG": "20"},
    ]
    monkeypatch.setattr(reinsert_rate.rty_export, "_load_orders", AsyncMock(return_value=orders))
    monkeypatch.setattr(advanced_filters, "orders_for_sns", AsyncMock(return_value={"1", "2"}))

    async def batches(*args, **kwargs):
        yield [
            {"id": "a", "raw": {"AUFNR": "1", "PCODE": "SN1"}},
            {"id": "b", "raw": {"AUFNR": "1", "PCODE": "OTHER"}},
        ]

    monkeypatch.setattr(reinsert_rate.rty_export, "_source_batches", batches)
    result_orders, faults, _, _ = await reinsert_rate.load_sources(
        "2026-03-01",
        "2026-03-31",
        None,
        None,
        None,
        serial_numbers=["SN1", "SN2"],
        production_orders=["1", "2"],
        sales_orders=["S1"],
    )
    assert [row["AUFNR"] for row in result_orders] == ["1"]
    assert [row["PCODE"] for row in faults] == ["SN1"]
