"""Integration tests for administrator user management and dashboard access."""

import pytest


async def _admin_token(client) -> str:
    response = await client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin123"}
    )
    return response.json()["access_token"]


@pytest.mark.integration
class TestAdminUsers:
    async def test_admin_can_create_update_disable_and_reset_user(self, client, db_clean):
        headers = {"Authorization": f"Bearer {await _admin_token(client)}"}
        created = await client.post(
            "/api/admin/users",
            headers=headers,
            json={
                "username": "alice",
                "displayName": "Alice",
                "password": "initial-password",
                "dashboardPermissions": ["rty"],
            },
        )
        assert created.status_code == 201
        assert created.json()["dashboardPermissions"] == ["rty"]
        stored = await db_clean.users.find_one({"username": "alice"})
        assert stored["passwordHash"].startswith("$argon2id$")
        assert "password" not in stored

        duplicate = await client.post(
            "/api/admin/users",
            headers=headers,
            json={"username": "alice", "displayName": "Other", "password": "password-2"},
        )
        assert duplicate.status_code == 409

        updated = await client.patch(
            "/api/admin/users/alice",
            headers=headers,
            json={"displayName": "Alice Updated", "dashboardPermissions": ["mfr"]},
        )
        assert updated.status_code == 200
        assert updated.json()["displayName"] == "Alice Updated"
        assert updated.json()["dashboardPermissions"] == ["mfr"]

        reset = await client.post(
            "/api/admin/users/alice/reset-password",
            headers=headers,
            json={"password": "replacement-password"},
        )
        assert reset.status_code == 200
        login = await client.post(
            "/api/auth/login", json={"username": "alice", "password": "replacement-password"}
        )
        assert login.status_code == 200
        alice_refresh_token = login.json()["refresh_token"]

        disabled = await client.patch(
            "/api/admin/users/alice",
            headers=headers,
            json={"isActive": False},
        )
        assert disabled.status_code == 200
        assert (
            await client.post(
                "/api/auth/login", json={"username": "alice", "password": "replacement-password"}
            )
        ).status_code == 403
        assert (
            await client.post(
                "/api/auth/refresh", json={"refresh_token": alice_refresh_token}
            )
        ).status_code == 401

    async def test_dashboard_permissions_are_scoped_to_each_dashboard(
        self, client, monkeypatch
    ):
        from app.api import rty

        admin_headers = {"Authorization": f"Bearer {await _admin_token(client)}"}
        created = await client.post(
            "/api/admin/users",
            headers=admin_headers,
            json={
                "username": "station-only",
                "displayName": "Station Only",
                "password": "initial-password",
                "dashboardPermissions": ["station-pass-rate"],
            },
        )
        assert created.status_code == 201
        login = await client.post(
            "/api/auth/login", json={"username": "station-only", "password": "initial-password"}
        )
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        async def station_rates(*_args, **_kwargs):
            return []

        monkeypatch.setattr(rty.rty_gateway, "station_rates", station_rates)
        assert (await client.get("/api/rty/station-pass-rates", headers=headers)).status_code == 200
        assert (await client.get("/api/rty/list", headers=headers)).status_code == 403

    async def test_non_admin_cannot_manage_users_or_unpermitted_dashboard(self, client):
        admin_headers = {"Authorization": f"Bearer {await _admin_token(client)}"}
        created = await client.post(
            "/api/admin/users",
            headers=admin_headers,
            json={
                "username": "limited",
                "displayName": "Limited",
                "password": "initial-password",
                "dashboardPermissions": [],
            },
        )
        assert created.status_code == 201
        login = await client.post(
            "/api/auth/login", json={"username": "limited", "password": "initial-password"}
        )
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        assert (await client.get("/api/admin/users", headers=headers)).status_code == 403
        assert (await client.get("/api/doa/options", headers=headers)).status_code == 403

    async def test_admin_account_cannot_be_managed(self, client):
        headers = {"Authorization": f"Bearer {await _admin_token(client)}"}
        response = await client.patch(
            "/api/admin/users/admin", headers=headers, json={"displayName": "Changed"}
        )
        assert response.status_code == 403
