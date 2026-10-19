"""Authenticated requests must enforce base scope even when dashboard access is granted."""

from unittest.mock import AsyncMock

import pytest

from app.api import data_gateway as gateway_api
from app.api import lrr, process_records, sn_info
from app.services.data_gateway_client import data_gateway


@pytest.fixture
async def base_users(client, app, monkeypatch):
    app.include_router(lrr.router, prefix="/api/lrr")
    app.include_router(process_records.router, prefix="/api/process-records")
    app.include_router(sn_info.router, prefix="/api/sn-info")
    app.include_router(gateway_api.router, prefix="/api/data-gateway")
    login = await client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    admin = {"Authorization": f"Bearer {login.json()['access_token']}"}
    created = await client.post(
        "/api/admin/users",
        headers=admin,
        json={
            "username": "base-user",
            "displayName": "Base User",
            "password": "initial-password",
            "dashboardPermissions": ["rty", "station-pass-rate", "lrr", "process-records"],
            "basePermissions": ["天津"],
        },
    )
    assert created.status_code == 201
    assert created.json()["basePermissions"] == ["1000"]
    login = await client.post(
        "/api/auth/login",
        json={
            "username": "base-user",
            "password": "initial-password",
        },
    )
    scoped = {"Authorization": f"Bearer {login.json()['access_token']}"}
    orders = [
        {
            "aufnr": "1",
            "inventoryLocation": "1000",
            "productionModel": "TJ-model",
            "plannedStartDate": "2026-10-01",
            "salesOrder": "SO-TJ",
            "customerId": "C-TJ",
            "raw": {"data": {"WMENG": 10}},
        },
        {
            "aufnr": "2",
            "inventoryLocation": "3000",
            "productionModel": "KS-model",
            "plannedStartDate": "2026-10-01",
            "salesOrder": "SO-KS",
            "customerId": "C-KS",
            "raw": {"data": {"WMENG": 20}},
        },
    ]
    monkeypatch.setattr(data_gateway, "all_orders", AsyncMock(return_value=orders))
    return admin, scoped


async def test_search_options_only_include_authorized_base_and_its_models(client, base_users):
    _, scoped = base_users
    options = (await client.get("/api/rty/filter-options", headers=scoped)).json()["data"]
    assert options == {
        "productModels": [{"model": "TJ-model", "count": 10}],
        "bases": [{"base": "1000", "count": 10}],
        "customers": ["C-TJ"],
    }
    assert (await client.get("/api/rty/sales-orders", headers=scoped)).json()["data"] == ["SO-TJ"]
    assert (await client.get("/api/lrr/options", headers=scoped)).json()["bases"] == ["1000"]
    photo_options = (await client.get("/api/process-records/filter-options", headers=scoped)).json()
    assert [item["name"] for item in photo_options["data"]["bases"]] == ["天津"]


@pytest.mark.parametrize(
    "path",
    [
        "/api/rty/list?base=3000",
        "/api/rty/station-pass-rates?base=昆山",
        "/api/rty/station-pass-details?stationCode=OP10&base=3000",
        "/api/rty/export?bases=1000&bases=3000",
        "/api/rty/cycle-export?bases=3000",
        "/api/rty/station-pass-export?base=3000",
        "/api/rty/defects/by-filters?base=3000",
        "/api/lrr/list?base=3000",
        "/api/lrr/fault-details?base=3000",
        "/api/process-records/realtime?base=昆山",
        "/api/process-records/image?source=system1&path=Upload/Tables/test/a.jpg",
    ],
)
async def test_explicit_unauthorized_search_details_and_exports_return_403(
    client, base_users, path
):
    _, scoped = base_users
    assert (await client.get(path, headers=scoped)).status_code == 403


async def test_sn_and_order_detail_queries_do_not_bypass_base_scope(
    client, base_users, monkeypatch
):
    from app.services import rty_gateway

    _, scoped = base_users
    lookup = AsyncMock(
        return_value=[
            {"AUFNR": "1", "PCODE": "ALLOWED"},
            {"AUFNR": "2", "PCODE": "DENIED"},
            {"PCODE": "UNKNOWN"},
        ]
    )
    monkeypatch.setattr(rty_gateway, "_faults_for_sns", lookup)
    response = await client.get("/api/rty/defects?sns=ALLOWED,DENIED,UNKNOWN", headers=scoped)
    assert [row["sn"] for row in response.json()["data"]] == ["ALLOWED"]
    order_faults = AsyncMock(side_effect=AssertionError("Denied order must not load faults"))
    monkeypatch.setattr(rty_gateway, "_faults_for_orders", order_faults)
    response = await client.get("/api/rty/defects/by-order?productionOrder=2", headers=scoped)
    assert response.json()["data"] == []
    order_faults.assert_not_awaited()


async def test_permissions_change_on_existing_token_and_null_differs_from_empty(client, base_users):
    admin, scoped = base_users
    for scopes, expected in [(["3000"], ["3000"]), ([], []), (None, ["1000", "3000"])]:
        update = await client.patch(
            "/api/admin/users/base-user",
            headers=admin,
            json={
                "basePermissions": scopes,
            },
        )
        assert update.status_code == 200
        assert update.json()["basePermissions"] == scopes
        profile = (await client.get("/api/auth/me", headers=scoped)).json()
        assert profile["user"]["basePermissions"] == scopes
        bases = (await client.get("/api/rty/bases", headers=scoped)).json()["data"]
        assert [item["base"] for item in bases] == expected


async def test_sn_info_authorizes_source_rows_before_merging_matching_serial_numbers(
    client, base_users, monkeypatch
):
    from app.services.sap_sn_info_service import SnInfoSourceFetchResult

    _, scoped = base_users
    monkeypatch.setattr(
        sn_info.SapSnInfoService,
        "fetch_all",
        AsyncMock(
            return_value={
                "SG": SnInfoSourceFetchResult(
                    source="SG", records=[{"PCODE": "SAME-SN", "AUFNR": "1"}]
                ),
                "KK": SnInfoSourceFetchResult(
                    source="KK",
                    records=[
                        {"PCODE": "SAME-SN", "AUFNR": "2", "MATNR": "DENIED-MATERIAL"},
                    ],
                ),
            }
        ),
    )
    response = await client.post(
        "/api/sn-info/query", headers=scoped, json={"SN_LIST": ["SAME-SN"]}
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["matched_count"] == 1
    assert data["items"][0]["MATNR"] == ""
    assert data["items"][0]["sources"] == ["SG"]
    assert data["sources"]["KK"]["fetched_count"] == 0


async def test_image_endpoint_rechecks_grant_after_permissions_are_revoked(
    client, base_users, monkeypatch
):
    from app.services.image_access import image_grant

    admin, scoped = base_users
    fetch_image = AsyncMock(return_value=(b"image", "image/jpeg"))
    monkeypatch.setattr(process_records.process_record_gateway, "fetch_image", fetch_image)
    path = "Upload/Tables/test/allowed.jpg"
    params = {
        "source": "system1",
        "path": path,
        "accessToken": image_grant("system1", path, "1000"),
    }
    response = await client.get("/api/process-records/image", headers=scoped, params=params)
    assert response.status_code == 200
    assert response.content == b"image"
    assert response.headers["cache-control"] == "private, no-store"
    await client.patch("/api/admin/users/base-user", headers=admin, json={"basePermissions": []})
    response = await client.get("/api/process-records/image", headers=scoped, params=params)
    assert response.status_code == 403
    fetch_image.assert_awaited_once()


async def test_administrators_are_also_scoped_and_cannot_escalate_base_permissions(
    client, base_users
):
    admin, scoped = base_users
    await client.patch("/api/admin/users/base-user", headers=admin, json={"role": "admin"})
    assert (await client.get("/api/rty/list?base=3000", headers=scoped)).status_code == 403
    assert (await client.get("/api/data-gateway/orders", headers=scoped)).status_code == 403
    options = await client.get("/api/admin/base-options", headers=scoped)
    assert options.json() == [{"code": "1000", "name": "天津"}]
    for scopes in (None, ["3000"], ["1000", "3000"]):
        response = await client.patch(
            "/api/admin/users/base-user",
            headers=scoped,
            json={
                "basePermissions": scopes,
            },
        )
        assert response.status_code == 403
        response = await client.post(
            "/api/admin/users",
            headers=scoped,
            json={
                "username": "child",
                "displayName": "Child",
                "password": "initial-password",
                "basePermissions": scopes,
            },
        )
        assert response.status_code == 403
    created = await client.post(
        "/api/admin/users",
        headers=scoped,
        json={
            "username": "child",
            "displayName": "Child",
            "password": "initial-password",
            "basePermissions": ["1000"],
        },
    )
    assert created.status_code == 201
    assert (
        await client.patch(
            "/api/admin/users/admin",
            headers=scoped,
            json={
                "basePermissions": ["1000"],
            },
        )
    ).status_code == 403


async def test_station_only_user_can_load_scoped_search_options(client, base_users):
    admin, scoped = base_users
    await client.patch(
        "/api/admin/users/base-user",
        headers=admin,
        json={
            "dashboardPermissions": ["station-pass-rate"],
        },
    )
    assert (await client.get("/api/rty/filter-options", headers=scoped)).status_code == 200
    assert (await client.get("/api/rty/list", headers=scoped)).status_code == 403


async def test_station_details_and_lrr_list_cache_keep_the_authenticated_scope(
    client, base_users, monkeypatch
):
    from app.schemas.lrr import LRRListResponse
    from app.services import rty_gateway

    _, scoped = base_users
    monkeypatch.setattr(
        data_gateway,
        "all_station_rows",
        AsyncMock(
            return_value=[
                {"raw": {"PCODE": "TJ-SN", "LGORT": "1000", "GSTRS": "20261001", "SPEC": "OP10"}},
                {"raw": {"PCODE": "KS-SN", "LGORT": "3000", "GSTRS": "20261001", "SPEC": "OP10"}},
            ]
        ),
    )
    repairs = AsyncMock(return_value=[])
    monkeypatch.setattr(rty_gateway, "_station_repairs_for_sns", repairs)
    response = await client.get("/api/rty/station-pass-details?stationCode=OP10", headers=scoped)
    assert [item["sn"] for item in response.json()["data"]] == ["TJ-SN"]
    assert repairs.await_args.args[0] == {"TJ-SN"}

    queries = []

    async def loader(_request, query):
        queries.append(query)
        return LRRListResponse(items=[], total=0, page=1, limit=50, has_more=False), "miss"

    monkeypatch.setattr(lrr, "_load_lrr_list_for_request", loader)
    response = await client.get(
        "/api/lrr/list?plannedDateFrom=2026-10-01&plannedDateTo=2026-10-31",
        headers=scoped,
    )
    assert response.status_code == 200
    assert queries[0].base_permissions == ("1000",)


@pytest.mark.parametrize("scopes", [[""], ["  "], [1], "1000", ["x" * 41]])
async def test_invalid_base_permissions_are_rejected(client, base_users, scopes):
    admin, _ = base_users
    response = await client.patch(
        "/api/admin/users/base-user",
        headers=admin,
        json={
            "basePermissions": scopes,
        },
    )
    assert response.status_code == 422
