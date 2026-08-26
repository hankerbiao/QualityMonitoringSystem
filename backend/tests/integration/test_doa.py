"""DOA 报修率看板接口测试。"""

from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


@pytest.fixture
def app():
    from app.api import auth, doa

    @asynccontextmanager
    async def noop(_app):
        yield

    test_app = FastAPI(lifespan=noop)
    test_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    test_app.include_router(auth.router, prefix="/api")
    test_app.include_router(doa.router, prefix="/api/doa")
    return test_app


def token_headers(make_test_access_token):
    return {"Authorization": f"Bearer {make_test_access_token('alice')}"}


@pytest.mark.integration
async def test_doa_options_and_dashboard_use_sales_orders_sap_only(db_clean):
    from app.schemas.doa import DoaFilters
    from app.services.doa_service import build_doa_dashboard, get_doa_options

    await db_clean["sales_orders_sap"].insert_one(
        {
            "aufnr": "A1",
            "data": {
                "VBELN": "SO-1",
                "WMENG": 10,
                "GSTRS": "2026-08-01",
                "NAME1_ZU": "客户A",
                "MAKTX_TH": "X2",
            },
            "gstrs_date": "2026-08-01",
        }
    )
    dashboard = await build_doa_dashboard(db_clean, DoaFilters(timeGranularity="month"))
    options = await get_doa_options(db_clean)
    assert dashboard.summary.shippedCount == 10
    assert options == {"customers": ["客户A"], "models": ["X2"]}


@pytest.mark.integration
async def test_doa_dashboard_joins_orders_and_filters(client, db_clean, make_test_access_token):
    await db_clean["sales_orders_sap"].insert_many(
        [
            {
                "aufnr": "A1",
                "data": {
                    "VBELN": "SO-1",
                    "WMENG": 10,
                    "GSTRS": "2026-08-01",
                    "NAME1_ZU": "客户A",
                    "MAKTX_TH": "6210 C3",
                },
                "gstrs_date": "2026-08-01",
            },
            {
                "aufnr": "A2",
                "data": {
                    "VBELN": "SO-1",
                    "WMENG": 5,
                    "GSTRS": "2026-08-02",
                    "NAME1_ZU": "客户A",
                    "MAKTX_TH": "3215 C3",
                },
                "gstrs_date": "2026-08-02",
            },
            {
                "aufnr": "A3",
                "data": {
                    "VBELN": "SO-3",
                    "WMENG": 20,
                    "GSTRS": "2026-08-03",
                    "NAME1_ZU": "客户B",
                    "MAKTX_TH": "X2",
                },
                "gstrs_date": "2026-08-03",
            },
        ]
    )
    await db_clean["scs_doa_results"].insert_many(
        [
            {
                "_id": "r1",
                "is_5000": True,
                "data": {
                    "判定结果": "是",
                    "问题批次数量": "2",
                    "受理时间": "2026-08-04",
                    "产品/备件名称": "6210 C3 结构化BOM",
                    "曙光S/N": "SN1",
                },
                "scs_enrichment": {"sales_order": "SO-1", "accepted_date": "2026-08-04"},
            },
            {
                "_id": "r2",
                "scs_enrichment": {
                    "is_5000": True,
                    "sales_order": "SO-3",
                    "accepted_date": "2026-08-04",
                },
                "data": {
                    "判定结果": "是",
                    "问题批次数量": "1",
                    "受理时间": "2026-08-04",
                    "产品/备件名称": "X2结构化BOM",
                },
            },
            {
                "_id": "r3",
                "is_5000": True,
                "data": {
                    "判定结果": "否",
                    "问题批次数量": "99",
                    "受理时间": "2026-08-04",
                    "产品/备件名称": "X2",
                },
                "scs_enrichment": {"sales_order": "SO-3", "accepted_date": "2026-08-04"},
            },
            {
                "_id": "r4",
                "data": {
                    "判定结果": "是",
                    "问题批次数量": "4",
                    "受理时间": "2026-08-04",
                    "产品/备件名称": "X2",
                },
                "scs_enrichment": {"sales_order": "SO-3", "accepted_date": "2026-08-04"},
            },
        ]
    )
    response = await client.get(
        "/api/doa/dashboard?dateFrom=2026-08-01&dateTo=2026-08-31",
        headers=token_headers(make_test_access_token),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["shippedCount"] == 35
    assert body["summary"]["repairCount"] == 3
    assert body["summary"]["repairRate"] == 8.57
    assert body["summary"]["excludedRepairRecords"] == 0
    assert {item["key"] for item in body["byModel"]} == {"3215 C3", "6210 C3", "X2"}
    assert body["trend"] == [
        {
            "period": "2026-08",
            "shippedCount": 35,
            "repairCount": 3,
            "repairServerCount": 1,
            "repairRate": 8.57,
            "replacementCount": 0,
            "replacementRate": 0,
        }
    ]


@pytest.mark.integration
async def test_doa_dashboard_replacement_counts_change_matches(
    client, db_clean, make_test_access_token
):
    await db_clean["sales_orders_sap"].insert_one(
        {
            "aufnr": "A1",
            "data": {
                "VBELN": "SO-1",
                "WMENG": 10,
                "GSTRS": "2026-08-01",
                "NAME1_ZU": "客户A",
                "MAKTX_TH": "X2",
            },
            "gstrs_date": "2026-08-01",
        }
    )
    await db_clean["scs_doa_results"].insert_many(
        [
            {
                "_id": "d1",
                "is_5000": True,
                "data": {
                    "服务单号": "SVC-001",
                    "判定结果": "是",
                    "问题批次数量": "1",
                    "受理时间": "2026-08-04",
                    "产品/备件名称": "X2结构化BOM",
                },
                "scs_enrichment": {"sales_order": "SO-1", "accepted_date": "2026-08-04"},
            },
            {
                "_id": "d2",
                "is_5000": True,
                "data": {
                    "服务单号": "SVC-002",
                    "判定结果": "是",
                    "问题批次数量": "1",
                    "受理时间": "2026-08-05",
                    "产品/备件名称": "X2结构化BOM",
                },
                "scs_enrichment": {"sales_order": "SO-1", "accepted_date": "2026-08-05"},
            },
        ]
    )
    await db_clean["scs_change_results"].insert_many(
        [
            {"data": {"服务单号": "SVC-001", "操作类型": "换上"}},
            {"data": {"服务单号": "SVC-001", "操作类型": "换下"}},
            {"data": {"服务单号": "SVC-999", "操作类型": "换上"}},
        ]
    )
    response = await client.get(
        "/api/doa/dashboard?dateFrom=2026-08-01&dateTo=2026-08-31",
        headers=token_headers(make_test_access_token),
    )
    assert response.status_code == 200
    body = response.json()
    summary = body["summary"]
    assert summary["shippedCount"] == 10
    assert summary["replacementCount"] == 1
    assert summary["replacementRate"] == 10.0
    trend = {item["period"]: item for item in body["trend"]}
    assert trend["2026-08"]["replacementCount"] == 1
    assert trend["2026-08"]["replacementRate"] == 10.0

    replacement_repairs = await client.get(
        "/api/doa/repairs?dateFrom=2026-08-01&dateTo=2026-08-31&replacementOnly=true",
        headers=token_headers(make_test_access_token),
    )
    assert replacement_repairs.status_code == 200
    replacement_body = replacement_repairs.json()
    assert replacement_body["total"] == 1
    assert replacement_body["items"][0]["data"]["服务单号"] == "SVC-001"

    assert summary["repairCount"] == 2
    assert summary["repairRate"] == 20.0
    assert body["trend"][0]["replacementCount"] == 1
    assert body["trend"][0]["replacementRate"] == 10.0


@pytest.mark.integration
async def test_replacement_drilldown_keeps_doa_month_and_deduplicates_orders(
    client, db_clean, make_test_access_token
):
    await db_clean["sales_orders_sap"].insert_many(
        [
            {
                "aufnr": f"A{i}",
                "data": {
                    "VBELN": "SO-JAN-REPLACEMENT",
                    "WMENG": 1,
                    "GSTRS": date,
                    "NAME1_ZU": "客户A",
                    "MAKTX_TH": "6215 C1",
                },
                "gstrs_date": date,
            }
            for i, date in enumerate(("2026-02-01", "2026-02-02", "2026-03-01", "2026-03-02"))
        ]
    )
    await db_clean["scs_doa_results"].insert_one(
        {
            "_id": "jan-replacement",
            "is_5000": True,
            "data": {
                "服务单号": "SVC-JAN-REPLACEMENT",
                "判定结果": "是",
                "问题批次数量": "1",
                "产品/备件名称": "R6240A0_A620 G40 备件",
            },
            "scs_enrichment": {
                "sales_order": "SO-JAN-REPLACEMENT",
                "accepted_date": "2026-01-24",
            },
        }
    )
    await db_clean["scs_change_results"].insert_one(
        {"data": {"服务单号": "SVC-JAN-REPLACEMENT", "操作类型": "换上"}}
    )
    token = token_headers(make_test_access_token)
    query = "dateFrom=2026-01-01&dateTo=2026-01-31&timeGranularity=month&replacementOnly=true"

    dashboard = await client.get(
        "/api/doa/dashboard?dateFrom=2026-01-01&dateTo=2026-01-31",
        headers=token,
    )
    assert dashboard.status_code == 200
    assert dashboard.json()["summary"]["replacementCount"] == 1

    details = await client.get(f"/api/doa/repairs?{query}", headers=token)
    assert details.status_code == 200
    body = details.json()
    assert body["total"] == 1
    assert [item["data"]["服务单号"] for item in body["items"]] == ["SVC-JAN-REPLACEMENT"]


@pytest.mark.integration
async def test_repair_trend_drilldown_keeps_original_order_date_scope(
    client, db_clean, make_test_access_token
):
    await db_clean["sales_orders_sap"].insert_one(
        {
            "aufnr": "A-DRILLDOWN",
            "data": {
                "VBELN": "SO-DRILLDOWN",
                "WMENG": 10,
                "GSTRS": "2026-02-01",
                "NAME1_ZU": "客户A",
                "MAKTX_TH": "X2",
            },
            "gstrs_date": "2026-02-01",
        }
    )
    await db_clean["scs_doa_results"].insert_one(
        {
            "_id": "doa-drilldown",
            "is_5000": True,
            "data": {
                "判定结果": "是",
                "问题批次数量": "1",
                "产品/备件名称": "X2结构化BOM",
                "曙光S/N": "SN-DRILLDOWN",
            },
            "scs_enrichment": {
                "sales_order": "SO-DRILLDOWN",
                "accepted_date": "2026-01-15",
            },
        }
    )
    token = token_headers(make_test_access_token)
    dashboard = await client.get(
        "/api/doa/dashboard?dateFrom=2026-01-01&dateTo=2026-12-31",
        headers=token,
    )
    assert dashboard.status_code == 200
    trend = {item["period"]: item for item in dashboard.json()["trend"]}
    assert trend["2026-01"]["repairServerCount"] == 1

    details = await client.get(
        "/api/doa/repairs?dateFrom=2026-01-01&dateTo=2026-12-31"
        "&acceptedDateFrom=2026-01-01&acceptedDateTo=2026-01-31",
        headers=token,
    )
    assert details.status_code == 200
    assert details.json()["total"] == 1


@pytest.mark.integration
async def test_doa_dashboard_escapes_regex_metachars_in_model_names(
    client, db_clean, make_test_access_token
):
    model = "60P24-US V1.2(HT)主板"
    await db_clean["sales_orders_sap"].insert_one(
        {
            "aufnr": "A1",
            "data": {
                "VBELN": "SO-1",
                "WMENG": 10,
                "GSTRS": "2026-08-01",
                "NAME1_ZU": "客户A",
                "MAKTX_TH": model,
            },
            "gstrs_date": "2026-08-01",
        }
    )
    await db_clean["scs_doa_results"].insert_one(
        {
            "_id": "paren",
            "is_5000": True,
            "data": {
                "判定结果": "是",
                "问题批次数量": "2",
                "受理时间": "2026-08-04",
                "产品/备件名称": model,
            },
            "scs_enrichment": {"sales_order": "SO-1", "accepted_date": "2026-08-04"},
        }
    )
    response = await client.get("/api/doa/dashboard", headers=token_headers(make_test_access_token))
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["matchedRepairRecords"] == 1
    assert body["summary"]["repairCount"] == 2


@pytest.mark.integration
async def test_doa_dashboards_report_latest_data_time(db_clean):
    from datetime import datetime, timezone

    from app.schemas.doa import DoaFilters
    from app.services.doa_service import (
        build_doa_dashboard,
    )

    now = datetime(2026, 8, 20, 9, 30, tzinfo=timezone.utc)
    earlier = datetime(2026, 8, 19, 8, 0, tzinfo=timezone.utc)
    later_update = datetime(2026, 8, 21, 9, 30, tzinfo=timezone.utc)
    await db_clean["scs_doa_results"].insert_many(
        [
            {
                "_id": "a",
                "is_5000": True,
                "updated_at": earlier,
                "data": {"判定结果": "是", "受理时间": "2026-08-19"},
                "scs_enrichment": {"accepted_date": "2026-08-19"},
            },
            {
                "_id": "b",
                "updated_at": now,
                "scs_enrichment": {
                    "is_5000": True,
                    "enriched_at": now,
                    "accepted_date": "2026-08-20",
                },
                "data": {"判定结果": "是", "受理时间": "2026-08-20"},
            },
            {
                "_id": "c",
                "updated_at": later_update,
                "scs_enrichment": {
                    "enriched_at": earlier,
                    "accepted_date": "2026-08-19",
                },
            },
        ]
    )
    doa = await build_doa_dashboard(db_clean, DoaFilters())
    assert doa.summary.latestDataAt == now
    assert doa.summary.latestDataAt == now


@pytest.mark.integration
async def test_doa_repairs_excludes_unmatched_and_missing_5000(
    client, db_clean, make_test_access_token
):
    await db_clean["sales_orders_sap"].insert_one(
        {
            "aufnr": "A1",
            "data": {
                "VBELN": "SO-1",
                "WMENG": 10,
                "GSTRS": "2026-08-01",
                "NAME1_ZU": "客户A",
                "MAKTX_TH": "X2",
            },
            "gstrs_date": "2026-08-01",
        }
    )
    await db_clean["scs_doa_results"].insert_many(
        [
            {
                "_id": "ok",
                "is_5000": True,
                "data": {
                    "判定结果": "是",
                    "问题批次数量": "2",
                    "受理时间": "2026-08-01",
                    "产品/备件名称": "X2结构化BOM",
                },
                "scs_enrichment": {"sales_order": "SO-1", "accepted_date": "2026-08-01"},
            },
            {
                "_id": "missing",
                "data": {
                    "判定结果": "是",
                    "问题批次数量": "3",
                    "受理时间": "2026-08-01",
                    "产品/备件名称": "X2",
                },
                "scs_enrichment": {"sales_order": "SO-1", "accepted_date": "2026-08-01"},
            },
            {
                "_id": "unmatched",
                "is_5000": True,
                "data": {
                    "判定结果": "是",
                    "问题批次数量": "4",
                    "受理时间": "2026-08-01",
                    "产品/备件名称": "Y9",
                },
                "scs_enrichment": {"sales_order": "SO-404", "accepted_date": "2026-08-01"},
            },
        ]
    )
    response = await client.get(
        "/api/doa/repairs?limit=1", headers=token_headers(make_test_access_token)
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["repairCount"] == 2


@pytest.mark.integration
async def test_doa_raw_endpoint_uses_new_route_and_is_paginated(
    client, db_clean, make_test_access_token
):
    await db_clean["scs_doa_results"].insert_many(
        [
            {
                "_id": "raw-1",
                "is_5000": True,
                "data": {"判定结果": "是", "受理时间": "2026/08/19 10:00", "DOA类型": "整机DOA"},
                "scs_enrichment": {"accepted_date": "2026-08-19", "status": "pending"},
            },
            {
                "_id": "raw-2",
                "scs_enrichment": {"is_5000": True, "accepted_date": "2026-08-20"},
                "data": {"判定结果": "否", "受理时间": "2026-08-20", "DOA类型": "备件DOA"},
            },
        ]
    )
    token = token_headers(make_test_access_token)
    response = await client.get("/api/doa/raw?page=1&limit=1", headers=token)
    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["total"] == 2
    assert payload["pagination"] == {"page": 1, "limit": 1, "total": 2, "hasMore": True}
    assert len(payload["items"]) == 1

    old_route = await client.get("/api/operations/doa?page=1&limit=1", headers=token)
    assert old_route.status_code == 404
