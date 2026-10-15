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
async def test_cycle_data_filters_orders_to_exact_days_before_monthly_aggregation(monkeypatch):
    queries: list[dict[str, object]] = []

    async def all_orders(**filters):
        queries.append(filters)
        return [
            {
                "aufnr": order,
                "productionModel": "M-1",
                "inventoryLocation": "B-1",
                "plannedStartDate": start_date,
                "orderQuantity": quantity,
                "raw": {
                    "data": {
                        "AUFNR": order,
                        "MAKTX_TH": "M-1",
                        "LGORT": "B-1",
                        "GSTRS": start_date,
                        "WMENG": quantity,
                        "IF_L6": "",
                    }
                },
            }
            for order, start_date, quantity in [
                ("before", "2026-04-13", 100),
                ("start", "2026-04-14", 5),
                ("end", "2026-04-20", 7),
                ("after", "2026-04-21", 100),
            ]
        ]

    faults_for_orders = AsyncMock(return_value=[])
    monkeypatch.setattr(rty_gateway.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(rty_gateway, "_faults_for_orders", faults_for_orders)
    monkeypatch.setattr(
        rty_gateway,
        "_fault_sns_by_composite_groups",
        AsyncMock(return_value={}),
    )

    rows = await rty_gateway.cycle_data(
        "normal",
        None,
        {"M-1": 95},
        date_from="2026-04-14",
        date_to="2026-04-20",
    )
    last_day_rows = await rty_gateway.cycle_data(
        "normal",
        None,
        {"M-1": 95},
        date_from="2026-04-20",
        date_to="2026-04-20",
    )

    assert queries[0]["dateFrom"] == "2026-04-14"
    assert queries[0]["dateTo"] == "2026-04-20"
    assert queries[1]["dateFrom"] == "2026-04-20"
    assert queries[1]["dateTo"] == "2026-04-20"
    assert len(queries) == 2
    assert len(rows) == 1
    assert rows[0].time == "2026-04"
    assert rows[0].inputCount == 12
    assert len(last_day_rows) == 1
    assert last_day_rows[0].inputCount == 7
    assert faults_for_orders.await_args_list[0].args == ({"start", "end"},)
    assert faults_for_orders.await_args_list[1].args == ({"end"},)


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

    assert result["group"].by_order["1"] == {"HEAD-SN"}
    assert result["group"].source_sns == {"ITEM-SN"}
    assert queried_bindings == [{"headOrder": "000000000001"}]


@pytest.mark.asyncio
@pytest.mark.parametrize("view", ["cycle", "list"])
async def test_composite_export_preserves_child_repair_sns(monkeypatch, view):
    monkeypatch.setattr(
        rty_gateway,
        "_orders",
        AsyncMock(
            return_value=[
                {
                    "aufnr": "1",
                    "gstrs_date": "2026-09-15",
                    "data": {
                        "MAKTX_TH": "6215 C32",
                        "LGORT": "B1",
                        "VBELN": "SO-1",
                        "WMENG": 10,
                    },
                }
            ]
        ),
    )
    monkeypatch.setattr(
        rty_gateway,
        "_bindings",
        AsyncMock(
            return_value=[
                {
                    "AUFNR_HEAD": "1",
                    "AUFNR_ITEM": "2",
                    "ZCODE_HEAD": "HEAD-SN",
                    "ZCODE_ITEM": "CHILD-SN",
                }
            ]
        ),
    )

    async def faults(orders, **_kwargs):
        return [{"AUFNR": "2", "PCODE": "CHILD-SN"}] if "2" in orders else []

    monkeypatch.setattr(rty_gateway, "_faults_for_orders", faults)
    if view == "cycle":
        rows = await rty_gateway._build_cycle_data("normal", None, {}, "2026-09-01", "2026-09-30")
    else:
        rows = (await rty_gateway._build_rty_list({"orderScope": "normal"}, 1, 50, {}))["items"]

    assert rows[0].defectCount == 1
    assert rows[0].serialNumbers == ["HEAD-SN"]
    assert rows[0].faultSerialNumbers == ["CHILD-SN"]


@pytest.mark.asyncio
async def test_rty_list_coalesces_identical_requests(monkeypatch):
    calls = 0

    async def orders(**_filters):
        nonlocal calls
        calls += 1
        return []

    monkeypatch.setattr(rty_gateway.data_gateway, "all_orders", orders)
    from app.services.async_ttl_cache import AsyncTTLCache

    monkeypatch.setattr(rty_gateway, "_RTY_LIST_CACHE", AsyncTTLCache())
    filters = {"orderScope": "normal", "dateFrom": "2026-01-01", "dateTo": "2026-01-31"}

    await rty_gateway.rty_list(filters, 1, 50, {})
    await rty_gateway.rty_list(filters, 1, 50, {})

    assert calls == 1


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
            {
                "raw": {
                    "PCODE": "SN-1",
                    "ZNGGZ": "Line-OP205:装配",
                    "GSTRS": "20260515",
                    "ZDATE_WX": "20260702",
                }
            }
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
    assert faults.await_args.kwargs["time_field"] == "planned"


@pytest.mark.asyncio
async def test_station_input_details_include_matching_fault_fields(monkeypatch):
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
                    }
                },
                {
                    "raw": {
                        "PCODE": "SN-2",
                        "SPEC": "Line-OP205:装配",
                        "MAKTX_TH": "M-1",
                        "GSTRS": "20260516",
                    }
                },
            ]
        ),
    )
    faults = AsyncMock(
        return_value=[
            {
                "raw": {
                    "PCODE": "SN-1",
                    "ZNGGZ": "Line-OP205:装配",
                    "ZNGWD": "F-001",
                    "ZWXWD": "装配异常",
                    "GSTRS": "20260520",
                    "ZDATE_WX": "20260720",
                    "ZTIME": "103000",
                    "ZUSER": "tester",
                }
            },
            {
                "raw": {
                    "PCODE": "SN-2",
                    "ZNGGZ": "Line-OP210:测试",
                    "ZNGWD": "F-002",
                    "ZWXWD": "其他工位异常",
                }
            },
        ]
    )
    monkeypatch.setattr(gateway, "fault_rows_by_sns", faults)

    rows = await rty_gateway.station_details(
        "OP205",
        "2026-05-01",
        "2026-05-31",
        "input",
        product_model="M-1",
        group_by="productModel",
        dimension_value="M-1",
    )

    assert rows[0].sn == "SN-1"
    assert rows[0].defectCode == "F-001"
    assert rows[0].description == "装配异常"
    assert rows[0].repairTime == "20260720 103000"
    assert rows[1].sn == "SN-2"
    assert rows[1].defectCode == ""
    assert rows[1].description == ""
    assert faults.await_args.kwargs == {
        "date_from": "20260501",
        "date_to": "20260531",
        "station": "",
        "time_field": "planned",
    }


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
    monkeypatch.setattr(gateway, "all_orders", AsyncMock(return_value=[]))
    monkeypatch.setattr(rty_gateway, "_faults_for_sns", AsyncMock(return_value=[]))

    rows = await rty_gateway.station_rates(
        "2026-05-01", "2026-05-31", product_model="M-1", group_by="productModel"
    )

    assert [(row.dimensionValue, row.stationCode, row.inputCount) for row in rows] == [
        ("M-1", "OP205", 1)
    ]
    assert station_rows.await_args.kwargs["timeField"] == "planned"
    assert station_rows.await_args.kwargs["productModel"] == "M-1"


@pytest.mark.asyncio
async def test_station_rates_uses_scoped_orders_when_station_rows_omit_if_l6(monkeypatch):
    gateway = rty_gateway.data_gateway
    monkeypatch.setattr(
        gateway,
        "all_orders",
        AsyncMock(
            return_value=[
                {
                    "aufnr": "L6-1",
                    "plannedStartDate": "2026-05-15",
                    "productionModel": "M-1",
                    "orderQuantity": 10,
                    "raw": {"data": {"AUFNR": "L6-1", "MAKTX_TH": "M-1", "IF_L6": "X"}},
                },
                {
                    "aufnr": "NORMAL-1",
                    "plannedStartDate": "2026-05-15",
                    "productionModel": "M-1",
                    "orderQuantity": 20,
                    "raw": {"data": {"AUFNR": "NORMAL-1", "MAKTX_TH": "M-1", "IF_L6": ""}},
                },
            ]
        ),
    )
    monkeypatch.setattr(
        gateway,
        "all_station_rows",
        AsyncMock(
            return_value=[
                {"PCODE": "SN-L6", "AUFNR": "L6-1", "SPEC": "Line-OP205:装配", "MAKTX_TH": "M-1", "GSTRS": "20260515"},
                {"PCODE": "SN-NORMAL", "AUFNR": "NORMAL-1", "SPEC": "Line-OP205:装配", "MAKTX_TH": "M-1", "GSTRS": "20260515"},
            ]
        ),
    )
    monkeypatch.setattr(rty_gateway, "_faults_for_sns", AsyncMock(return_value=[]))
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_orders", AsyncMock(return_value={}))
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_composite_groups", AsyncMock(return_value={}))

    rows = await rty_gateway.station_rates(
        "2026-05-01", "2026-05-31", product_model="M-1", group_by="productModel", order_scope="l6"
    )

    assert [(row.dimensionValue, row.inputCount) for row in rows] == [("M-1", 1)]


@pytest.mark.asyncio
async def test_station_rates_excludes_rows_without_gstrs(monkeypatch):
    gateway = rty_gateway.data_gateway
    station_rows = AsyncMock(
        return_value=[
            {
                "PCODE": "SN-IN",
                "SPEC": "Line-OP205:装配",
                "MAKTX_TH": "M-1",
                "ACTUAL_START_TIME": "2026-05-15 08:00:00",
            },
            {
                "PCODE": "SN-OUT",
                "SPEC": "Line-OP205:装配",
                "MAKTX_TH": "M-1",
                "ACTUAL_START_TIME": "2026-06-15 08:00:00",
            },
        ]
    )
    monkeypatch.setattr(gateway, "all_station_rows", station_rows)
    monkeypatch.setattr(gateway, "all_orders", AsyncMock(return_value=[]))
    monkeypatch.setattr(rty_gateway, "_faults_for_sns", AsyncMock(return_value=[]))

    rows = await rty_gateway.station_rates(
        "2026-05-01", "2026-05-31", product_model="M-1", group_by="productModel"
    )

    assert rows == []
    assert station_rows.await_args.kwargs["productModel"] == "M-1"


@pytest.mark.asyncio
async def test_station_repairs_filter_by_repair_table_gstrs_not_repair_date(monkeypatch):
    repairs = AsyncMock(
        return_value=[
            {
                "raw": {
                    "PCODE": "SN-IN",
                    "GSTRS": "20260520",
                    "ZDATE_WX": "20260720",
                }
            },
            {
                "raw": {
                    "PCODE": "SN-OUT",
                    "GSTRS": "20260720",
                    "ZDATE_WX": "20260520",
                }
            },
        ]
    )
    monkeypatch.setattr(rty_gateway, "_faults_for_sns", repairs)

    rows = await rty_gateway._station_repairs_for_sns(
        {"SN-IN", "SN-OUT"}, date_from="20260501", date_to="20260531"
    )

    assert [row["raw"]["PCODE"] for row in rows] == ["SN-IN"]
    assert repairs.await_args.kwargs == {
        "date_from": "20260501",
        "date_to": "20260531",
        "time_field": "planned",
    }


@pytest.mark.asyncio
async def test_station_rates_deduplicates_matching_repair_sns(monkeypatch):
    gateway = rty_gateway.data_gateway
    monkeypatch.setattr(
        gateway,
        "all_station_rows",
        AsyncMock(
            return_value=[
                {
                    "PCODE": "SN-1",
                    "SPEC": "Line-OP205:装配",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20260515",
                },
                {
                    "PCODE": "SN-2",
                    "SPEC": "Line-OP205:装配",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20260516",
                },
            ]
        ),
    )
    monkeypatch.setattr(gateway, "all_orders", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        rty_gateway,
        "_faults_for_sns",
        AsyncMock(
            return_value=[
                {"PCODE": "SN-1", "ZNGGZ": "Line-OP205:装配", "GSTRS": "20260520"},
                {"PCODE": "SN-1", "ZNGGZ": "Line-OP205:装配", "GSTRS": "20260520"},
                {"PCODE": "SN-2", "ZNGGZ": "Line-OP205:装配", "GSTRS": "20260521"},
            ]
        ),
    )

    rows = await rty_gateway.station_rates(
        "2026-05-01", "2026-05-31", product_model="M-1", group_by="productModel"
    )

    assert len(rows) == 1
    assert rows[0].inputCount == 2
    assert rows[0].defectCount == 2
    assert rows[0].passRate == 0


@pytest.mark.asyncio
async def test_station_rates_uses_repair_ng_station_without_same_sn_pass_row(monkeypatch):
    gateway = rty_gateway.data_gateway
    monkeypatch.setattr(
        gateway,
        "all_station_rows",
        AsyncMock(
            return_value=[
                {
                    "PCODE": "SN-1",
                    "SPEC": "Line-OP205:装配",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20260515",
                },
                {
                    "PCODE": "SN-2",
                    "SPEC": "Line-OP215:综检",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20260516",
                },
            ]
        ),
    )
    monkeypatch.setattr(gateway, "all_orders", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        rty_gateway,
        "_faults_for_sns",
        AsyncMock(
            return_value=[
                {"PCODE": "SN-1", "ZNGGZ": "Line-OP215:综检", "GSTRS": "20260520"},
                {"PCODE": "SN-1", "ZNGGZ": "Line-OP215:综检", "GSTRS": "20260520"},
            ]
        ),
    )

    rows = await rty_gateway.station_rates(
        "2026-05-01", "2026-05-31", product_model="M-1", group_by="productModel"
    )

    by_station = {row.stationCode: row for row in rows}
    assert by_station["OP215"].inputCount == 1
    assert by_station["OP215"].defectCount == 1
    assert by_station["OP215"].passRate == 0


@pytest.mark.asyncio
async def test_station_rates_uses_the_same_wmeng_and_fault_sn_summary_as_rty(monkeypatch):
    gateway = rty_gateway.data_gateway
    monkeypatch.setattr(
        gateway,
        "all_orders",
        AsyncMock(
            return_value=[
                {
                    "aufnr": "1",
                    "productionModel": "6210 C21",
                    "inventoryLocation": "B1",
                    "plannedStartDate": "2026-07-15",
                    "orderQuantity": 101,
                    "raw": {
                        "data": {
                            "AUFNR": "1",
                            "MAKTX_TH": "6210 C21",
                            "LGORT": "B1",
                            "WMENG": 101,
                            "IF_L6": "",
                        }
                    },
                }
            ]
        ),
    )
    monkeypatch.setattr(
        gateway,
        "all_station_rows",
        AsyncMock(
            return_value=[
                {
                    "PCODE": "SN-1",
                    "SPEC": "Line-OP205:装配",
                    "MAKTX_TH": "6210 C21",
                    "LGORT": "B1",
                    "GSTRS": "20260715",
                    "IF_L6": "",
                }
            ]
        ),
    )
    faults = AsyncMock(
        return_value=[
            {"AUFNR": "1", "PCODE": "SN-1"},
            {"AUFNR": "000000000001", "PCODE": "SN-1"},
            {"AUFNR": "1", "PCODE": "SN-2"},
        ]
    )
    monkeypatch.setattr(gateway, "fault_lookup", faults)
    monkeypatch.setattr(rty_gateway, "_faults_for_sns", AsyncMock(return_value=[]))

    rows = await rty_gateway.station_rates(
        "2026-07-01", "2026-07-31", product_model="6210 C21", group_by="productModel"
    )

    assert len(rows) == 1
    assert rows[0].inputCount == 1
    assert rows[0].totalInputCount == 101
    assert rows[0].totalDefectCount == 2
    assert faults.await_args.kwargs["date_from"] == rty_gateway.REPAIR_YEAR_START
    assert faults.await_args.kwargs["date_to"] == rty_gateway.REPAIR_YEAR_END


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["6210 C21", "6215 C32"])
async def test_station_rty_matches_cycle_for_repairs_outside_selected_order_dates(
    monkeypatch, model
):
    gateway = rty_gateway.data_gateway
    composite = model in rty_gateway.COMPOSITE_MODEL_ITEMS
    monkeypatch.setattr(
        gateway,
        "all_orders",
        AsyncMock(
            return_value=[
                {
                    "aufnr": order,
                    "productionModel": model,
                    "inventoryLocation": "B1",
                    "plannedStartDate": planned_date,
                    "orderQuantity": quantity,
                }
                for order, planned_date, quantity in [
                    ("1", "2026-10-05", 600),
                    ("2", "2026-10-11", 658),
                    ("3", "2026-10-12", 200),
                ]
            ]
        ),
    )
    monkeypatch.setattr(
        gateway,
        "all_station_rows",
        AsyncMock(
            return_value=[
                {
                    "PCODE": "SN-IN",
                    "AUFNR": "1",
                    "SPEC": "OP205",
                    "MAKTX_TH": model,
                    "GSTRS": "20261005",
                }
            ]
        ),
    )
    late_order, late_sn = ("20", "CHILD-LATE") if composite else ("2", "SN-LATE")
    fault_rows = [
        {"AUFNR": order, "PCODE": sn, "ZDATE_WX": repair_date}
        for order, sn, repair_date in [
            ("000000000001", "SN-IN", "20261006"),
            (late_order, late_sn, "20261012"),
            (late_order, late_sn, "20261014"),
            ("1", "SN-PREVIOUS-YEAR", "20251231"),
            ("1", "SN-NEXT-YEAR", "20270101"),
            ("3", "SN-OTHER-ORDER", "20261010"),
        ]
    ]

    async def fault_lookup(*, production_orders, date_from, date_to):
        orders = {rty_gateway.normalize_order(order) for order in production_orders}
        return [
            row
            for row in fault_rows
            if rty_gateway.normalize_order(row["AUFNR"]) in orders
            and date_from <= row["ZDATE_WX"] <= date_to
        ]

    monkeypatch.setattr(gateway, "fault_lookup", fault_lookup)
    monkeypatch.setattr(
        rty_gateway,
        "_bindings",
        AsyncMock(
            return_value=[
                {
                    "AUFNR_HEAD": "000000000002",
                    "AUFNR_ITEM": "000000000020",
                    "ZCODE_HEAD": "SN-LATE",
                    "ZCODE_ITEM": "CHILD-LATE",
                }
            ]
        ),
    )
    station_repairs = AsyncMock(return_value=[{"PCODE": "SN-IN", "ZNGGZ": "OP205"}])
    monkeypatch.setattr(rty_gateway, "_station_repairs_for_sns", station_repairs)

    cycle_rows = await rty_gateway._build_cycle_data("normal", None, {}, "2026-10-05", "2026-10-11")
    station_rows = await rty_gateway.station_rates(
        "2026-10-05", "2026-10-11", product_model=model, group_by="productModel"
    )

    assert len(cycle_rows) == len(station_rows) == 1
    assert station_rows[0].totalInputCount == cycle_rows[0].inputCount == 1258
    assert station_rows[0].totalDefectCount == cycle_rows[0].defectCount == 2
    assert cycle_rows[0].serialNumbers == ["SN-IN", "SN-LATE"]
    assert station_rows[0].inputCount == 1
    assert station_rows[0].defectCount == 1
    station_repairs.assert_awaited_once_with({"SN-IN"}, date_from="20261005", date_to="20261011")


@pytest.mark.asyncio
@pytest.mark.parametrize("group_by", ["productModel", "salesOrder", "productionOrder"])
async def test_station_rty_reuses_cycle_month_and_base_grouping(monkeypatch, group_by):
    gateway = rty_gateway.data_gateway
    order_values = [
        ("1", "2026-07-01", "B1"),
        ("2", "2026-07-01", "B2"),
        ("3", "2026-08-01", "B1"),
        ("4", "2026-07-02", "B1"),
    ]
    monkeypatch.setattr(
        gateway,
        "all_orders",
        AsyncMock(
            return_value=[
                {
                    "aufnr": order,
                    "salesOrder": "SO-1",
                    "productionModel": "6210 C21",
                    "inventoryLocation": base,
                    "plannedStartDate": planned_date,
                    "orderQuantity": 10,
                }
                for order, planned_date, base in order_values
            ]
        ),
    )
    monkeypatch.setattr(
        gateway,
        "all_station_rows",
        AsyncMock(
            return_value=[
                {
                    "AUFNR": order,
                    "VBELN": "SO-1",
                    "MAKTX_TH": "6210 C21",
                    "LGORT": base,
                    "GSTRS": planned_date,
                    "PCODE": "SN-SHARED",
                    "SPEC": "OP205",
                }
                for order, planned_date, base in order_values
            ]
        ),
    )

    async def fault_lookup(*, production_orders, date_from, date_to):
        orders = {rty_gateway.normalize_order(order) for order in production_orders}
        return [
            {"AUFNR": order, "PCODE": "SN-SHARED"}
            for order, _date, _base in order_values
            if order in orders
        ]

    monkeypatch.setattr(gateway, "fault_lookup", fault_lookup)
    monkeypatch.setattr(rty_gateway, "_station_repairs_for_sns", AsyncMock(return_value=[]))

    cycle_rows = await rty_gateway._build_cycle_data("normal", None, {}, "2026-07-01", "2026-08-31")
    station_rows = await rty_gateway.station_rates(
        "2026-07-01", "2026-08-31", product_model="6210 C21", group_by=group_by
    )

    assert len(cycle_rows) == 3
    assert sum(row.inputCount for row in cycle_rows) == 40
    assert sum(row.defectCount for row in cycle_rows) == 3
    if group_by == "productionOrder":
        assert {
            row.dimensionValue: (row.totalInputCount, row.totalDefectCount) for row in station_rows
        } == {order: (10, 1) for order, _date, _base in order_values}
    else:
        assert len(station_rows) == 1
        assert station_rows[0].totalInputCount == sum(row.inputCount for row in cycle_rows)
        assert station_rows[0].totalDefectCount == sum(row.defectCount for row in cycle_rows)


@pytest.mark.asyncio
async def test_station_rates_customer_filter_scopes_station_and_rty_counts(monkeypatch):
    gateway = rty_gateway.data_gateway
    queried_filters: dict[str, object] = {}

    async def all_orders(**filters):
        queried_filters.update(filters)
        return [
            {
                "aufnr": "ORDER-A",
                "customerId": "CUST-A",
                "plannedStartDate": "2026-07-15",
                "orderQuantity": 10,
                "productionModel": "M-1",
                "raw": {
                    "data": {
                        "AUFNR": "ORDER-A",
                        "KID": "CUST-A",
                        "WMENG": 10,
                        "MAKTX_TH": "M-1",
                        "IF_L6": "",
                    }
                },
            },
            {
                "aufnr": "ORDER-B",
                "customerId": "CUST-B",
                "plannedStartDate": "2026-07-15",
                "orderQuantity": 20,
                "productionModel": "M-1",
                "raw": {
                    "data": {
                        "AUFNR": "ORDER-B",
                        "KID": "CUST-B",
                        "WMENG": 20,
                        "MAKTX_TH": "M-1",
                        "IF_L6": "",
                    }
                },
            },
        ]

    monkeypatch.setattr(gateway, "all_orders", all_orders)
    monkeypatch.setattr(
        gateway,
        "all_station_rows",
        AsyncMock(
            return_value=[
                {
                    "PCODE": "SN-A",
                    "AUFNR": "ORDER-A",
                    "SPEC": "Line-OP10:Assembly",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20260715",
                },
                {
                    "PCODE": "SN-B",
                    "AUFNR": "ORDER-B",
                    "SPEC": "Line-OP10:Assembly",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20260715",
                },
            ]
        ),
    )
    repairs = AsyncMock(return_value=[])
    faults = AsyncMock(return_value={"ORDER-A": {"SN-A"}})
    monkeypatch.setattr(rty_gateway, "_station_repairs_for_sns", repairs)
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_orders", faults)
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_composite_groups", AsyncMock(return_value={}))

    rows = await rty_gateway.station_rates(
        "2026-07-01",
        "2026-07-31",
        group_by="productModel",
        customer="CUST-A",
    )

    assert queried_filters["customer"] == "CUST-A"
    assert faults.await_args.args[0] == {"ORDER-A"}
    assert repairs.await_args.args[0] == {"SN-A"}
    assert len(rows) == 1
    assert rows[0].inputCount == 1
    assert rows[0].totalInputCount == 10
    assert rows[0].totalDefectCount == 1


@pytest.mark.asyncio
async def test_station_details_customer_filter_excludes_other_customers(monkeypatch):
    gateway = rty_gateway.data_gateway
    monkeypatch.setattr(
        gateway,
        "all_orders",
        AsyncMock(
            return_value=[
                {
                    "aufnr": "ORDER-A",
                    "customerId": "CUST-A",
                    "plannedStartDate": "2026-07-15",
                    "raw": {"data": {"AUFNR": "ORDER-A", "KID": "CUST-A", "IF_L6": ""}},
                },
                {
                    "aufnr": "ORDER-B",
                    "customerId": "CUST-B",
                    "plannedStartDate": "2026-07-15",
                    "raw": {"data": {"AUFNR": "ORDER-B", "KID": "CUST-B", "IF_L6": ""}},
                },
            ]
        ),
    )
    monkeypatch.setattr(
        gateway,
        "all_station_rows",
        AsyncMock(
            return_value=[
                {
                    "PCODE": "SN-A",
                    "AUFNR": "ORDER-A",
                    "SPEC": "Line-OP10:Assembly",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20260715",
                },
                {
                    "PCODE": "SN-B",
                    "AUFNR": "ORDER-B",
                    "SPEC": "Line-OP10:Assembly",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20260715",
                },
            ]
        ),
    )
    monkeypatch.setattr(rty_gateway, "_station_repairs_for_sns", AsyncMock(return_value=[]))

    rows = await rty_gateway.station_details(
        "OP10",
        "2026-07-01",
        "2026-07-31",
        "input",
        group_by="productModel",
        dimension_value="M-1",
        customer="CUST-A",
    )

    assert [row.sn for row in rows] == ["SN-A"]
