"""
销售订单双来源同步接口集成测试。

SAP 与 MongoDB 均使用 mock（不连接生产环境）：
- SAP：monkeypatch SapSalesOrderService.fetch_all 返回构造结果
- MongoDB：conftest 的 _mock_db（MockMotor）覆盖 get_database

覆盖方案中的 17 个场景（1-5 见 service 单测）。
"""

import pytest

from app.services.sap_sales_order_service import (
    SapSalesOrderService,
    SourceFetchResult,
)


def _patch_sap(
    monkeypatch,
    sg_records=None,
    kk_records=None,
    sg_error=None,
    kk_error=None,
):
    """用构造结果替换 SAP 双来源抓取。"""
    results = {}
    if sg_error is not None:
        results["SG"] = SourceFetchResult(source="SG", success=False, error=sg_error)
    else:
        results["SG"] = SourceFetchResult(source="SG", success=True, records=sg_records or [])
    if kk_error is not None:
        results["KK"] = SourceFetchResult(source="KK", success=False, error=kk_error)
    else:
        results["KK"] = SourceFetchResult(source="KK", success=True, records=kk_records or [])

    async def fake(self, start_date, end_date, prodh_list):
        return results

    monkeypatch.setattr(SapSalesOrderService, "fetch_all", fake)


@pytest.fixture
def app():
    from contextlib import asynccontextmanager

    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    from app.api import sales_orders

    @asynccontextmanager
    async def noop(app):
        yield

    test_app = FastAPI(title="QualiBoard API", version="1.0.0", lifespan=noop)
    test_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    test_app.include_router(sales_orders.router, prefix="/api/sales-orders", tags=["Sales Orders"])
    return test_app


@pytest.fixture
def client(app, db_clean, make_test_access_token):
    """销售订单接口测试默认使用普通用户登录态。"""
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=app)
    return AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {make_test_access_token('alice')}"},
    )


# ─── 请求校验（1, 2） ───────────────────────────────────────────────────────


@pytest.mark.integration
async def test_sales_orders_requires_authentication(app, db_clean):
    from httpx import ASGITransport, AsyncClient

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anonymous_client:
        response = await anonymous_client.get("/api/sales-orders/query")
    assert response.status_code == 401


@pytest.mark.integration
class TestRequestValidation:
    async def test_invalid_date_format_returns_422(self, client):
        resp = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-13-01", "end_date": "2026-07-31"},
        )
        assert resp.status_code == 422

    async def test_start_after_end_returns_422(self, client):
        resp = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-08-01", "end_date": "2026-07-01"},
        )
        assert resp.status_code == 422

    async def test_valid_request_accepted(self, client, monkeypatch):
        _patch_sap(monkeypatch, sg_records=[], kk_records=[])
        resp = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-07-01", "end_date": "2026-07-31"},
        )
        assert resp.status_code == 200


# ─── 正常同步流程（6, 17） ──────────────────────────────────────────────────


@pytest.mark.integration
class TestSyncFlow:
    async def test_both_sources_success_aggregates(self, client, monkeypatch, db_clean):
        _patch_sap(
            monkeypatch,
            sg_records=[{"AUFNR": "A1", "CPXH": "sg1"}, {"AUFNR": "A2"}],
            kk_records=[{"AUFNR": "A2", "CPXH": "kk2"}, {"AUFNR": "A3"}],
        )
        resp = await client.post(
            "/api/sales-orders/sync",
            json={
                "start_date": "2026-07-01",
                "end_date": "2026-07-31",
                "prodh_list": ["00100"],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["partial_success"] is False
        assert body["total_fetched"] == 4
        assert body["total_unique"] == 3  # A1, A2, A3
        assert body["total_skipped"] == 0
        assert body["inserted"] == 3
        assert body["updated"] == 0
        assert len(body["orders"]) == 3
        # 统计与实际写入一致
        assert len(db_clean["sales_orders_sap"]._docs) == 3

    async def test_stats_consistent_with_writes(self, client, monkeypatch, db_clean):
        _patch_sap(
            monkeypatch,
            sg_records=[{"AUFNR": "X1"}, {"AUFNR": "X2"}],
            kk_records=[{"AUFNR": "X3"}],
        )
        resp = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-07-01", "end_date": "2026-07-31"},
        )
        body = resp.json()
        assert body["inserted"] + body["updated"] == body["total_unique"]
        assert body["inserted"] + body["updated"] == len(db_clean["sales_orders_sap"]._docs)


# ─── 去重与跨来源合并（7, 8, 9） ───────────────────────────────────────────


@pytest.mark.integration
class TestDedupAndMerge:
    async def test_same_source_duplicate_keeps_last(self, client, monkeypatch, db_clean):
        _patch_sap(
            monkeypatch,
            sg_records=[
                {"AUFNR": "A1", "CPXH": "first"},
                {"AUFNR": "A1", "CPXH": "last"},
            ],
            kk_records=[],
        )
        resp = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-07-01", "end_date": "2026-07-31"},
        )
        body = resp.json()
        assert body["total_unique"] == 1
        doc = body["orders"][0]
        assert doc["aufnr"] == "A1"
        assert doc["source_records"]["SG"]["CPXH"] == "last"
        assert doc["sources"] == ["SG"]

    async def test_same_aufnr_in_both_sources_single_doc(self, client, monkeypatch, db_clean):
        _patch_sap(
            monkeypatch,
            sg_records=[{"AUFNR": "A1", "CPXH": "sg"}],
            kk_records=[{"AUFNR": "A1", "CPXH": "kk"}],
        )
        resp = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-07-01", "end_date": "2026-07-31"},
        )
        body = resp.json()
        assert body["total_unique"] == 1
        assert len(body["orders"]) == 1
        doc = body["orders"][0]
        assert doc["aufnr"] == "A1"
        assert doc["sources"] == ["SG", "KK"]

    async def test_both_source_records_preserved(self, client, monkeypatch, db_clean):
        _patch_sap(
            monkeypatch,
            sg_records=[{"AUFNR": "A1", "CPXH": "sg"}],
            kk_records=[{"AUFNR": "A1", "CPXH": "kk"}],
        )
        resp = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-07-01", "end_date": "2026-07-31"},
        )
        doc = resp.json()["orders"][0]
        # 两来源原始记录分别保留
        assert doc["source_records"]["SG"]["CPXH"] == "sg"
        assert doc["source_records"]["KK"]["CPXH"] == "kk"
        assert "fetched_at" in doc["source_records"]["SG"]
        assert "fetched_at" in doc["source_records"]["KK"]
        # data 取最后一个成功来源（KK）的完整记录
        assert doc["data"]["CPXH"] == "kk"


# ─── 缺 AUFNR 跳过（10） ───────────────────────────────────────────────────


@pytest.mark.integration
class TestSkipMissingAufnr:
    async def test_missing_aufnr_skipped_and_counted(self, client, monkeypatch, db_clean):
        _patch_sap(
            monkeypatch,
            sg_records=[
                {"AUFNR": "A1"},
                {"AUFNR": ""},  # 空字符串 → 跳过
                {"CPXH": "no-aufnr"},  # 缺字段 → 跳过
            ],
            kk_records=[{"AUFNR": "A2"}],
        )
        resp = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-07-01", "end_date": "2026-07-31"},
        )
        body = resp.json()
        assert body["sources"]["SG"]["skipped_count"] == 2
        assert body["total_unique"] == 2  # A1, A2
        assert len(body["orders"]) == 2
        aufnrs = {o["aufnr"] for o in body["orders"]}
        assert aufnrs == {"A1", "A2"}


# ─── inserted / updated（11, 12） ──────────────────────────────────────────


@pytest.mark.integration
class TestInsertUpdate:
    async def test_first_sync_inserted(self, client, monkeypatch, db_clean):
        _patch_sap(
            monkeypatch,
            sg_records=[{"AUFNR": "A1"}, {"AUFNR": "A2"}],
            kk_records=[],
        )
        resp = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-07-01", "end_date": "2026-07-31"},
        )
        body = resp.json()
        assert body["inserted"] == 2
        assert body["updated"] == 0

    async def test_second_sync_updated(self, client, monkeypatch, db_clean):
        _patch_sap(
            monkeypatch,
            sg_records=[{"AUFNR": "A1"}, {"AUFNR": "A2"}],
            kk_records=[],
        )
        # 第一次
        await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-07-01", "end_date": "2026-07-31"},
        )
        # 第二次：相同 AUFNR，更新字段
        _patch_sap(
            monkeypatch,
            sg_records=[{"AUFNR": "A1", "CPXH": "v2"}, {"AUFNR": "A2", "CPXH": "v2"}],
            kk_records=[],
        )
        resp = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-07-01", "end_date": "2026-07-31"},
        )
        body = resp.json()
        assert body["inserted"] == 0
        assert body["updated"] == 2
        # sync_count 累计为 2
        doc = next(d for d in db_clean["sales_orders_sap"]._docs.values() if d["aufnr"] == "A1")
        assert doc["sync_count"] == 2
        # 已存未知字段不删除：第一次没有 CPXH，第二次写入后 data 仍包含 CPXH
        assert doc["data"]["CPXH"] == "v2"


# ─── 部分成功（13） ────────────────────────────────────────────────────────


@pytest.mark.integration
class TestPartialSuccess:
    async def test_one_source_fails_other_written(self, client, monkeypatch, db_clean):
        _patch_sap(
            monkeypatch,
            sg_records=[{"AUFNR": "A1", "CPXH": "sg"}],
            kk_error="SAP returned HTTP 500",
        )
        resp = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-07-01", "end_date": "2026-07-31"},
        )
        body = resp.json()
        assert resp.status_code == 200
        assert body["success"] is True
        assert body["partial_success"] is True
        assert body["sources"]["SG"]["success"] is True
        assert body["sources"]["KK"]["success"] is False
        assert len(body["orders"]) == 1
        assert body["orders"][0]["aufnr"] == "A1"
        # SG 成功写入，KK 未写库
        assert len(db_clean["sales_orders_sap"]._docs) == 1

    async def test_second_partial_sync_keeps_previous_successful_source(
        self, client, monkeypatch, db_clean
    ):
        _patch_sap(
            monkeypatch,
            sg_records=[{"AUFNR": "A1", "CPXH": "sg-v1"}],
            kk_records=[{"AUFNR": "A1", "CPXH": "kk-v1"}],
        )
        first = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-07-01", "end_date": "2026-07-31"},
        )
        assert first.status_code == 200

        _patch_sap(
            monkeypatch,
            sg_records=[{"AUFNR": "A1", "CPXH": "sg-v2"}],
            kk_error="KK timeout",
        )
        second = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-08-01", "end_date": "2026-08-31"},
        )
        assert second.status_code == 200
        doc = second.json()["orders"][0]
        assert doc["sources"] == ["SG", "KK"]
        assert doc["source_records"]["SG"]["CPXH"] == "sg-v2"
        assert doc["source_records"]["KK"]["CPXH"] == "kk-v1"


# ─── 双来源失败（14） ──────────────────────────────────────────────────────


@pytest.mark.integration
class TestBothFailed:
    async def test_both_fail_returns_502(self, client, monkeypatch, db_clean):
        _patch_sap(
            monkeypatch,
            sg_error="SG timeout",
            kk_error="KK timeout",
        )
        resp = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-07-01", "end_date": "2026-07-31"},
        )
        assert resp.status_code == 502
        body = resp.json()
        assert body["detail"]["message"] == "Both SAP sources failed"
        assert body["detail"]["sources"]["SG"]["success"] is False
        assert body["detail"]["sources"]["KK"]["success"] is False
        # 不执行数据库写入
        assert len(db_clean["sales_orders_sap"]._docs) == 0


# ─── DB 写入失败（16） ─────────────────────────────────────────────────────


@pytest.mark.integration
class TestDbWriteFailure:
    async def test_bulk_write_failure_returns_500(self, client, monkeypatch, db_clean):
        _patch_sap(
            monkeypatch,
            sg_records=[{"AUFNR": "A1"}],
            kk_records=[],
        )

        from app.repositories import sales_order_repository as repo

        async def boom(*args, **kwargs):
            raise RuntimeError("bulk write exploded")

        monkeypatch.setattr(repo, "upsert_sales_orders", boom)

        resp = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2026-07-01", "end_date": "2026-07-31"},
        )
        assert resp.status_code == 500
        # 不返回伪成功
        assert resp.json().get("success") is not True
