"""
Unit tests for SAP 销售订单客户端（不连接生产环境，SAP 使用 mock client）。

覆盖：
- 请求头签名（time + MD5 sign）生成
- payload 的 PRODH_LIST 处理
- 成功 / 单来源失败 / 双来源失败
- 非 JSON、错误 MSGTY、非法 DATA、HTTP 非 2xx、网络异常
- 并发抓取两个来源
"""
import hashlib
from datetime import date, datetime

import httpx

from app.services.sap_sales_order_service import (
    METHOD,
    SapSalesOrderService,
)


class FakeResponse:
    def __init__(self, status_code: int = 200, json_data=None):
        self.status_code = status_code
        self._json = json_data

    def json(self):
        if self._json is None:
            raise ValueError("No JSON content")
        return self._json


class FakeClient:
    """可调的 mock httpx.AsyncClient。"""

    def __init__(self, by_url=None, by_callable=None, raise_exc=None):
        self.by_url = by_url or {}
        self.by_callable = by_callable
        self.raise_exc = raise_exc
        self.calls = []

    async def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append(
            {"url": url, "json": json, "headers": headers, "timeout": timeout}
        )
        if self.raise_exc is not None:
            raise self.raise_exc
        if self.by_callable is not None:
            return self.by_callable(url, json, headers)
        return self.by_url.get(url, FakeResponse(200, {"DATA": []}))


SG_URL = "http://10.2.101.37:8000/sap/ZHTTP_SIMS?sap-client=800"
KK_URL = "http://10.8.100.11:8001/sap/ZHTTP_SIMS?sap-client=600"


# ─── 请求头签名 ─────────────────────────────────────────────────────────────


class TestBuildHeaders:
    def test_sign_and_time_generation(self):
        fixed = datetime(2026, 8, 17, 10, 30, 0)
        time_value = fixed.strftime("%Y%m%d")  # 20260817
        expected_sign = hashlib.md5(
            f"sugon{METHOD}{time_value}sugon".encode()
        ).hexdigest().upper()

        svc = SapSalesOrderService()
        headers = svc._build_headers(fixed)

        assert headers["time"] == time_value
        assert headers["sign"] == expected_sign
        assert headers["method"] == METHOD
        assert headers["Content-Type"] == "application/json"

    def test_sign_uses_current_server_date_not_query_date(self):
        # 查询日期与签名日期独立；签名永远用服务器当前日期
        fixed = datetime(2026, 1, 1, 0, 0, 0)
        svc = SapSalesOrderService()
        headers = svc._build_headers(fixed)
        assert headers["time"] == "20260101"
        # 即便查询日期是 2026-07，签名 time 仍来自传入的服务器时间


# ─── payload 构建 ──────────────────────────────────────────────────────────


class TestBuildPayload:
    def test_with_prodh_list(self):
        svc = SapSalesOrderService()
        p = svc._build_payload(date(2026, 7, 1), date(2026, 7, 31), ["00100"])
        assert p == {
            "CHDAT": "2026-07-01",
            "CHDAT_TO": "2026-07-31",
            "PRODH_LIST": ["00100"],
        }

    def test_none_prodh_list_not_written(self):
        svc = SapSalesOrderService()
        p = svc._build_payload(date(2026, 7, 1), date(2026, 7, 31), None)
        assert "PRODH_LIST" not in p

    def test_empty_prodh_list_not_written(self):
        svc = SapSalesOrderService()
        p = svc._build_payload(date(2026, 7, 1), date(2026, 7, 31), [])
        assert "PRODH_LIST" not in p


# ─── 成功抓取 ──────────────────────────────────────────────────────────────


class TestFetchAllSuccess:
    async def test_both_sources_success(self):
        sg_data = [{"AUFNR": "A1"}, {"AUFNR": "A2"}]
        kk_data = [{"AUFNR": "A2"}, {"AUFNR": "A3"}]
        client = FakeClient(by_url={
            SG_URL: FakeResponse(200, {"DATA": sg_data}),
            KK_URL: FakeResponse(200, {"DATA": kk_data}),
        })
        svc = SapSalesOrderService(client=client)
        results = await svc.fetch_all(date(2026, 7, 1), date(2026, 7, 31), None)

        assert set(results.keys()) == {"SG", "KK"}
        assert results["SG"].success and results["SG"].records == sg_data
        assert results["KK"].success and results["KK"].records == kk_data
        # 并发：两个 URL 都被请求，且使用了签名头
        requested = {c["url"] for c in client.calls}
        assert requested == {SG_URL, KK_URL}
        for c in client.calls:
            assert c["headers"]["sign"]
            assert c["headers"]["time"]

    async def test_records_returned_as_is_no_dedup_in_service(self):
        # 去重在 repository 层做；service 原样返回
        sg_data = [{"AUFNR": "A1"}, {"AUFNR": "A1"}]
        client = FakeClient(by_url={SG_URL: FakeResponse(200, {"DATA": sg_data})})
        svc = SapSalesOrderService(client=client)
        results = await svc.fetch_all(date(2026, 7, 1), date(2026, 7, 31), None)
        assert len(results["SG"].records) == 2


# ─── 单来源失败 ────────────────────────────────────────────────────────────


class TestFetchPartialFailure:
    async def test_one_source_fails(self):
        client = FakeClient(by_url={
            SG_URL: FakeResponse(200, {"DATA": [{"AUFNR": "A1"}]}),
            KK_URL: FakeResponse(500, {"DATA": []}),
        })
        svc = SapSalesOrderService(client=client)
        results = await svc.fetch_all(date(2026, 7, 1), date(2026, 7, 31), None)
        assert results["SG"].success
        assert not results["KK"].success
        assert "HTTP 500" in results["KK"].error


# ─── 双来源失败 ────────────────────────────────────────────────────────────


class TestFetchBothFailure:
    async def test_both_sources_fail(self):
        client = FakeClient(by_url={
            SG_URL: FakeResponse(500, {"DATA": []}),
            KK_URL: FakeResponse(500, {"DATA": []}),
        })
        svc = SapSalesOrderService(client=client)
        results = await svc.fetch_all(date(2026, 7, 1), date(2026, 7, 31), None)
        assert not results["SG"].success
        assert not results["KK"].success


# ─── 响应校验 ──────────────────────────────────────────────────────────────


class TestResponseValidation:
    async def test_non_json_response(self):
        client = FakeClient(by_url={SG_URL: FakeResponse(200, None)})
        svc = SapSalesOrderService(client=client)
        res = await svc._fetch_source("SG", client, {}, {})
        assert not res.success
        assert "not valid JSON" in res.error

    async def test_error_msgty(self):
        client = FakeClient(by_url={SG_URL: FakeResponse(200, {"MSGTY": "E", "MSGTX": "bad order"})})
        svc = SapSalesOrderService(client=client)
        res = await svc._fetch_source("SG", client, {}, {})
        assert not res.success
        assert "bad order" in res.error

    async def test_missing_data_array(self):
        client = FakeClient(by_url={SG_URL: FakeResponse(200, {"MSGTY": "S"})})
        svc = SapSalesOrderService(client=client)
        res = await svc._fetch_source("SG", client, {}, {})
        assert not res.success
        assert "DATA" in res.error

    async def test_data_not_a_list(self):
        client = FakeClient(by_url={SG_URL: FakeResponse(200, {"MSGTY": "S", "DATA": {"x": 1}})})
        svc = SapSalesOrderService(client=client)
        res = await svc._fetch_source("SG", client, {}, {})
        assert not res.success

    async def test_http_non_2xx(self):
        client = FakeClient(by_url={SG_URL: FakeResponse(404, {"DATA": []})})
        svc = SapSalesOrderService(client=client)
        res = await svc._fetch_source("SG", client, {}, {})
        assert not res.success
        assert "HTTP 404" in res.error

    async def test_network_error(self):
        client = FakeClient(raise_exc=httpx.ConnectTimeout("timeout"))
        svc = SapSalesOrderService(client=client)
        res = await svc._fetch_source("SG", client, {}, {})
        assert not res.success
        assert "failed" in res.error
