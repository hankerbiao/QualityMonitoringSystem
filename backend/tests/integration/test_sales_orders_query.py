"""
销售订单筛选 / 统计接口集成测试（mock MongoDB + mock SAP）。

覆盖：
- GET /api/sales-orders/      按机型 / 基地 / 时间范围筛选 + 分页
- GET /api/sales-orders/stats 按机型 / 基地 / 月份 多维度统计
- sync 写入时自动归一化 data.GSTRS（端到端验证）
"""

import pytest

from app.services.sap_sales_order_service import (
    SapSalesOrderService,
    SourceFetchResult,
)


@pytest.fixture
def app():
    """测试应用：conftest 默认不含 sales_orders 路由，这里补上。"""
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
    """销售订单查询测试使用普通用户登录态。"""
    from httpx import ASGITransport, AsyncClient

    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {make_test_access_token('alice')}"},
    )


SEED = [
    {
        "aufnr": "A1",
        "data": {
            "MAKTX_TH": "X1",
            "LGORT": "BJ",
            "GAMNG": 10,
            "GSTRS": "2025/7/8 16:58:34",
            "ZDATE_STARTED": "2024/1/1",
        },
        "gstrs_date": "2025-07-08",
        "quantity": 10,
    },
    {
        "aufnr": "A2",
        "data": {
            "MAKTX_TH": "X1",
            "LGORT": "SH",
            "GAMNG": 20,
            "GSTRS": "2025/8/1",
            "ZDATE_STARTED": "2024/1/2",
        },
        "gstrs_date": "2025-08-01",
        "quantity": 20,
    },
    {
        "aufnr": "A3",
        "data": {
            "MAKTX_TH": "X2",
            "LGORT": "BJ",
            "GAMNG": 30,
            "GSTRS": "2025/7/20",
            "ZDATE_STARTED": "2024/1/3",
        },
        "gstrs_date": "2025-07-20",
        "quantity": 30,
    },
    {
        "aufnr": "A4",
        "data": {
            "MAKTX_TH": "X2",
            "LGORT": "SH",
            "GAMNG": 40,
            "GSTRS": "2025/9/15",
            "ZDATE_STARTED": "2024/1/4",
        },
        "gstrs_date": "2025-09-15",
        "quantity": 40,
    },
]


@pytest.mark.integration
class TestListSalesOrders:
    async def _seed(self, db):
        await db["sales_orders_sap"].insert_many([dict(d) for d in SEED])

    async def test_filter_by_model(self, client, db_clean):
        await self._seed(db_clean)
        resp = await client.get("/api/sales-orders/query?cp_xh=X1")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2
        assert {it["aufnr"] for it in body["items"]} == {"A1", "A2"}

    async def test_filter_by_base_multi(self, client, db_clean):
        await self._seed(db_clean)
        resp = await client.get("/api/sales-orders/query?lgort=BJ&lgort=SH")
        assert resp.status_code == 200
        assert resp.json()["total"] == 4

    async def test_date_range_from_only(self, client, db_clean):
        await self._seed(db_clean)
        resp = await client.get("/api/sales-orders/query?date_from=2025-08-01")
        assert resp.status_code == 200
        body = resp.json()
        assert {it["aufnr"] for it in body["items"]} == {"A2", "A4"}

    async def test_date_range_both(self, client, db_clean):
        await self._seed(db_clean)
        resp = await client.get("/api/sales-orders/query?date_from=2025-07-20&date_to=2025-08-31")
        body = resp.json()
        assert {it["aufnr"] for it in body["items"]} == {"A2", "A3"}

    async def test_pagination(self, client, db_clean):
        await self._seed(db_clean)
        r1 = await client.get("/api/sales-orders/query?limit=2&page=1")
        b1 = r1.json()
        assert len(b1["items"]) == 2
        assert b1["total"] == 4
        assert b1["has_more"] is True
        r2 = await client.get("/api/sales-orders/query?limit=2&page=2")
        assert r2.json()["has_more"] is False

    async def test_serialized_gstrs_date(self, client, db_clean):
        await self._seed(db_clean)
        resp = await client.get("/api/sales-orders/query?cp_xh=X1")
        for item in resp.json()["items"]:
            assert item["gstrs_date"] in ("2025-07-08", "2025-08-01")

    async def test_customer_options_are_unique_and_sorted(self, client, db_clean):
        await db_clean["sales_orders_sap"].insert_many(
            [
                {"aufnr": "C1", "data": {"NAME1_ZU": "客户B"}},
                {"aufnr": "C2", "data": {"NAME1_ZU": "客户A"}},
                {"aufnr": "C3", "data": {"NAME1_ZU": "客户B"}},
                {"aufnr": "C4", "data": {"NAME1_ZU": ""}},
            ]
        )
        resp = await client.get("/api/sales-orders/query")
        assert resp.status_code == 200
        assert resp.json()["filterOptions"]["customers"] == ["客户A", "客户B"]


@pytest.mark.integration
class TestStatsSalesOrders:
    async def _seed(self, db):
        await db["sales_orders_sap"].insert_many([dict(d) for d in SEED])

    async def test_overall_stats(self, client, db_clean):
        await self._seed(db_clean)
        resp = await client.get("/api/sales-orders/query")
        assert resp.status_code == 200
        body = resp.json()["stats"]
        assert body["total"] == 4
        assert body["total_quantity"] == 100  # GAMNG 10+20+30+40
        assert {i["key"]: i["count"] for i in body["by_model"]} == {"X1": 2, "X2": 2}
        assert {i["key"]: i["count"] for i in body["by_base"]} == {"BJ": 2, "SH": 2}
        assert {i["key"]: i["count"] for i in body["by_month"]} == {
            "2025-07": 2,
            "2025-08": 1,
            "2025-09": 1,
        }

    async def test_stats_with_model_filter(self, client, db_clean):
        await self._seed(db_clean)
        resp = await client.get("/api/sales-orders/query?cp_xh=X1")
        body = resp.json()["stats"]
        assert body["total"] == 2
        assert body["total_quantity"] == 30  # 仅 X1（A1=10 + A2=20）联动
        assert {i["key"]: i["count"] for i in body["by_model"]} == {"X1": 2}
        assert {i["key"]: i["count"] for i in body["by_base"]} == {"BJ": 1, "SH": 1}


@pytest.mark.integration
class TestSyncNormalizesGstrsDate:
    async def test_sync_populates_gstrs_date(self, client, monkeypatch, db_clean):
        async def fake_fetch(self, start_date, end_date, prodh_list):
            return {
                "SG": SourceFetchResult(
                    source="SG",
                    success=True,
                    records=[
                        {
                            "AUFNR": "Z1",
                            "CPXH": "X9",
                            "LGORT": "BJ",
                            "GSTRS": "2025/3/5 10:00:00",
                            "ZDATE_STARTED": "2024/3/5 10:00:00",
                        }
                    ],
                ),
                "KK": SourceFetchResult(source="KK", success=False, error="down"),
            }

        monkeypatch.setattr(SapSalesOrderService, "fetch_all", fake_fetch)
        resp = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2025-03-01", "end_date": "2025-03-31"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["partial_success"] is True
        assert body["orders"][0]["gstrs_date"] == "2025-03-05"

    async def test_sync_normalizes_quantity_before_statistics(self, client, monkeypatch, db_clean):
        async def fake_fetch(self, start_date, end_date, prodh_list):
            return {
                "SG": SourceFetchResult(
                    source="SG",
                    success=True,
                    records=[
                        {"AUFNR": "Q1", "GAMNG": 10},
                        {"AUFNR": "Q2", "GAMNG": 1.5},
                        {"AUFNR": "Q3", "GAMNG": "2.25"},
                        {"AUFNR": "Q4", "GAMNG": "invalid"},
                    ],
                ),
                "KK": SourceFetchResult(source="KK", success=False, error="down"),
            }

        monkeypatch.setattr(SapSalesOrderService, "fetch_all", fake_fetch)
        response = await client.post(
            "/api/sales-orders/sync",
            json={"start_date": "2025-03-01", "end_date": "2025-03-31"},
        )
        assert response.status_code == 200
        assert {order["quantity"] for order in response.json()["orders"]} == {10, 1.5, 2.25, 0}

        stats = await client.get("/api/sales-orders/query")
        assert stats.status_code == 200
        assert stats.json()["stats"]["total_quantity"] == 13.75
