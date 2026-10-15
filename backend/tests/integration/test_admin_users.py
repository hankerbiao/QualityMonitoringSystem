"""Integration tests for administrator user management and dashboard access."""

import pytest

from app.auth_permissions import ALL_DASHBOARD_PERMISSIONS


async def _admin_token(client) -> str:
    response = await client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin123"}
    )
    return response.json()["access_token"]


async def _create_user(client, headers, username="alice"):
    response = await client.post(
        "/api/admin/users",
        headers=headers,
        json={
            "username": username,
            "displayName": username.title(),
            "password": "initial-password",
            "dashboardPermissions": ["rty"],
        },
    )
    assert response.status_code == 201
    return response.json()


async def _user_headers(client, username="alice"):
    response = await client.post(
        "/api/auth/login", json={"username": username, "password": "initial-password"}
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.mark.integration
class TestAdminUsers:
    async def test_user_list_includes_admins_and_legacy_accounts(self, client, db_clean):
        headers = {"Authorization": f"Bearer {await _admin_token(client)}"}
        await db_clean.users.insert_many(
            [
                {
                    "username": "legacy-user",
                    "itcode": "legacy-user",
                    "profile": {"name": "Legacy User"},
                    "createdAt": "2026-01-01T00:00:00+00:00",
                },
                {
                    "username": "legacy-admin",
                    "itcode": "legacy-admin",
                    "profile": {"name": "Legacy Admin", "role": "admin"},
                    "createdAt": "2026-01-02T00:00:00+00:00",
                },
            ]
        )

        response = await client.get("/api/admin/users", headers=headers)

        assert response.status_code == 200
        users = {user["username"]: user for user in response.json()}
        assert set(users) == {"admin", "legacy-admin", "legacy-user"}
        assert users["admin"]["isProtected"] is True
        assert users["legacy-admin"]["role"] == "admin"
        assert users["legacy-admin"]["isProtected"] is False

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
            json={
                "displayName": "Alice Updated",
                "dashboardPermissions": ["mfr"],
                "password": "updated-password",
            },
        )
        assert updated.status_code == 200
        assert updated.json()["displayName"] == "Alice Updated"
        assert updated.json()["dashboardPermissions"] == ["mfr"]
        assert (
            await client.post(
                "/api/auth/login", json={"username": "alice", "password": "updated-password"}
            )
        ).status_code == 200

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
            await client.post("/api/auth/refresh", json={"refresh_token": alice_refresh_token})
        ).status_code == 401

        deleted = await client.delete("/api/admin/users/alice", headers=headers)
        assert deleted.status_code == 204
        stored = await db_clean.users.find_one({"username": "alice"})
        assert stored["deletedAt"]
        assert stored["isActive"] is False
        assert "alice" not in [
            user["username"]
            for user in (await client.get("/api/admin/users", headers=headers)).json()
        ]
        assert (
            await client.post(
                "/api/auth/login", json={"username": "alice", "password": "replacement-password"}
            )
        ).status_code == 403

        recreated = await client.post(
            "/api/admin/users",
            headers=headers,
            json={
                "username": "alice",
                "displayName": "Alice Recreated",
                "password": "recreated-password",
                "dashboardPermissions": ["doa"],
            },
        )
        assert recreated.status_code == 201
        assert recreated.json()["displayName"] == "Alice Recreated"
        assert recreated.json()["dashboardPermissions"] == ["doa"]
        stored = await db_clean.users.find_one({"username": "alice"})
        assert stored["isActive"] is True
        assert stored["deletedAt"] is None
        assert (
            await client.post(
                "/api/auth/login", json={"username": "alice", "password": "recreated-password"}
            )
        ).status_code == 200

    async def test_dashboard_permissions_are_scoped_to_each_dashboard(self, client, monkeypatch):
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

    async def test_role_changes_apply_to_existing_tokens_and_restore_permissions(
        self, client, db_clean, monkeypatch
    ):
        from unittest.mock import Mock

        from app.api import admin_users

        audit = Mock()
        monkeypatch.setattr(admin_users, "get_audit_logger", lambda: audit)
        admin_headers = {"Authorization": f"Bearer {await _admin_token(client)}"}
        await _create_user(client, admin_headers)
        alice_headers = await _user_headers(client)
        shared = await client.get("/api/settings", headers=alice_headers)
        assert shared.status_code == 200
        assert set(shared.json()["data"]) == {"modelTargets", "emailAlert"}

        promoted = await client.patch(
            "/api/admin/users/alice", headers=admin_headers, json={"role": "admin"}
        )
        assert promoted.status_code == 200
        assert promoted.json()["role"] == "admin"
        assert promoted.json()["isProtected"] is False
        assert promoted.json()["dashboardPermissions"] == list(ALL_DASHBOARD_PERMISSIONS)
        stored = await db_clean.users.find_one({"username": "alice"})
        assert stored["role"] == stored["profile"]["role"] == "admin"
        assert stored["dashboardPermissions"] == ["rty"]
        assert stored["profile"]["dashboardPermissions"] == ["rty"]
        audit.log.assert_called_once_with(
            action="CHANGE_USER_ROLE",
            resource="User:alice",
            user_id="admin",
            method="PATCH",
            details="role: user -> admin",
        )

        for path in ("/api/settings", "/api/admin/users", "/api/operations/dashboard"):
            assert (await client.get(path, headers=alice_headers)).status_code == 200
        profile = (await client.get("/api/auth/me", headers=alice_headers)).json()["user"]
        assert profile["role"] == "admin"
        assert profile["dashboardPermissions"] == list(ALL_DASHBOARD_PERMISSIONS)
        login = await client.post(
            "/api/auth/login", json={"username": "alice", "password": "initial-password"}
        )
        assert login.json()["user"]["role"] == "admin"

        demoted = await client.patch(
            "/api/admin/users/alice", headers=admin_headers, json={"role": "user"}
        )
        assert demoted.status_code == 200
        assert demoted.json()["dashboardPermissions"] == ["rty"]
        stored = await db_clean.users.find_one({"username": "alice"})
        assert stored["role"] == stored["profile"]["role"] == "user"
        for path in ("/api/admin/users", "/api/operations/dashboard"):
            assert (await client.get(path, headers=alice_headers)).status_code == 403
        shared = await client.get("/api/settings", headers=alice_headers)
        assert shared.status_code == 200
        assert set(shared.json()["data"]) == {"modelTargets", "emailAlert"}
        assert (
            await client.patch(
                "/api/admin/users/alice", headers=alice_headers, json={"role": "admin"}
            )
        ).status_code == 403
        profile = (await client.get("/api/auth/me", headers=alice_headers)).json()["user"]
        assert profile["role"] == "user"
        assert profile["dashboardPermissions"] == ["rty"]

    async def test_additional_admin_can_create_and_promote_other_users(self, client):
        admin_headers = {"Authorization": f"Bearer {await _admin_token(client)}"}
        await _create_user(client, admin_headers)
        await client.patch("/api/admin/users/alice", headers=admin_headers, json={"role": "admin"})
        alice_headers = await _user_headers(client)
        await _create_user(client, alice_headers, username="bob")
        promoted = await client.patch(
            "/api/admin/users/bob", headers=alice_headers, json={"role": "admin"}
        )
        assert promoted.status_code == 200
        assert promoted.json()["role"] == "admin"
        demoted = await client.patch(
            "/api/admin/users/bob", headers=alice_headers, json={"role": "user"}
        )
        assert demoted.status_code == 200

    @pytest.mark.parametrize("role", ["owner", "superadmin", "", 1])
    async def test_invalid_roles_are_rejected(self, client, db_clean, role):
        headers = {"Authorization": f"Bearer {await _admin_token(client)}"}
        await _create_user(client, headers)
        response = await client.patch(
            "/api/admin/users/alice", headers=headers, json={"role": role}
        )
        assert response.status_code == 422
        stored = await db_clean.users.find_one({"username": "alice"})
        assert stored["role"] == "user"

    @pytest.mark.parametrize(
        ("method", "suffix", "payload"),
        [
            ("patch", "", {"role": "user"}),
            ("patch", "", {"isActive": False}),
            ("patch", "", {"displayName": "Changed"}),
            ("patch", "", {"password": "replacement-password"}),
            ("delete", "", None),
            ("post", "/reset-password", {"password": "replacement-password"}),
        ],
    )
    async def test_additional_admin_cannot_modify_builtin_admin(
        self, client, db_clean, method, suffix, payload
    ):
        admin_headers = {"Authorization": f"Bearer {await _admin_token(client)}"}
        await _create_user(client, admin_headers)
        await client.patch("/api/admin/users/alice", headers=admin_headers, json={"role": "admin"})
        alice_headers = await _user_headers(client)
        kwargs = {"headers": alice_headers}
        if payload is not None:
            kwargs["json"] = payload
        response = await client.request(method, f"/api/admin/users/admin{suffix}", **kwargs)
        assert response.status_code == 403
        stored = await db_clean.users.find_one({"username": "admin"})
        assert stored["role"] == "admin"
        assert stored["isActive"] is True
        assert not stored.get("deletedAt")

    @pytest.mark.parametrize(
        ("method", "payload"),
        [
            ("patch", {"role": "user"}),
            ("patch", {"isActive": False}),
            ("delete", None),
        ],
    )
    async def test_admin_cannot_demote_disable_or_delete_self(
        self, client, db_clean, method, payload
    ):
        admin_headers = {"Authorization": f"Bearer {await _admin_token(client)}"}
        await _create_user(client, admin_headers)
        await client.patch("/api/admin/users/alice", headers=admin_headers, json={"role": "admin"})
        alice_headers = await _user_headers(client)
        kwargs = {"headers": alice_headers}
        if payload is not None:
            kwargs["json"] = payload
        response = await client.request(method, "/api/admin/users/alice", **kwargs)
        assert response.status_code == 403
        stored = await db_clean.users.find_one({"username": "alice"})
        assert stored["role"] == "admin"
        assert stored["isActive"] is True
        assert not stored.get("deletedAt")

    async def test_admin_can_manage_additional_admin_account(self, client):
        headers = {"Authorization": f"Bearer {await _admin_token(client)}"}
        await _create_user(client, headers)
        await client.patch("/api/admin/users/alice", headers=headers, json={"role": "admin"})
        updated = await client.patch(
            "/api/admin/users/alice", headers=headers, json={"displayName": "Alice Updated"}
        )
        assert updated.status_code == 200
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
        alice_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        disabled = await client.patch(
            "/api/admin/users/alice", headers=headers, json={"isActive": False}
        )
        assert disabled.status_code == 200
        assert (await client.get("/api/settings", headers=alice_headers)).status_code == 403
        enabled = await client.patch(
            "/api/admin/users/alice", headers=headers, json={"isActive": True}
        )
        assert enabled.status_code == 200
        assert (await client.get("/api/settings", headers=alice_headers)).status_code == 200
        deleted = await client.delete("/api/admin/users/alice", headers=headers)
        assert deleted.status_code == 204
        users = (await client.get("/api/admin/users", headers=headers)).json()
        assert "alice" not in {user["username"] for user in users}
