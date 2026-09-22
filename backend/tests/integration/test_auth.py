"""Integration tests for the local authentication API."""

import pytest


@pytest.mark.integration
class TestLocalLoginEndpoint:
    async def test_default_credentials_return_tokens(self, client):
        response = await client.post(
            "/api/auth/login", json={"username": "admin", "password": "admin123"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["user"]["role"] == "admin"
        assert data["user"]["isActive"] is True
        assert "rty" in data["user"]["dashboardPermissions"]

        me_response = await client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {data['access_token']}"}
        )
        assert me_response.status_code == 200
        assert me_response.json()["role"] == "admin"

    async def test_invalid_credentials_return_401(self, client):
        response = await client.post(
            "/api/auth/login", json={"username": "admin", "password": "wrong-password"}
        )
        assert response.status_code == 401

    async def test_retired_oa_routes_are_removed(self, client):
        assert (await client.post("/api/auth/oa/callback", json={})).status_code == 404
        assert (await client.get("/api/auth/oa/callback")).status_code == 404


@pytest.mark.integration
class TestAuthMeEndpoint:
    async def test_missing_token_returns_401(self, client):
        assert (await client.get("/api/auth/me")).status_code == 401

    async def test_invalid_token_returns_401(self, client):
        response = await client.get(
            "/api/auth/me", headers={"Authorization": "Bearer invalid-token"}
        )
        assert response.status_code == 401

    async def test_disabled_user_token_returns_403(self, client, db_clean, make_test_access_token):
        await db_clean.users.insert_one(
            {
                "username": "disabled",
                "role": "user",
                "isActive": False,
                "profile": {"name": "Disabled", "role": "user"},
            }
        )
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {make_test_access_token('disabled')}"},
        )
        assert response.status_code == 403


@pytest.mark.integration
class TestLogoutEndpoint:
    async def test_logout_revokes_refresh_token(self, client):
        login = await client.post(
            "/api/auth/login", json={"username": "admin", "password": "admin123"}
        )
        data = login.json()
        logout = await client.post(
            "/api/auth/logout", headers={"Authorization": f"Bearer {data['access_token']}"}
        )
        assert logout.status_code == 200
        refresh = await client.post(
            "/api/auth/refresh", json={"refresh_token": data["refresh_token"]}
        )
        assert refresh.status_code == 401
