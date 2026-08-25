"""MFR formula and cross-collection association tests."""

import pytest


@pytest.mark.integration
async def test_mfr_uses_5000_change_rows_and_in_warranty_fleet(
    client, db_clean, make_test_access_token
):
    await db_clean["sales_orders_sap"].insert_many(
        [
            {
                "aufnr": "A1",
                "data": {
                    "VBELN": "SO-1",
                    "MAKTX_TH": "X1",
                    "GAMNG": 2,
                    "出厂日期": "2025-01-01",
                    "保修结束日期": "2026-12-31",
                },
            },
            {
                "aufnr": "A2",
                "data": {
                    "VBELN": "SO-2",
                    "MAKTX_TH": "X2",
                    "GAMNG": 3,
                    "出厂日期": "2025-01-01",
                    "保修结束日期": "2026-12-31",
                },
            },
        ]
    )
    await db_clean["scs_doa_results"].insert_many(
        [
            {
                "is_5000": True,
                "data": {"服务单号": "S1"},
                "scs_enrichment": {"sales_order": "SO-1"},
            },
            {
                "is_5000": True,
                "data": {"服务单号": "S2"},
                "scs_enrichment": {"sales_order": "SO-2"},
            },
            {
                "is_5000": False,
                "data": {"服务单号": "S3"},
                "scs_enrichment": {"sales_order": "SO-3"},
            },
        ]
    )
    await db_clean["scs_change_results"].insert_many(
        [
            {"data": {"服务单号": "S1", "操作类型": "换上-up", "操作时间": "2026-08-05 10:00:00", "报修设备": "M1"}},
            {"data": {"服务单号": "S1", "操作类型": "换下", "操作时间": "2026-08-05 10:00:00", "报修设备": "M1"}},
            {"data": {"服务单号": "S2", "操作类型": "换上", "操作时间": "2026-08-06 10:00:00", "报修设备": "M2"}},
            {"data": {"服务单号": "S3", "操作类型": "换上", "操作时间": "2026-08-06 10:00:00", "报修设备": "M3"}},
            {"data": {"服务单号": "S1", "操作类型": "换上", "操作时间": "2025-08-06 10:00:00", "报修设备": "OLD"}},
        ]
    )

    response = await client.get(
        "/api/mfr/dashboard?dateFrom=2026-08-01&dateTo=2026-08-31",
        headers={"Authorization": f"Bearer {make_test_access_token('mfr-user')}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["faultCount"] == 2
    assert body["summary"]["fleetCount"] == 5
    assert body["summary"]["mfrRate"] == 40.0
    assert body["summary"]["warrantyDateCoverage"] == 100.0
    assert {item["key"]: item["faultCount"] for item in body["byModel"]} == {"X1": 1, "X2": 1}
