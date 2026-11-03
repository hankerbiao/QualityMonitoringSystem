from datetime import date
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.api import batch_exception as api
from app.api.auth import get_current_user
from app.main import app
from app.services import batch_exception as service


@pytest.fixture(autouse=True)
def batch_exception_status(monkeypatch):
    statuses = {"batch-exception": "available"}
    monkeypatch.setattr(api, "get_database", lambda: None)
    monkeypatch.setattr(
        api,
        "SettingsService",
        lambda _db: type(
            "StatusService", (), {"get_dashboard_statuses": AsyncMock(side_effect=lambda: statuses)}
        )(),
    )
    service._cache._values.clear()
    service._cache._inflight.clear()
    return statuses


def sample_rows(count=2):
    return [
        {
            "id": f"row-{index}",
            "factory": "天津",
            "state": "Open" if index % 2 else "Closed",
            "models": "6210 C2",
            "causedBy": "客户",
            "orderID": 30238291 + index,
            "salesReceipts": f"00410033{index:02d}",
        }
        for index in range(count)
    ]


async def test_query_builds_upstream_params_and_omits_blank_filters(monkeypatch):
    captured: dict = {}

    async def fake_query_rows(params):
        captured.update(params)
        return 1, [{"id": "a"}]

    monkeypatch.setattr(service, "_query_rows", fake_query_rows)
    data = await service.query_batch_exceptions(
        factory="1000",
        create_time_start=date(2026, 10, 3),
        create_time_end=date(2026, 11, 3),
        models="6210 C2",
        state="Open",
    )
    assert captured == {
        "factory": "1000",
        "createTimeStart": "2026-10-03",
        "createTimeEnd": "2026-11-03",
        "models": "6210 C2",
        "state": "Open",
    }
    assert data["upstreamTotal"] == 1
    assert data["readCount"] == 1
    assert data["complete"] is True
    assert data["queriedAt"]

    captured.clear()
    await service.query_batch_exceptions(
        factory="", create_time_start=date(2026, 10, 3), create_time_end=date(2026, 11, 3)
    )
    assert captured == {
        "factory": "",
        "createTimeStart": "2026-10-03",
        "createTimeEnd": "2026-11-03",
    }


async def test_options_derive_from_sample_and_cache(monkeypatch):
    rows = sample_rows(3) + [
        {
            "models": "6615 X23",
            "causedBy": "供应商",
            "orderID": 1,
            "salesReceipts": "SO-1",
            "state": "Other",
        }
    ]
    loads: list[dict] = []

    async def fake_query_rows(params):
        loads.append(params)
        return len(rows), rows

    async def fake_exception_types():
        return {"生产缺陷": ["人为失误"]}

    monkeypatch.setattr(service, "_query_rows", fake_query_rows)
    monkeypatch.setattr(service, "_load_exception_types", fake_exception_types)

    options = await service.fetch_options("1000")
    assert loads[0]["factory"] == "1000"
    assert options["errTypes"] == {"生产缺陷": ["人为失误"]}
    assert options["models"] == ["6210 C2", "6615 X23"]
    assert options["causedBy"] == ["供应商", "客户"]
    assert options["orders"] and options["salesReceipts"]
    assert {"value": "Open", "label": "未关闭"} in options["states"]
    assert {"value": "Closed", "label": "已关闭"} in options["states"]
    assert {"value": "Other", "label": "Other"} in options["states"]

    await service.fetch_options("1000")
    assert len(loads) == 1  # second call served from cache


async def test_exception_types_endpoint_has_no_code_envelope(monkeypatch):
    """类型接口直接返回 {一级: [二级]}，不能按 code 包装解析。"""

    class FakeResponse:
        status_code = 200

        def __init__(self, payload):
            self._payload = payload

        def json(self):
            return self._payload

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, params=None):
            if url == service.EXCEPTION_TYPE_URL:
                return FakeResponse({"生产缺陷": ["人为失误"], "物料缺陷": ["客供物料"]})
            return FakeResponse({"code": 0, "msg": None, "count": 1, "data": sample_rows(1)})

    monkeypatch.setattr(service, "_client", lambda: FakeClient())
    service._cache._values.clear()
    options = await service.fetch_options("1000")
    assert options["errTypes"] == {"生产缺陷": ["人为失误"], "物料缺陷": ["客供物料"]}
    assert options["models"] == ["6210 C2"]

    # 查询接口仍是 code 包装：非 0 必须报错
    class ErrorClient(FakeClient):
        async def get(self, url, params=None):
            return FakeResponse({"code": 1, "msg": "系统繁忙", "data": []})

    monkeypatch.setattr(service, "_client", lambda: ErrorClient())
    with pytest.raises(service.BatchExceptionUpstreamError, match="系统繁忙"):
        await service.query_batch_exceptions(
            factory="", create_time_start=date(2026, 10, 3), create_time_end=date(2026, 11, 3)
        )


def test_query_requires_permission_and_validates_filters(monkeypatch):
    query = AsyncMock(
        return_value={
            "upstreamTotal": 0,
            "readCount": 0,
            "complete": True,
            "queriedAt": "",
            "rows": [],
        }
    )
    monkeypatch.setattr(api, "query_batch_exceptions", query)
    user = {"role": "user", "dashboardPermissions": [], "basePermissions": None}
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        client = TestClient(app)
        dates = {"createTimeStart": "2026-10-03", "createTimeEnd": "2026-11-03"}

        assert client.get("/api/batch-exception/query", params=dates).status_code == 403
        assert client.get("/api/batch-exception/options").status_code == 403

        user["dashboardPermissions"] = ["batch-exception"]
        assert client.get("/api/batch-exception/query").status_code == 422
        reversed_dates = {"createTimeStart": "2026-11-03", "createTimeEnd": "2026-10-03"}
        assert client.get("/api/batch-exception/query", params=reversed_dates).status_code == 400
        assert (
            client.get(
                "/api/batch-exception/query", params={**dates, "factory": "XXXX"}
            ).status_code
            == 400
        )

        response = client.get(
            "/api/batch-exception/query",
            params={**dates, "factory": "1000", "errTypeFirst": "生产缺陷"},
        )
        assert response.status_code == 200
        assert response.json()["success"] is True
        assert query.await_args.kwargs["factory"] == "1000"
        assert query.await_args.kwargs["err_type_first"] == "生产缺陷"
        assert query.await_args.kwargs["create_time_start"] == date(2026, 10, 3)

        # 管理员不受看板状态限制
        user.update(role="admin", dashboardPermissions=[])
        assert client.get("/api/batch-exception/query", params=dates).status_code == 200
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_factory_scope_follows_base_permissions(monkeypatch):
    query = AsyncMock(
        return_value={
            "upstreamTotal": 0,
            "readCount": 0,
            "complete": True,
            "queriedAt": "",
            "rows": [],
        }
    )
    monkeypatch.setattr(api, "query_batch_exceptions", query)
    dates = {"createTimeStart": "2026-10-03", "createTimeEnd": "2026-11-03"}
    user = {"role": "user", "dashboardPermissions": ["batch-exception"], "basePermissions": ["TJ"]}
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        client = TestClient(app)
        assert (
            client.get(
                "/api/batch-exception/query", params={**dates, "factory": "3000"}
            ).status_code
            == 403
        )
        assert (
            client.get("/api/batch-exception/query", params=dates).status_code == 403
        )  # 受限用户必须选基地
        assert (
            client.get(
                "/api/batch-exception/query", params={**dates, "factory": "1000"}
            ).status_code
            == 200
        )

        # 青岛上游编码 Q000 对应权限编码 QD
        user["basePermissions"] = ["QD"]
        assert (
            client.get(
                "/api/batch-exception/query", params={**dates, "factory": "Q000"}
            ).status_code
            == 200
        )

        # 未受限账号可以查询全部基地
        user["basePermissions"] = None
        assert client.get("/api/batch-exception/query", params=dates).status_code == 200
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_options_expose_factories_within_scope(monkeypatch):
    options = AsyncMock(
        return_value={
            "errTypes": {},
            "models": [],
            "causedBy": [],
            "orders": [],
            "salesReceipts": [],
            "states": [],
        }
    )
    monkeypatch.setattr(api, "fetch_options", options)
    user = {
        "role": "user",
        "dashboardPermissions": ["batch-exception"],
        "basePermissions": ["TJ", "QD"],
    }
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        client = TestClient(app)
        # 受限账号必须先指定基地才能加载筛选项
        assert client.get("/api/batch-exception/options").status_code == 403
        data = client.get("/api/batch-exception/options?factory=1000").json()["data"]
        assert [item["value"] for item in data["factories"]] == ["1000", "Q000"]

        user["basePermissions"] = None
        data = client.get("/api/batch-exception/options").json()["data"]
        assert data["factories"][0] == {"value": "", "label": "全部基地"}
        assert len(data["factories"]) == len(service.FACTORY_OPTIONS) + 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_admin_only_status_blocks_regular_users(monkeypatch, batch_exception_status):
    query = AsyncMock(
        return_value={
            "upstreamTotal": 0,
            "readCount": 0,
            "complete": True,
            "queriedAt": "",
            "rows": [],
        }
    )
    monkeypatch.setattr(api, "query_batch_exceptions", query)
    dates = {"createTimeStart": "2026-10-03", "createTimeEnd": "2026-11-03"}
    user = {"role": "user", "dashboardPermissions": ["batch-exception"], "basePermissions": None}
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        client = TestClient(app)
        batch_exception_status["batch-exception"] = "admin-only"
        assert client.get("/api/batch-exception/query", params=dates).status_code == 403
        user["role"] = "admin"
        assert client.get("/api/batch-exception/query", params=dates).status_code == 200
    finally:
        app.dependency_overrides.pop(get_current_user, None)
