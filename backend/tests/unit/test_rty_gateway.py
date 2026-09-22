from unittest.mock import AsyncMock

import pytest

from app.services import rty_gateway


@pytest.mark.asyncio
async def test_orders_pushes_gstrs_dates_to_gateway_and_filters_locally(monkeypatch):
    captured: dict[str, object] = {}

    async def all_orders(**filters):
        captured.update(filters)
        return [
            {
                "aufnr": "before",
                "plannedStartDate": "2026-01-01",
                "raw": {"data": {"AUFNR": "before", "IF_L6": ""}},
            },
            {
                "aufnr": "inside",
                "plannedStartDate": "2026-01-15",
                "raw": {"data": {"AUFNR": "inside", "IF_L6": ""}},
            },
            {
                "aufnr": "after",
                "plannedStartDate": "2026-02-01",
                "raw": {"data": {"AUFNR": "after", "IF_L6": ""}},
            },
        ]

    monkeypatch.setattr(rty_gateway.data_gateway, "all_orders", all_orders)
    rows = await rty_gateway._orders(
        {"dateFrom": "2026-01-02", "dateTo": "2026-01-31", "orderScope": "normal"}
    )

    assert captured == {
        "max_rows": 1_000_000,
        "dateFrom": "2026-01-02",
        "dateTo": "2026-01-31",
    }
    assert [row["aufnr"] for row in rows] == ["inside"]


@pytest.mark.asyncio
async def test_excluded_orders_keeps_l6_scope_separate_and_lists_all_exclusion_reasons(monkeypatch):
    monkeypatch.setattr(
        rty_gateway.data_gateway,
        "all_orders",
        AsyncMock(
            return_value=[
                {
                    "aufnr": "normal-status",
                    "plannedStartDate": "2026-01-03",
                    "raw": {"data": {"AUFNR": "normal-status", "ZSTAT": "DLID"}},
                },
                {
                    "aufnr": "normal-type",
                    "plannedStartDate": "2026-01-02",
                    "raw": {"data": {"AUFNR": "normal-type", "AUART": "C001"}},
                },
                {
                    "aufnr": "l6-both",
                    "plannedStartDate": "2026-01-01",
                    "raw": {
                        "data": {
                            "AUFNR": "l6-both",
                            "IF_L6": "X",
                            "ZSTAT": "RELEASED",
                            "AUART": "C001",
                        }
                    },
                },
            ]
        ),
    )

    normal = await rty_gateway.excluded_orders(
        {"orderScope": "normal", "dateFrom": "2026-01-01", "dateTo": "2026-12-31"}, 1, 50
    )
    l6 = await rty_gateway.excluded_orders(
        {"orderScope": "l6", "dateFrom": "2026-01-01", "dateTo": "2026-12-31"}, 1, 50
    )

    assert [item.productionOrder for item in normal["items"]] == ["normal-status", "normal-type"]
    assert [item.exclusionReasons for item in l6["items"]] == [
        ["订单状态：RELEASED", "订单类型：C001"]
    ]


@pytest.mark.asyncio
async def test_rty_list_aggregates_orders_and_distinct_fault_sns(monkeypatch):
    gateway = rty_gateway.data_gateway
    monkeypatch.setattr(
        gateway,
        "all_orders",
        AsyncMock(
            return_value=[
                {
                    "id": "SG:1",
                    "source": "SG",
                    "aufnr": "1",
                    "salesOrder": "SO",
                    "productionModel": "M",
                    "inventoryLocation": "B",
                    "plannedStartDate": "2026-01-02",
                    "orderQuantity": 3,
                    "raw": {
                        "data": {
                            "AUFNR": "1",
                            "VBELN": "SO",
                            "MAKTX_TH": "M",
                            "LGORT": "B",
                            "WMENG": 3,
                            "IF_L6": "",
                        }
                    },
                },
                {
                    "id": "SG:2",
                    "source": "SG",
                    "aufnr": "2",
                    "salesOrder": "SO",
                    "productionModel": "M",
                    "inventoryLocation": "B",
                    "plannedStartDate": "2026-01-03",
                    "orderQuantity": 2,
                    "raw": {
                        "data": {
                            "AUFNR": "2",
                            "VBELN": "SO",
                            "MAKTX_TH": "M",
                            "LGORT": "B",
                            "WMENG": 2,
                            "IF_L6": "",
                        }
                    },
                },
            ]
        ),
    )
    monkeypatch.setattr(
        gateway,
        "fault_lookup",
        AsyncMock(
            return_value=[
                {
                    "id": "f1",
                    "productionOrder": "000000000001",
                    "serialNumber": "SN1",
                    "raw": {"AUFNR": "000000000001", "PCODE": "SN1", "ZDATE_WX": "20260103"},
                },
                {
                    "id": "f2",
                    "productionOrder": "1",
                    "serialNumber": "SN1",
                    "raw": {"AUFNR": "1", "PCODE": "SN1", "ZDATE_WX": "20260103"},
                },
            ]
        ),
    )
    result = await rty_gateway.rty_list(
        {"orderScope": "normal", "dateFrom": "2026-01-01", "dateTo": "2026-12-31"}, 1, 50, {"M": 95}
    )
    assert result["total"] == 1
    assert result["items"][0].inputCount == 5
    assert result["items"][0].defectCount == 1
    assert result["items"][0].rtyRate == 80.0


@pytest.mark.asyncio
async def test_details_by_orders_resolves_fault_links_to_full_rows(monkeypatch):
    gateway = rty_gateway.data_gateway
    fault_lookup = AsyncMock(
        return_value=[
            {
                "id": "f1",
                "productionOrder": "000000000001",
                "serialNumber": "SN1",
                "raw": {"AUFNR": "000000000001", "PCODE": "SN1", "ZDATE_WX": "20260103"},
            }
        ]
    )
    monkeypatch.setattr(gateway, "fault_lookup", fault_lookup)
    fault_rows_by_sns = AsyncMock(
        return_value=[
            {
                "PCODE": "SN1",
                "AUFNR": "000000000001",
                "VBELN": "SO-1",
                "ZNGWD": "F01",
                "ZWXWD": "Full fault description",
                "ZDATE_WX": "20260103",
            }
        ]
    )
    monkeypatch.setattr(gateway, "fault_rows_by_sns", fault_rows_by_sns)

    details = await rty_gateway.details_by_orders(
        {"1"}, date_from="2026-01-01", date_to="2026-01-31"
    )

    assert [detail.sn for detail in details] == ["SN1"]
    fault_lookup.assert_awaited_once_with(
        production_orders=["000000000001", "1"],
        date_from="2026-01-01",
        date_to="2026-01-31",
    )
    fault_rows_by_sns.assert_awaited_once_with(
        ["SN1"], date_from="2026-01-01", date_to="2026-01-31", station=""
    )


@pytest.mark.asyncio
async def test_rty_list_only_loads_faults_for_the_requested_page(monkeypatch):
    gateway = rty_gateway.data_gateway
    monkeypatch.setattr(
        gateway,
        "all_orders",
        AsyncMock(
            return_value=[
                {
                    "aufnr": f"{index}",
                    "plannedStartDate": "2026-01-02",
                    "orderQuantity": 1,
                    "raw": {
                        "data": {
                            "AUFNR": str(index),
                            "VBELN": f"SO-{index}",
                            "MAKTX_TH": "M",
                            "LGORT": "B",
                            "WMENG": 1,
                            "IF_L6": "",
                        }
                    },
                }
                for index in range(3)
            ],
        ),
    )
    queried_orders: list[set[str]] = []

    async def faults(orders, *, model=None, date_from=None, date_to=None):
        queried_orders.append(orders)
        return {}

    monkeypatch.setattr(rty_gateway, "_fault_sns_by_orders", faults)
    result = await rty_gateway.rty_list(
        {"orderScope": "normal", "dateFrom": "2026-01-01", "dateTo": "2026-12-31"},
        2,
        1,
        {},
    )

    assert result["total"] == 3
    assert [row.productionOrder for row in result["items"]] == ["1"]
    assert queried_orders == [{"1"}]


@pytest.mark.asyncio
async def test_composite_faults_use_padded_binding_orders_and_map_child_sn_to_head_sn(monkeypatch):
    queried_bindings: list[dict[str, str]] = []

    async def faults(orders, *, date_from=None, date_to=None, chunk_size=500):
        if orders == {"1"}:
            return []
        assert orders == {"2"}
        return [{"AUFNR": "2", "PCODE": "ITEM-SN"}]

    async def bindings(filters):
        queried_bindings.append(filters)
        return [
            {
                "raw": {
                    "AUFNR_HEAD": "000000000001",
                    "AUFNR_ITEM": "000000000002",
                    "ZCODE_HEAD": "HEAD-SN",
                    "ZCODE_ITEM": "ITEM-SN",
                }
            }
        ]

    monkeypatch.setattr(rty_gateway, "_faults_for_orders", faults)
    monkeypatch.setattr(rty_gateway, "_bindings", bindings)

    result = await rty_gateway._fault_sns_by_composite_groups(
        {"group": {"orders": {"1"}}}, date_from="2026-01-01", date_to="2026-12-31"
    )

    assert result["group"]["1"] == {"HEAD-SN"}
    assert queried_bindings == [{"headOrder": "000000000001"}]


@pytest.mark.asyncio
async def test_all_pages_handles_null_items(monkeypatch):
    gateway = rty_gateway.data_gateway
    monkeypatch.setattr(
        gateway,
        "request_json",
        AsyncMock(return_value={"items": None, "page": 1, "pageSize": 100, "total": 0}),
    )
    assert await gateway.all_pages("GET", "/api/orders") == []


@pytest.mark.asyncio
async def test_station_detail_repairs_use_the_same_local_station_match_as_summary(monkeypatch):
    gateway = rty_gateway.data_gateway
    monkeypatch.setattr(
        gateway,
        "all_station_rows",
        AsyncMock(
            return_value=[
                {
                    "raw": {
                        "PCODE": "SN-1",
                        "SPEC": "Line-OP205:装配",
                        "MAKTX_TH": "M-1",
                        "GSTRS": "20260515",
                        "ACTUAL_START_TIME": "2026-05-01 08:00:00",
                    }
                }
            ]
        ),
    )
    faults = AsyncMock(
        return_value=[
            {"raw": {"PCODE": "SN-1", "ZNGGZ": "Line-OP205:装配", "ZDATE_WX": "20260502"}}
        ]
    )
    monkeypatch.setattr(gateway, "fault_rows_by_sns", faults)

    rows = await rty_gateway.station_details(
        "OP205",
        "2026-05-01",
        "2026-05-31",
        "defect",
        product_model="M-1",
        group_by="productModel",
        dimension_value="M-1",
    )

    assert [row.sn for row in rows] == ["SN-1"]
    assert rows[0].passDate == "20260515"
    assert faults.await_args.kwargs["station"] == ""


@pytest.mark.asyncio
async def test_station_rates_filter_input_by_gstrs_not_actual_pass_time(monkeypatch):
    gateway = rty_gateway.data_gateway
    station_rows = AsyncMock(
        return_value=[
            {
                "PCODE": "SN-IN",
                "SPEC": "Line-OP205:装配",
                "MAKTX_TH": "M-1",
                "GSTRS": "20260515",
                "ACTUAL_START_TIME": "20260615 08:00:00",
            },
            {
                "PCODE": "SN-OUT",
                "SPEC": "Line-OP205:装配",
                "MAKTX_TH": "M-1",
                "GSTRS": "20260615",
                "ACTUAL_START_TIME": "20260515 08:00:00",
            },
        ]
    )
    monkeypatch.setattr(gateway, "all_station_rows", station_rows)
    monkeypatch.setattr(rty_gateway, "_faults_for_sns", AsyncMock(return_value=[]))

    rows = await rty_gateway.station_rates(
        "2026-05-01", "2026-05-31", product_model="M-1", group_by="productModel"
    )

    assert [(row.dimensionValue, row.stationCode, row.inputCount) for row in rows] == [
        ("M-1", "OP205", 1)
    ]
    assert station_rows.await_args.kwargs["timeField"] == "planned"
