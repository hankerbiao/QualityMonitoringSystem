"""
Integration tests for Auth API endpoints
"""
import pytest


@pytest.mark.integration
class TestLocalLoginEndpoint:
    """Tests for POST /api/auth/login."""

    async def test_default_credentials_return_tokens(self, client):
        response = await client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "admin123"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        assert data["user"]["itcode"] == "admin"
        assert data["user"]["role"] == "admin"
        assert "access_token" in data
        assert "refresh_token" in data

        me_response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {data['access_token']}"},
        )
        assert me_response.status_code == 200
        assert me_response.json()["user"]["auth_type"] == "local"

    async def test_invalid_credentials_return_401(self, client):
        response = await client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "wrong-password"},
        )

        assert response.status_code == 401


@pytest.mark.integration
class TestOACallbackEndpoint:
    """Tests for POST /api/auth/oa/callback"""

    async def test_valid_callback_returns_tokens(self, client, valid_jwt):
        """Success OA callback should return tokens and user info."""
        response = await client.post(
            "/api/auth/oa/callback",
            json={"status": "success", "payload": valid_jwt, "next": "http://localhost:4000"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        assert "user" in data
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["user"]["itcode"] == "testuser"

    async def test_failed_status_returns_400(self, client, valid_jwt):
        """status != 'success' should return 400."""
        response = await client.post(
            "/api/auth/oa/callback",
            json={"status": "failed", "payload": valid_jwt, "next": None},
        )
        assert response.status_code == 400

    async def test_missing_itcode_returns_400(self, client, valid_jwt_no_itcode):
        """JWT without itcode should return 400."""
        response = await client.post(
            "/api/auth/oa/callback",
            json={"status": "success", "payload": valid_jwt_no_itcode, "next": None},
        )
        assert response.status_code == 400

    async def test_expired_token_returns_400(self, client, expired_jwt):
        """Expired OA token should return 400."""
        response = await client.post(
            "/api/auth/oa/callback",
            json={"status": "success", "payload": expired_jwt, "next": None},
        )
        assert response.status_code == 400

    async def test_invalid_jwt_format_returns_400(self, client):
        """Malformed JWT should return 400."""
        response = await client.post(
            "/api/auth/oa/callback",
            json={"status": "success", "payload": "not.valid.jwt", "next": None},
        )
        assert response.status_code == 400


@pytest.mark.integration
class TestOAGETCallbackEndpoint:
    async def test_get_callback_preserves_redirect_tokens_and_http_only_cookies(
        self, client, valid_jwt
    ):
        response = await client.get(
            "/api/auth/oa/callback",
            params={
                "status": "success",
                "payload": valid_jwt,
                "next": "http://localhost:4000",
            },
            follow_redirects=False,
        )

        assert response.status_code == 302
        location = response.headers["location"]
        assert "access_token=" in location
        assert "refresh_token=" in location
        cookies = response.headers.get_list("set-cookie")
        assert any("qms_access_token=" in value and "HttpOnly" in value for value in cookies)
        assert any("qms_refresh_token=" in value and "HttpOnly" in value for value in cookies)


@pytest.mark.integration
class TestAuthMeEndpoint:
    """Tests for GET /api/auth/me"""

    async def test_missing_token_returns_401(self, client):
        """No Authorization header should return 401."""
        response = await client.get("/api/auth/me")
        assert response.status_code == 401

    async def test_invalid_token_returns_401(self, client):
        """Invalid token should return 401."""
        response = await client.get("/api/auth/me", headers={"Authorization": "Bearer invalid-token"})
        assert response.status_code == 401

    async def test_valid_token_returns_user(self, client, make_test_access_token):
        """Valid access token should return user info."""
        token = make_test_access_token("alice")

        response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        data = response.json()
        assert data["itcode"] == "alice"

    async def test_callback_then_me_returns_user_profile(self, client):
        """After OA callback, /auth/me with the session token should return profile."""
        from tests.conftest import _make_jwt

        jwt = _make_jwt({"itcode": "alice", "name": "Alice"}, "test-oa-jwt-secret-key-for-testing-only")
        callback_resp = await client.post(
            "/api/auth/oa/callback",
            json={"status": "success", "payload": jwt, "next": None},
        )
        assert callback_resp.status_code == 200
        session_token = callback_resp.json()["access_token"]

        me_resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {session_token}"})
        assert me_resp.status_code == 200
        assert me_resp.json()["itcode"] == "alice"
        assert me_resp.json()["user"]["name"] == "Alice"


@pytest.mark.integration
class TestLogoutEndpoint:
    """Tests for POST /api/auth/logout"""

    async def test_logout_returns_ok(self, client):
        """Logout should return ok even without a valid token."""
        response = await client.post("/api/auth/logout")
        assert response.status_code == 200
        assert response.json()["ok"] is True

    async def test_logout_revokes_refresh_token(self, client):
        """Logout should delete the session, invalidating the refresh token."""
        from tests.conftest import _make_jwt

        jwt = _make_jwt({"itcode": "logout_user", "name": "Logout Test"}, "test-oa-jwt-secret-key-for-testing-only")
        callback_resp = await client.post(
            "/api/auth/oa/callback",
            json={"status": "success", "payload": jwt, "next": None},
        )
        assert callback_resp.status_code == 200
        refresh_token = callback_resp.json()["refresh_token"]

        logout_resp = await client.post("/api/auth/logout", headers={"Authorization": f"Bearer {callback_resp.json()['access_token']}"})
        assert logout_resp.status_code == 200

        # Refresh should now fail - session is deleted
        refresh_resp = await client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
        assert refresh_resp.status_code == 401
