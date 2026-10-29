from unittest.mock import AsyncMock

import pytest

from app.services import rty_gateway


def test_station_filter_can_match_empty_customer_id():
    assert rty_gateway._matches_station_filters(
        {"KID": ""},
        serial_number=None,
        product_models=None,
        bases=None,
        customers=["__NO_CUSTOMER_ID__"],
        group_by="salesOrder",
    )
    assert not rty_gateway._matches_station_filters(
        {"KID": "CUST-1"},
        serial_number=None,
        product_models=None,
        bases=None,
        customers=["__NO_CUSTOMER_ID__"],
        group_by="salesOrder",
    )


@pytest.mark.asyncio
async def test_orders_filter_multiple_dimensions_and_empty_customer(monkeypatch):
    async def all_orders(**_filters):
        return [
            {
                "aufnr": "match",
                "raw": {
                    "data": {
                        "AUFNR": "match",
                        "MAKTX_TH": "M-1",
                        "LGORT": "B-1",
                        "KID": " ",
                        "IF_L6": "",
                    }
                },
            },
            {
                "aufnr": "other-customer",
                "raw": {
                    "data": {
                        "AUFNR": "other-customer",
                        "MAKTX_TH": "M-1",
                        "LGORT": "B-1",
                        "KID": "C-1",
                        "IF_L6": "",
                    }
                },
            },
            {
                "aufnr": "other-model",
                "raw": {
                    "data": {
                        "AUFNR": "other-model",
                        "MAKTX_TH": "M-2",
                        "LGORT": "B-1",
                        "KID": "",
                        "IF_L6": "",
                    }
                },
            },
        ]

    monkeypatch.setattr(rty_gateway.data_gateway, "all_orders", all_orders)

    rows = await rty_gateway._orders(
        {
            "orderScope": "normal",
            "_productModels": ["M-1"],
            "_bases": ["B-1"],
            "_customers": ["C-1", rty_gateway.NO_CUSTOMER_ID],
        }
    )

    assert [row["aufnr"] for row in rows] == ["match", "other-customer"]


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

    details = await rty_gateway.details_by_orders({"1"})

    assert [detail.sn for detail in details] == ["SN1"]
    fault_lookup.assert_awaited_once_with(
        production_orders=["000000000001", "1"],
        time_field="planned",
    )
    fault_rows_by_sns.assert_awaited_once_with(
        ["SN1"], date_from="", date_to="", station="", time_field="planned"
    )


@pytest.mark.asyncio
async def test_order_details_keep_invalid_repair_dates_and_stay_with_selected_orders(monkeypatch):
    gateway = rty_gateway.data_gateway
    monkeypatch.setattr(gateway, "fault_lookup", AsyncMock(return_value=[
        {"productionOrder": "1", "serialNumber": "SN1"},
    ]))
    monkeypatch.setattr(gateway, "fault_rows_by_sns", AsyncMock(return_value=[
        {"_id": "b", "AUFNR": "000000000001", "PCODE": "SN1", "ZDATE_WX": "20251231"},
        {"_id": "a", "AUFNR": "1", "PCODE": "SN1", "ZDATE_WX": ""},
        {"_id": "c", "AUFNR": "1", "PCODE": "SN1", "ZDATE_WX": "invalid"},
        {"_id": "d", "AUFNR": "1", "PCODE": "SN1", "ZDATE_WX": "20270101"},
        {"_id": "other", "AUFNR": "2", "PCODE": "SN1", "ZDATE_WX": ""},
    ]))

    rows = await rty_gateway.details_by_orders({"1"})

    assert [row.id for row in rows] == ["a", "b", "c", "d"]
    assert all(row.repairTime == "" for row in rows)


@pytest.mark.asyncio
@pytest.mark.parametrize("details", [[], [{"AUFNR": "2", "PCODE": "SN1"}]])
async def test_order_details_do_not_substitute_lookup_links(monkeypatch, details):
    monkeypatch.setattr(
        rty_gateway, "_faults_for_orders",
        AsyncMock(return_value=[{"AUFNR": "1", "PCODE": "SN1"}]),
    )
    monkeypatch.setattr(rty_gateway, "_faults_for_sns", AsyncMock(return_value=details))
    assert await rty_gateway.details_by_orders({"1"}) == []


@pytest.mark.asyncio
async def test_order_detail_source_failure_propagates(monkeypatch):
    from app.services.data_gateway_client import DataGatewayError

    monkeypatch.setattr(
        rty_gateway, "_faults_for_orders",
        AsyncMock(return_value=[{"AUFNR": "1", "PCODE": "SN1"}]),
    )
    monkeypatch.setattr(
        rty_gateway, "_faults_for_sns",
        AsyncMock(side_effect=DataGatewayError("detail failed")),
    )
    with pytest.raises(DataGatewayError, match="detail failed"):
        await rty_gateway.details_by_orders({"1"})


def test_fault_deduplication_does_not_depend_on_repair_date():
    base = {"AUFNR": "1", "PCODE": "SN1", "ZNGWD": "F1"}
    rows = [
        {**base, "ZDATE_WX": "", "ZTIME": ""},
        {**base, "ZDATE_WX": "20270101", "ZTIME": "120000"},
        {**base, "_id": "separate-repair-1"},
        {**base, "_id": "separate-repair-2"},
    ]

    assert rty_gateway._dedup_faults(rows) == [rows[0], rows[2], rows[3]]


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

    result = await rty_gateway._fault_sns_by_composite_groups({"group": {"orders": {"1"}}})

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
async def test_station_repair_details_load_matching_full_fault_rows(monkeypatch):
    gateway = rty_gateway.data_gateway
    monkeypatch.setattr(
        gateway,
        "all_station_rows",
        AsyncMock(return_value=[{
            "raw": {
                "PCODE": "SN-1", "SPEC": "Line-OP205:装配",
                "MAKTX_TH": "M-1", "GSTRS": "20260515",
            }
        }]),
    )
    monkeypatch.setattr(
        gateway,
        "fault_rows_by_sns",
        AsyncMock(return_value=[
            {"_source_key": "r1", "PCODE": "SN-1", "AUFNR": "P1", "ZNGGZ": "OP205", "GSTRS": "20260515"},
            {"_source_key": "r2", "PCODE": "SN-1", "AUFNR": "P1", "ZNGGZ": "OP205", "GSTRS": "20260515"},
            {"_source_key": "r3", "PCODE": "SN-1", "AUFNR": "P1", "ZNGGZ": "OP210", "GSTRS": "20260515"},
        ]),
    )
    full_rows = AsyncMock(return_value=[
        {"raw": {"_source_key": "r2", "PCODE": "SN-1", "AUFNR": "P1", "ZNGGZ": "OP205", "ZNGWD3": "现象2", "ZWXWD3": "措施2"}},
        {"raw": {"_source_key": "r1", "PCODE": "SN-1", "AUFNR": "P1", "ZNGGZ": "OP205", "ZNGWD3": "现象1", "ZWXWD3": "措施1"}},
        {"raw": {"_source_key": "r3", "PCODE": "SN-1", "AUFNR": "P1", "ZNGGZ": "OP210", "ZNGWD3": "其他工位"}},
    ])
    monkeypatch.setattr(gateway, "fault_rows_by_host_barcodes", full_rows)

    rows = await rty_gateway.station_details(
        "OP205", "2026-05-01", "2026-05-31", "defect",
        product_model="M-1", group_by="productModel", dimension_value="M-1",
    )

    assert [(row.raw.get("ZNGWD3"), row.raw.get("ZWXWD3")) for row in rows] == [
        ("现象1", "措施1"), ("现象2", "措施2"),
    ]
    assert [row.matchedModel for row in rows] == ["M-1", "M-1"]
    full_rows.assert_awaited_once_with(["SN-1"])


@pytest.mark.asyncio
async def test_station_repair_details_reject_missing_full_record(monkeypatch):
    monkeypatch.setattr(
        rty_gateway.data_gateway, "all_station_rows",
        AsyncMock(return_value=[{"raw": {"PCODE": "SN-1", "SPEC": "OP205", "GSTRS": "20260515"}}]),
    )
    monkeypatch.setattr(
        rty_gateway.data_gateway, "fault_rows_by_sns",
        AsyncMock(return_value=[{
            "_source_key": "r1", "PCODE": "SN-1", "AUFNR": "P1", "ZNGGZ": "OP205", "GSTRS": "20260515",
        }]),
    )
    monkeypatch.setattr(
        rty_gateway.data_gateway, "fault_rows_by_host_barcodes", AsyncMock(return_value=[]),
    )

    with pytest.raises(rty_gateway.DataGatewayError, match="维修明细"):
        await rty_gateway.station_details("OP205", "2026-05-01", "2026-05-31", "defect")


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
    assert rows[0].repairTime == ""
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
                "AUFNR": "ORDER-1",
                "SPEC": "Line-OP205:装配",
                "MAKTX_TH": "M-1",
                "GSTRS": "20260515",
                "ACTUAL_START_TIME": "20260615 08:00:00",
            },
            {
                "PCODE": "SN-OUT",
                "AUFNR": "ORDER-1",
                "SPEC": "Line-OP205:装配",
                "MAKTX_TH": "M-1",
                "GSTRS": "20260615",
                "ACTUAL_START_TIME": "20260515 08:00:00",
            },
        ]
    )
    monkeypatch.setattr(gateway, "all_station_rows", station_rows)
    monkeypatch.setattr(
        gateway,
        "all_orders",
        AsyncMock(return_value=[{"aufnr": "ORDER-1", "plannedStartDate": "2026-05-15", "orderQuantity": 1, "productionModel": "M-1"}]),
    )
    monkeypatch.setattr(rty_gateway, "_faults_for_sns", AsyncMock(return_value=[]))
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_orders", AsyncMock(return_value={}))
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_composite_groups", AsyncMock(return_value={}))

    rows = await rty_gateway.station_rates(
        "2026-05-01", "2026-05-31", product_model="M-1", group_by="productModel"
    )

    assert [(row.dimensionValue, row.stationCode, row.inputCount) for row in rows] == [
        ("M-1", "OP205", 1)
    ]
    assert station_rows.await_args.kwargs["timeField"] == "planned"
    assert station_rows.await_args.kwargs["dateFrom"] == "2026-05-01"
    assert station_rows.await_args.kwargs["dateTo"] == "2026-05-31"
    assert "productModel" not in station_rows.await_args.kwargs


@pytest.mark.asyncio
async def test_station_rates_uses_filtered_orders_when_station_rows_omit_if_l6(monkeypatch):
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
async def test_station_rates_excludes_l6_orders_from_normal_scope_without_station_flag(monkeypatch):
    gateway = rty_gateway.data_gateway
    monkeypatch.setattr(
        gateway,
        "all_orders",
        AsyncMock(
            return_value=[
                {
                    "aufnr": "NORMAL-1",
                    "productionModel": "M-1",
                    "orderQuantity": 407,
                    "plannedStartDate": "2026-10-14",
                    "raw": {
                        "data": {
                            "AUFNR": "NORMAL-1",
                            "MAKTX_TH": "M-1",
                            "WMENG": 407,
                            "IF_L6": "",
                        }
                    },
                },
                {
                    "aufnr": "L6-1",
                    "productionModel": "M-1",
                    "orderQuantity": 70,
                    "plannedStartDate": "2026-10-20",
                    "raw": {
                        "data": {
                            "AUFNR": "L6-1",
                            "MAKTX_TH": "M-1",
                            "WMENG": 70,
                            "IF_L6": "X",
                        }
                    },
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
                    "PCODE": f"SN-{index}",
                    "AUFNR": "NORMAL-1",
                    "SPEC": "OP20",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20261014",
                }
                for index in range(407)
            ]
            + [
                {
                    "PCODE": f"L6-SN-{index}",
                    "AUFNR": "L6-1",
                    "SPEC": "OP20",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20261020",
                }
                for index in range(70)
            ]
        ),
    )
    monkeypatch.setattr(rty_gateway, "_faults_for_sns", AsyncMock(return_value=[]))
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_orders", AsyncMock(return_value={}))
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_composite_groups", AsyncMock(return_value={}))

    rows = await rty_gateway.station_rates(
        "2026-09-27", "2026-10-26", product_model="M-1", group_by="productModel"
    )

    assert len(rows) == 1
    assert rows[0].inputCount == rows[0].totalInputCount == 407


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
    assert station_rows.await_args.kwargs["dateFrom"] == "2026-05-01"


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
                    "AUFNR": "ORDER-1",
                    "SPEC": "Line-OP205:装配",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20260515",
                },
                {
                    "PCODE": "SN-2",
                    "AUFNR": "ORDER-1",
                    "SPEC": "Line-OP205:装配",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20260516",
                },
            ]
        ),
    )
    monkeypatch.setattr(
        gateway,
        "all_orders",
        AsyncMock(return_value=[{"aufnr": "ORDER-1", "plannedStartDate": "2026-05-15", "orderQuantity": 2, "productionModel": "M-1"}]),
    )
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
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_orders", AsyncMock(return_value={}))
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_composite_groups", AsyncMock(return_value={}))

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
                    "AUFNR": "ORDER-1",
                    "SPEC": "Line-OP205:装配",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20260515",
                },
                {
                    "PCODE": "SN-2",
                    "AUFNR": "ORDER-1",
                    "SPEC": "Line-OP215:综检",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20260516",
                },
            ]
        ),
    )
    monkeypatch.setattr(
        gateway,
        "all_orders",
        AsyncMock(return_value=[{"aufnr": "ORDER-1", "plannedStartDate": "2026-05-15", "orderQuantity": 2, "productionModel": "M-1"}]),
    )
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
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_orders", AsyncMock(return_value={}))
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_composite_groups", AsyncMock(return_value={}))

    rows = await rty_gateway.station_rates(
        "2026-05-01", "2026-05-31", product_model="M-1", group_by="productModel"
    )

    by_station = {row.stationCode: row for row in rows}
    assert by_station["OP215"].inputCount == 1
    assert by_station["OP215"].defectCount == 1
    assert by_station["OP215"].passRate == 0


@pytest.mark.asyncio
async def test_station_rates_summary_uses_order_quantity_and_rty_faults(monkeypatch):
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
                    "AUFNR": "1",
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
    assert faults.await_args.kwargs == {
        "production_orders": ["000000000001", "1"],
        "time_field": "planned",
    }


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
            ("1", "SN-NO-DATE", ""),
            ("1", "SN-BAD-DATE", "invalid"),
            ("3", "SN-OTHER-ORDER", "20261010"),
        ]
    ]

    async def fault_lookup(*, production_orders, time_field):
        assert time_field == "planned"
        orders = {rty_gateway.normalize_order(order) for order in production_orders}
        return [
            row
            for row in fault_rows
            if rty_gateway.normalize_order(row["AUFNR"]) in orders
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
    list_rows = await rty_gateway._build_rty_list(
        {
            "dateFrom": "2026-10-05",
            "dateTo": "2026-10-11",
            "productModel": model,
            "orderScope": "normal",
        },
        1, 50, {},
    )

    assert len(cycle_rows) == len(station_rows) == 1
    assert station_rows[0].totalInputCount == cycle_rows[0].inputCount == 1258
    assert cycle_rows[0].inputCount == 1258
    assert station_rows[0].totalDefectCount == cycle_rows[0].defectCount == 6
    assert list_rows["items"][0].defectCount == 6
    assert cycle_rows[0].serialNumbers == sorted([
        "SN-IN", "SN-LATE", "SN-PREVIOUS-YEAR", "SN-NEXT-YEAR", "SN-NO-DATE", "SN-BAD-DATE",
    ])
    assert station_rows[0].inputCount == 1
    assert station_rows[0].defectCount == 1
    station_repairs.assert_awaited_once_with({"SN-IN"}, date_from="20261005", date_to="20261011")


@pytest.mark.asyncio
@pytest.mark.parametrize("group_by", ["productModel", "salesOrder", "productionOrder"])
async def test_station_rty_uses_order_quantity_across_months_and_stations(monkeypatch, group_by):
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
            ] + [
                {
                    "AUFNR": "1",
                    "VBELN": "SO-1",
                    "MAKTX_TH": "6210 C21",
                    "LGORT": "B1",
                    "GSTRS": "2026-07-01",
                    "PCODE": sn,
                    "SPEC": station,
                }
                for sn, station in [
                    ("SN-SHARED", "OP210"),
                    ("SN-SECOND", "OP205"),
                    ("SN-SECOND", "OP205"),
                ]
            ]
        ),
    )

    async def fault_lookup(*, production_orders, time_field):
        assert time_field == "planned"
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
        } == {"1": (10, 1), "2": (10, 1), "3": (10, 1), "4": (10, 1)}
    else:
        assert len(station_rows) == 2
        assert all(row.totalInputCount == sum(item.inputCount for item in cycle_rows) for row in station_rows)
        assert all(row.totalDefectCount == sum(item.defectCount for item in cycle_rows) for row in station_rows)
    assert next(row for row in station_rows if row.dimensionValue == (
        "1" if group_by == "productionOrder" else "SO-1" if group_by == "salesOrder" else "6210 C21"
    ) and row.stationCode == "OP205").inputCount == 2


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

    assert "customer" not in queried_filters
    assert faults.await_args.args[0] == {"ORDER-A"}
    assert repairs.await_args.args[0] == {"SN-A"}
    assert len(rows) == 1
    assert rows[0].inputCount == 1
    assert rows[0].totalInputCount == 10
    assert rows[0].totalDefectCount == 1


@pytest.mark.asyncio
async def test_station_rates_splits_full_year_into_month_windows(monkeypatch):
    gateway = rty_gateway.data_gateway
    calls: list[dict[str, str]] = []

    async def all_station_rows(**filters):
        calls.append(filters)
        return [
            {
                "PCODE": f"SN-{filters['dateFrom']}",
                "AUFNR": f"ORDER-{filters['dateFrom']}",
                "SPEC": "Line-OP10:Assembly",
                "MAKTX_TH": "M-1",
                "GSTRS": filters["dateFrom"].replace("-", "") + "15",
                "IF_L6": "",
            }
        ]

    monkeypatch.setattr(gateway, "all_station_rows", all_station_rows)
    monkeypatch.setattr(gateway, "all_orders", AsyncMock(return_value=[{
        "aufnr": f"ORDER-{date}", "plannedStartDate": date, "orderQuantity": 1, "productionModel": "M-1",
    } for date in [f"2025-{month:02d}-01" for month in range(1, 13)]]))
    monkeypatch.setattr(rty_gateway, "_faults_for_sns", AsyncMock(return_value=[]))
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_orders", AsyncMock(return_value={}))
    monkeypatch.setattr(rty_gateway, "_fault_sns_by_composite_groups", AsyncMock(return_value={}))
    rows = await rty_gateway.station_rates(
        "2025-01-01", "2025-12-31", group_by="productModel"
    )

    assert len(calls) == 12
    assert calls[0]["dateFrom"] == "2025-01-01"
    assert calls[-1]["dateTo"] == "2025-12-31"
    assert len(rows) == 1
    assert rows[0].inputCount == 12


@pytest.mark.asyncio
async def test_station_rates_overseas_filter_scopes_station_rows_to_order_source(monkeypatch):
    gateway = rty_gateway.data_gateway
    queried_filters: dict[str, object] = {}

    async def all_orders(**filters):
        queried_filters.update(filters)
        if filters.get("overseas") != "true":
            return []
        return [
            {
                "aufnr": "OVERSEAS-1",
                "plannedStartDate": "2026-07-15",
                "orderQuantity": 10,
                "productionModel": "M-1",
                "raw": {
                    "data": {
                        "AUFNR": "OVERSEAS-1",
                        "MAKTX_TH": "M-1",
                        "IF_L6": "",
                        "WMENG": 10,
                    }
                },
            }
        ]

    monkeypatch.setattr(gateway, "all_orders", all_orders)
    monkeypatch.setattr(
        gateway,
        "all_station_rows",
        AsyncMock(
            return_value=[
                {
                    "PCODE": "SN-OVERSEAS",
                    "AUFNR": "OVERSEAS-1",
                    "SPEC": "Line-OP10:Assembly",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20260715",
                },
                {
                    "PCODE": "SN-DOMESTIC",
                    "AUFNR": "DOMESTIC-1",
                    "SPEC": "Line-OP10:Assembly",
                    "MAKTX_TH": "M-1",
                    "GSTRS": "20260715",
                },
            ]
        ),
    )
    monkeypatch.setattr(rty_gateway, "_station_repairs_for_sns", AsyncMock(return_value=[]))
    monkeypatch.setattr(rty_gateway, "_rty_order_groups", AsyncMock(return_value={}))

    rows = await rty_gateway.station_rates(
        "2026-07-01",
        "2026-07-31",
        product_model="M-1",
        group_by="productModel",
        overseas=True,
    )

    assert queried_filters["overseas"] == "true"
    assert [(row.dimensionValue, row.stationCode, row.inputCount) for row in rows] == [
        ("M-1", "OP10", 1)
    ]


@pytest.mark.asyncio
async def test_station_details_overseas_filter_excludes_non_overseas_orders(monkeypatch):
    gateway = rty_gateway.data_gateway

    async def all_orders(**filters):
        assert filters["overseas"] == "true"
        return [
            {
                "aufnr": "OVERSEAS-1",
                "plannedStartDate": "2026-07-15",
                "raw": {"data": {"AUFNR": "OVERSEAS-1", "IF_L6": ""}},
            }
        ]

    monkeypatch.setattr(gateway, "all_orders", all_orders)
    monkeypatch.setattr(
        gateway,
        "all_station_rows",
        AsyncMock(
            return_value=[
                {
                    "PCODE": "SN-OVERSEAS",
                    "AUFNR": "OVERSEAS-1",
                    "SPEC": "Line-OP10:Assembly",
                    "GSTRS": "20260715",
                },
                {
                    "PCODE": "SN-DOMESTIC",
                    "AUFNR": "DOMESTIC-1",
                    "SPEC": "Line-OP10:Assembly",
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
        dimension_value="未关联",
        overseas=True,
    )

    assert [row.sn for row in rows] == ["SN-OVERSEAS"]


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
