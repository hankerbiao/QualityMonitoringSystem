"""RTY integration coverage for the station-input / repair-fault data model."""

import pytest

from app.services.rty_queries import MAX_DETAIL_ROW_COUNT


async def _seed_rty_data(db):
    await db.sales_orders_sap.insert_many(
        [
            {
                "aufnr": "PO-1",
                "gstrs_date": "2026-02-01",
                "data": {
                    "VBELN": "SO-1",
                    "WMENG": 2,
                    "LGORT": "9000",
                    "MAKTX_TH": "M-1",
                    "KID": "CUST-A",
                    "NAME1_ZU": "客户A",
                },
            },
            {
                "aufnr": "PO-2",
                "gstrs_date": "2026-03-01",
                "data": {
                    "VBELN": "SO-2",
                    "WMENG": 1,
                    "LGORT": "9100",
                    "MAKTX_TH": "M-2",
                    "KID": "CUST-B",
                    "NAME1_ZU": "客户B",
                },
            },
            {
                "aufnr": "PO-OLD",
                "gstrs_date": "2025-12-31",
                "data": {"VBELN": "SO-OLD", "WMENG": 99, "LGORT": "9000", "MAKTX_TH": "M-OLD"},
            },
        ]
    )
    await db.station_records_sap.insert_many(
        [
            {
                "PCODE": "SN-1",
                "GSTRS": "20260201",
                "KDAUF": "SO-1",
                "AUFNR": "PO-1",
                "LGORT": "9000",
                "MAKTX_TH": "M-1",
            },
            # A second pass of the same SN must not increase the denominator.
            {
                "PCODE": "SN-1",
                "GSTRS": "20260202",
                "KDAUF": "SO-1",
                "AUFNR": "PO-1",
                "LGORT": "9000",
                "MAKTX_TH": "M-1",
            },
            {
                "PCODE": "SN-2",
                "GSTRS": "20260203",
                "KDAUF": "SO-1",
                "AUFNR": "PO-1",
                "LGORT": "9000",
                "MAKTX_TH": "M-1",
            },
            {
                "PCODE": "SN-3",
                "GSTRS": "20260301",
                "KDAUF": "SO-2",
                "AUFNR": "PO-2",
                "LGORT": "9100",
                "MAKTX_TH": "M-2",
            },
            # Historical station data is not part of the repaired-data RTY scope.
            {
                "PCODE": "SN-OLD",
                "GSTRS": "20251231",
                "KDAUF": "SO-OLD",
                "AUFNR": "PO-OLD",
                "LGORT": "9000",
                "MAKTX_TH": "M-OLD",
            },
        ]
    )
    await db.repair_records_sap.insert_many(
        [
            {
                "PCODE": "SN-1",
                "ZDATE_WX": "20260204",
                "ZNGWD": "F01",
                "ZWXWD": "故障一",
                "AUFNR": "PO-1",
                "VBELN": "SO-1",
                "ZUSER": "u1",
                "customer": "客户A",
            },
            # The same event from SAP client 800 must not appear twice in details.
            {
                "PCODE": "SN-1",
                "ZDATE_WX": "20260204",
                "ZNGWD": "F01",
                "ZWXWD": "故障一",
                "AUFNR": "PO-1",
                "VBELN": "SO-1",
                "ZUSER": "u1",
                "MANDT": "800",
                "customer": "客户A",
            },
            # Multiple repairs of one SN are one RTY fault SN but remain two detail rows.
            {
                "PCODE": "SN-1",
                "ZDATE_WX": "20260205",
                "ZNGWD": "F02",
                "ZWXWD": "故障二",
                "AUFNR": "PO-1",
                "VBELN": "SO-1",
                "ZUSER": "u2",
            },
            {"PCODE": "SN-NOT-INPUT", "ZDATE_WX": "20260205", "ZNGWD": "F03"},
            {"PCODE": "SN-2", "ZDATE_WX": "20251231", "ZNGWD": "OLD"},
        ]
    )


@pytest.mark.integration
class TestStationRecordRTY:
    async def test_station_pass_normalized_fields_follow_existing_rules(self, client, db_clean):
        await db_clean.station_records_sap.insert_one(
            {
                "PCODE": "SN-FALLBACK",
                "ACTUAL_START_TIME": "",
                "GSTRS": "20260402",
                "SPEC": "Line-OP300：描述",
                "SPEC_DESC": "终检",
                "station_pass_date": "20260402",
                "station_code_norm": "OP300",
                "station_name_norm": "终检",
            }
        )
        await db_clean.repair_records_sap.insert_one(
            {
                "PCODE": "SN-FALLBACK",
                "ZDATE_WX": "20260402",
                "ZNGGZ": "",
                "ZNGSPEC": "Line-OP300:备用",
                "repair_station_code_norm": "OP300",
            }
        )

        response = await client.get(
            "/api/rty/station-pass-rates?dateFrom=2026-04-02&dateTo=2026-04-02"
        )

        assert response.status_code == 200
        assert response.json()["data"] == [
            {
                "dimensionValue": "未关联",
                "stationCode": "OP300",
                "stationName": "终检",
                "inputCount": 1,
                "defectCount": 1,
                "passRate": 0.0,
            }
        ]

    async def test_station_pass_rates_match_station_suffix_and_deduplicate_sns(
        self, client, db_clean
    ):
        await db_clean.station_records_sap.insert_many(
            [
                {
                    "PCODE": "SN-1",
                    "GSTRS": "20260201",
                    "ACTUAL_START_TIME": "2026-02-01 08:00:00",
                    "SPEC": "M-OP205",
                    "SPEC_DESC": "装配",
                    "station_pass_date": "20260201",
                    "station_code_norm": "OP205",
                    "station_name_norm": "装配",
                },
                {
                    "PCODE": "SN-1",
                    "GSTRS": "20260202",
                    "ACTUAL_START_TIME": "2026-02-02 08:00:00",
                    "SPEC": "M-OP205",
                    "SPEC_DESC": "装配",
                    "station_pass_date": "20260202",
                    "station_code_norm": "OP205",
                    "station_name_norm": "装配",
                },
                {
                    "PCODE": "SN-2",
                    "GSTRS": "20260201",
                    "ACTUAL_START_TIME": "2026-02-01 08:00:00",
                    "SPEC": "OP205",
                    "SPEC_DESC": "装配",
                    "station_pass_date": "20260201",
                    "station_code_norm": "OP205",
                    "station_name_norm": "装配",
                },
                {
                    "PCODE": "SN-3",
                    "GSTRS": "20260201",
                    "ACTUAL_START_TIME": "2026-02-01 08:00:00",
                    "SPEC": "M-OP210",
                    "station_pass_date": "20260201",
                    "station_code_norm": "OP210",
                    "station_name_norm": "",
                },
            ]
        )
        await db_clean.repair_records_sap.insert_many(
            [
                {
                    "PCODE": "SN-1",
                    "ZDATE_WX": "20260203",
                    "ZNGGZ": "M-OP205:初检前测",
                    "repair_station_code_norm": "OP205",
                },
                {
                    "PCODE": "SN-1",
                    "ZDATE_WX": "20260204",
                    "ZNGGZ": "OP205",
                    "repair_station_code_norm": "OP205",
                },
                {
                    "PCODE": "SN-2",
                    "ZDATE_WX": "20260204",
                    "ZNGGZ": "M-OP210",
                    "repair_station_code_norm": "OP210",
                },
                {
                    "PCODE": "SN-NOT-PASSED",
                    "ZDATE_WX": "20260204",
                    "ZNGGZ": "M-OP205",
                    "repair_station_code_norm": "OP205",
                },
            ]
        )

        response = await client.get("/api/rty/station-pass-rates")

        assert response.status_code == 200
        rows = response.json()["data"]
        op205 = next(row for row in rows if row["stationCode"] == "OP205")
        assert op205 == {
            "dimensionValue": "未关联",
            "stationCode": "OP205",
            "stationName": "装配",
            "inputCount": 2,
            "defectCount": 1,
            "passRate": 50.0,
        }
        op210 = next(row for row in rows if row["stationCode"] == "OP210")
        assert op210["inputCount"] == 1
        assert op210["defectCount"] == 0
        assert op210["passRate"] == 100.0

    async def test_station_pass_rates_filter_by_actual_pass_date(self, client, db_clean):
        await db_clean.station_records_sap.insert_many(
            [
                {
                    "PCODE": "SN-2026",
                    "GSTRS": "20251231",
                    "ACTUAL_START_TIME": "2026-01-02 09:00:00",
                    "SPEC": "M-OP205",
                    "station_pass_date": "20260102",
                    "station_code_norm": "OP205",
                    "station_name_norm": "",
                },
                {
                    "PCODE": "SN-2025",
                    "GSTRS": "20260101",
                    "ACTUAL_START_TIME": "2025-12-31 09:00:00",
                    "SPEC": "M-OP205",
                    "station_pass_date": "20251231",
                    "station_code_norm": "OP205",
                    "station_name_norm": "",
                },
            ]
        )

        response = await client.get(
            "/api/rty/station-pass-rates?dateFrom=2026-01-01&dateTo=2026-01-31"
        )

        assert response.status_code == 200
        assert response.json()["data"][0]["inputCount"] == 1

    async def test_station_pass_rates_group_and_filter_by_order_dimensions(self, client, db_clean):
        await db_clean.station_records_sap.insert_many(
            [
                {"PCODE": "SN-SO1-A", "AUFNR": "PO-1", "KDAUF": "SO-1", "MAKTX_TH": "M-1", "LGORT": "9000", "station_pass_date": "20260501", "station_code_norm": "OP100", "station_name_norm": "工位一"},
                {"PCODE": "SN-SO1-B", "AUFNR": "PO-1", "KDAUF": "SO-1", "MAKTX_TH": "M-1", "LGORT": "9000", "station_pass_date": "20260501", "station_code_norm": "OP200", "station_name_norm": "工位二"},
                {"PCODE": "SN-SO2-A", "AUFNR": "PO-2", "KDAUF": "SO-2", "MAKTX_TH": "M-2", "LGORT": "9100", "station_pass_date": "20260501", "station_code_norm": "OP100", "station_name_norm": "工位一"},
            ]
        )
        await db_clean.repair_records_sap.insert_one(
            {"PCODE": "SN-SO1-A", "ZDATE_WX": "20260502", "repair_station_code_norm": "OP100"}
        )

        response = await client.get(
            "/api/rty/station-pass-rates?dateFrom=2026-05-01&dateTo=2026-05-31&groupBy=salesOrder&productModel=M-1&base=9000"
        )

        assert response.status_code == 200
        assert response.json()["data"] == [
            {"dimensionValue": "SO-1", "stationCode": "OP100", "stationName": "工位一", "inputCount": 1, "defectCount": 1, "passRate": 0.0},
            {"dimensionValue": "SO-1", "stationCode": "OP200", "stationName": "工位二", "inputCount": 1, "defectCount": 0, "passRate": 100.0},
        ]

        details = await client.get(
            "/api/rty/station-pass-details?stationCode=OP100&dateFrom=2026-05-01&dateTo=2026-05-31&groupBy=salesOrder&dimensionValue=SO-1&productModel=M-1&base=9000"
        )
        assert details.status_code == 200
        assert [item["sn"] for item in details.json()["data"]] == ["SN-SO1-A"]

    async def test_station_pass_rates_reject_reverse_date_range(self, client, db_clean):
        response = await client.get(
            "/api/rty/station-pass-rates?dateFrom=2026-02-02&dateTo=2026-02-01"
        )

        assert response.status_code == 422
        assert response.json()["detail"] == "开始日期不能晚于结束日期"

    async def test_station_pass_rates_supports_more_than_raw_row_limit(self, client, db_clean):
        await db_clean.station_records_sap.insert_many(
            [
                {
                    "PCODE": f"SN-{index}",
                    "ACTUAL_START_TIME": "2026-01-02 09:00:00",
                    "SPEC": "M-OP205",
                    "station_pass_date": "20260102",
                    "station_code_norm": "OP205",
                    "station_name_norm": "",
                }
                for index in range(MAX_DETAIL_ROW_COUNT + 1)
            ]
        )

        response = await client.get("/api/rty/station-pass-rates")

        assert response.status_code == 200
        assert response.json()["data"][0]["inputCount"] == MAX_DETAIL_ROW_COUNT + 1

    async def test_uses_sales_order_wmeng_and_distinct_repair_sns(self, client, db_clean):
        await _seed_rty_data(db_clean)

        response = await client.get("/api/rty/list")

        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 2
        so1 = next(item for item in body["items"] if item["salesOrder"] == "SO-1")
        assert so1["inputCount"] == 2
        assert so1["defectCount"] == 1
        assert so1["rtyRate"] == 50.0
        assert so1["serialNumbers"] == []
        assert so1["customer"] == "CUST-A"

    async def test_cycle_data_is_monthly_and_uses_same_fault_scope(self, client, db_clean):
        await _seed_rty_data(db_clean)

        response = await client.get("/api/rty/cycle-data")

        assert response.status_code == 200
        rows = response.json()["data"]
        assert {(row["time"], row["productModel"]) for row in rows} == {
            ("2026-02", "M-1"),
            ("2026-03", "M-2"),
        }
        feb = next(row for row in rows if row["time"] == "2026-02")
        assert feb["base"] == "9000"
        assert feb["inputCount"] == 2
        assert feb["defectCount"] == 1
        assert feb["rtyRate"] == 50.0

    async def test_cycle_data_supports_customer_filter(self, client, db_clean):
        await _seed_rty_data(db_clean)

        response = await client.get("/api/rty/cycle-data?customer=CUST-A")

        assert response.status_code == 200
        rows = response.json()["data"]
        assert {(row["time"], row["productModel"]) for row in rows} == {
            ("2026-02", "M-1"),
        }
        assert rows[0]["customer"] == "CUST-A"

    async def test_pagination_and_date_boundaries_are_deterministic(self, client, db_clean):
        await _seed_rty_data(db_clean)

        first_page = await client.get("/api/rty/list?limit=1&page=1")
        second_page = await client.get("/api/rty/list?limit=1&page=2")
        assert first_page.json()["total"] == 2
        assert first_page.json()["has_more"] is True
        assert second_page.json()["has_more"] is False
        assert first_page.json()["items"][0]["salesOrder"] == "SO-1"
        assert second_page.json()["items"][0]["salesOrder"] == "SO-2"

        before_scope = await client.get("/api/rty/list?dateFrom=2025-01-01&dateTo=2025-12-31")
        after_scope = await client.get("/api/rty/list?dateFrom=2027-01-01")
        assert before_scope.json()["total"] == 0
        assert after_scope.json()["total"] == 0

    async def test_filters_and_defect_details_use_station_scope(self, client, db_clean):
        await _seed_rty_data(db_clean)

        response = await client.get(
            "/api/rty/list?productionOrder=PO-1&dateFrom=2026-02-01&dateTo=2026-02-28"
        )
        assert response.status_code == 200
        item = response.json()["items"][0]
        assert item["productionOrder"] == "PO-1"
        assert item["inputCount"] == 2
        assert item["defectCount"] == 1

        defects = await client.get("/api/rty/defects/by-filters?productionOrder=PO-1")
        details = defects.json()["data"]
        assert len(details) == 2
        assert {detail["sn"] for detail in details} == {"SN-1"}
        assert {detail["defectCode"] for detail in details} == {"F01", "F02"}
        assert "客户A" in {detail["customer"] for detail in details}

    async def test_options_are_2026_station_distinct_sns(self, client, db_clean):
        await _seed_rty_data(db_clean)

        models = (await client.get("/api/rty/product-models")).json()["data"]
        bases = (await client.get("/api/rty/bases")).json()["data"]
        customers = (await client.get("/api/rty/customers")).json()["data"]
        customer_rows = (await client.get("/api/rty/list?customer=CUST-A")).json()["items"]
        orders = (
            await client.get("/api/rty/production-orders/by-sales-order?salesOrder=SO-1")
        ).json()["data"]

        assert models == [{"model": "M-1", "count": 2}, {"model": "M-2", "count": 1}]
        assert bases == [{"base": "9000", "count": 2}, {"base": "9100", "count": 1}]
        assert customers == ["CUST-A", "CUST-B"]
        assert [row["salesOrder"] for row in customer_rows] == ["SO-1"]
        assert orders == ["PO-1"]

    async def test_order_eligibility_excludes_status_and_type_and_separates_l6(
        self, client, db_clean
    ):
        await db_clean.sales_orders_sap.insert_many(
            [
                {
                    "aufnr": "PO-NORMAL",
                    "gstrs_date": "2026-05-01",
                    "data": {
                        "VBELN": "SO-NORMAL",
                        "WMENG": 10,
                        "LGORT": "9000",
                        "MAKTX_TH": "M-1",
                        "NAME1_ZU": "客户A",
                    },
                },
                {
                    "aufnr": "PO-L6",
                    "gstrs_date": "2026-05-01",
                    "data": {
                        "VBELN": "SO-L6",
                        "WMENG": 8,
                        "LGORT": "9000",
                        "MAKTX_TH": "M-L6",
                        "NAME1_ZU": "客户L6",
                        "IF_L6": "X",
                    },
                },
                {
                    "aufnr": "PO-RELEASED",
                    "gstrs_date": "2026-05-01",
                    "data": {
                        "VBELN": "SO-RELEASED",
                        "WMENG": 20,
                        "LGORT": "9000",
                        "MAKTX_TH": "M-EXCLUDED",
                        "ZSTAT": "RELEASED",
                    },
                },
                {
                    "aufnr": "PO-DLID",
                    "gstrs_date": "2026-05-01",
                    "data": {
                        "VBELN": "SO-DLID",
                        "WMENG": 30,
                        "LGORT": "9000",
                        "MAKTX_TH": "M-EXCLUDED",
                        "ZSTAT": "DLID",
                    },
                },
                {
                    "aufnr": "PO-C001",
                    "gstrs_date": "2026-05-01",
                    "data": {
                        "VBELN": "SO-C001",
                        "WMENG": 40,
                        "LGORT": "9000",
                        "MAKTX_TH": "M-EXCLUDED",
                        "AUART": "C001",
                    },
                },
            ]
        )
        await db_clean.repair_records_sap.insert_many(
            [
                {"PCODE": "SN-NORMAL", "AUFNR": "PO-NORMAL", "ZDATE_WX": "20260502"},
                {"PCODE": "SN-L6", "AUFNR": "PO-L6", "ZDATE_WX": "20260502"},
                {"PCODE": "SN-RELEASED", "AUFNR": "PO-RELEASED", "ZDATE_WX": "20260502"},
            ]
        )

        normal = (await client.get("/api/rty/list?productModel=M-1")).json()
        assert normal["total"] == 1
        assert normal["items"][0]["inputCount"] == 10
        assert normal["items"][0]["defectCount"] == 1

        l6 = (await client.get("/api/rty/list?orderScope=l6")).json()
        assert l6["total"] == 1
        assert l6["items"][0]["salesOrder"] == "SO-L6"
        assert l6["items"][0]["inputCount"] == 8
        assert l6["items"][0]["defectCount"] == 1

        normal_models = (await client.get("/api/rty/product-models")).json()["data"]
        assert normal_models == [{"model": "M-1", "count": 10}]
        l6_models = (await client.get("/api/rty/product-models?orderScope=l6")).json()["data"]
        assert l6_models == [{"model": "M-L6", "count": 8}]

    async def test_composite_model_maps_box_faults_to_head_serial_numbers(self, client, db_clean):
        await db_clean.sales_orders_sap.insert_one(
            {
                "aufnr": "HEAD-PO",
                "gstrs_date": "2026-04-01",
                "data": {
                    "VBELN": "SO-COMPOSITE",
                    "WMENG": 10,
                    "LGORT": "9000",
                    "MAKTX_TH": "6210 C21 BOX",
                    "NAME1_ZU": "客户A",
                },
            }
        )
        await db_clean.serial_bindings_sap.insert_many(
            [
                {
                    "AUFNR_HEAD": "HEAD-PO",
                    "AUFNR_ITEM": "BOX-PO",
                    "ZCODE_HEAD": "HEAD-SN-1",
                    "ZCODE_ITEM": "BOX-SN-1",
                },
                {
                    "AUFNR_HEAD": "HEAD-PO",
                    "AUFNR_ITEM": "BOX-PO",
                    "ZCODE_HEAD": "HEAD-SN-2",
                    "ZCODE_ITEM": "BOX-SN-2",
                },
            ]
        )
        await db_clean.repair_records_sap.insert_many(
            [
                {"PCODE": "HEAD-SN-1", "AUFNR": "HEAD-PO", "ZDATE_WX": "20260402"},
                {
                    "PCODE": "BOX-SN-1",
                    "AUFNR": "BOX-PO",
                    "ZDATE_WX": "20260402",
                    "ZJXMC": "6410 X21",
                },
                {
                    "PCODE": "BOX-SN-2",
                    "AUFNR": "BOX-PO",
                    "ZDATE_WX": "20260403",
                    "ZJXMC": "6410 X21",
                },
                {
                    "PCODE": "UNBOUND-BOX-SN",
                    "AUFNR": "BOX-PO",
                    "ZDATE_WX": "20260403",
                    "ZJXMC": "6410 X21",
                },
            ]
        )

        response = await client.get("/api/rty/list?productModel=6210%20C21%20BOX")

        assert response.status_code == 200
        item = response.json()["items"][0]
        assert item["model"] == "复合机型"
        assert item["inputCount"] == 10
        assert item["defectCount"] == 2
        assert item["rtyRate"] == 80.0

        cycle = await client.get("/api/rty/cycle-data")
        cycle_item = next(
            row for row in cycle.json()["data"] if row["productModel"] == "6210 C21 BOX"
        )
        assert cycle_item["inputCount"] == 10
        assert cycle_item["defectCount"] == 2

        details = await client.get("/api/rty/defects/by-filters?productModel=6210%20C21%20BOX")
        assert {detail["sn"] for detail in details.json()["data"]} == {
            "HEAD-SN-1",
            "BOX-SN-1",
            "BOX-SN-2",
        }
