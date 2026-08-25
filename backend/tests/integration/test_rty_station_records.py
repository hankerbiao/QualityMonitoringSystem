"""RTY integration coverage for the station-input / repair-fault data model."""

import pytest


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
        assert so1["customer"] == "客户A"

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
        orders = (
            await client.get("/api/rty/production-orders/by-sales-order?salesOrder=SO-1")
        ).json()["data"]

        assert models == [{"model": "M-1", "count": 2}, {"model": "M-2", "count": 1}]
        assert bases == [{"base": "9000", "count": 2}, {"base": "9100", "count": 1}]
        assert orders == ["PO-1"]
