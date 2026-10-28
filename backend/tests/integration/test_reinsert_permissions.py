from unittest.mock import AsyncMock

import pytest

from app.base_access import current_base_permissions
from app.services import reinsert_rate


@pytest.mark.asyncio
async def test_reinsert_requires_permission_status_and_base_scope(
    admin_client, db_clean, monkeypatch
):
    created = await admin_client.post(
        "/api/admin/users",
        json={
            "username": "reinsert-user",
            "displayName": "Reinsert User",
            "password": "password123",
            "dashboardPermissions": ["reinsert-rate"],
            "basePermissions": ["1000"],
        },
    )
    assert created.status_code == 201
    login = await admin_client.post(
        "/api/auth/login",
        json={
            "username": "reinsert-user",
            "password": "password123",
        },
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    url = "/api/rty/reinsert-rate?dateFrom=2026-01-01&dateTo=2026-01-31"
    assert (await admin_client.get(url, headers=headers)).status_code == 403

    await db_clean["configs"].insert_one(
        {
            "key": "dashboard_statuses",
            "statuses": {"reinsert-rate": "available"},
        }
    )

    async def load(*args):
        assert current_base_permissions() == ("1000",)
        return [], [], {}, []

    monkeypatch.setattr(reinsert_rate, "load_sources", AsyncMock(side_effect=load))
    assert (await admin_client.get(url, headers=headers)).status_code == 200
    assert (await admin_client.get(f"{url}&bases=3000", headers=headers)).status_code == 403
    assert (
        await admin_client.get(
            "/api/rty/reinsert-rate/details?dateFrom=2026-01-01&dateTo=2026-01-31"
            "&base=3000&month=2026-01&kind=orders",
            headers=headers,
        )
    ).status_code == 403

    denied = await admin_client.post(
        "/api/admin/users",
        json={
            "username": "no-reinsert",
            "displayName": "No Reinsert",
            "password": "password123",
            "dashboardPermissions": ["repair-quality"],
            "basePermissions": ["1000"],
        },
    )
    assert denied.status_code == 201
    login = await admin_client.post(
        "/api/auth/login",
        json={
            "username": "no-reinsert",
            "password": "password123",
        },
    )
    assert (
        await admin_client.get(
            url,
            headers={
                "Authorization": f"Bearer {login.json()['access_token']}",
            },
        )
    ).status_code == 403


@pytest.mark.asyncio
async def test_reinsert_detail_model_scope_including_empty_model(admin_client, monkeypatch):
    orders = [
        {"AUFNR": "1", "GSTRS": "20260115", "MAKTX_TH": "M1", "LGORT": "1000", "GAMNG": "10"},
        {"AUFNR": "2", "GSTRS": "20260115", "MAKTX_TH": "", "LGORT": "1000", "GAMNG": "20"},
    ]
    monkeypatch.setattr(
        reinsert_rate, "load_sources", AsyncMock(return_value=(orders, [], {}, []))
    )
    url = (
        "/api/rty/reinsert-rate/details?dateFrom=2026-01-01&dateTo=2026-01-31"
        "&base=1000&month=2026-01&kind=orders"
    )
    for suffix, expected in [("", ["1", "2"]), ("&model=M1", ["1"]), ("&model=", ["2"])]:
        response = await admin_client.get(url + suffix)
        assert response.status_code == 200
        assert [item["AUFNR"] for item in response.json()["data"]["items"]] == expected
