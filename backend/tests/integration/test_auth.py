"""
Integration tests for Auth API endpoints
"""
import pytest


@pytest.mark.integration
class TestOACallbackEndpoint:
    """Tests for POST /api/auth/oa/callback"""

    async def test_valid_callback_returns_tokens(self, client, valid_jwt):
        """Success OA callback should return tokens and user info."""
        response = await client.post(
            "/api/auth/oa/callback",
            json={"status": "success", "payload": valid_jwt, "next": "http://localhost:3000"},
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

    async def test_me_returns_user_from_db(self, client, make_test_access_token, mock_db):
        """GET /auth/me with a valid token returns the user's profile from DB."""
        from tests.conftest import _make_jwt

        # Create user first via OA callback
        jwt = _make_jwt({"itcode": "alice", "name": "Alice"}, "bc3868bfa47ef87440a9e874afaad77c706c6229d08e5bb74f51ab726d072fc4")
        await client.post("/api/auth/oa/callback", json={"status": "success", "payload": jwt, "next": None})

        # Now call /auth/me with the session token
        user = await mock_db.users.find_one({"itcode": "alice"})
        session = await mock_db.sessions.find_one({"itcode": "alice"})
        response = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {session['accessToken']}"})

        assert response.status_code == 200
        assert response.json()["itcode"] == "alice"
        assert response.json()["user"]["name"] == "Alice"


@pytest.mark.integration
class TestLogoutEndpoint:
    """Tests for POST /api/auth/logout"""

    async def test_logout_returns_ok(self, client):
        """Logout should return ok even without a valid token."""
        response = await client.post("/api/auth/logout")
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True

    async def test_logout_revokes_session(self, client, make_test_access_token, mock_db):
        """Logout should delete the session from DB."""
        from tests.conftest import _make_jwt

        # Create user + session via OA callback
        jwt = _make_jwt({"itcode": "logout_user", "name": "Logout Test"}, "bc3868bfa47ef87440a9e874afaad77c706c6229d08e5bb74f51ab726d072fc4")
        callback_resp = await client.post(
            "/api/auth/oa/callback",
            json={"status": "success", "payload": jwt, "next": None},
        )
        assert callback_resp.status_code == 200
        session_token = callback_resp.json()["access_token"]

        # Verify session exists
        session = await mock_db.sessions.find_one({"itcode": "logout_user"})
        assert session is not None
        assert session["accessToken"] == session_token

        # Logout
        response = await client.post("/api/auth/logout", headers={"Authorization": f"Bearer {session_token}"})
        assert response.status_code == 200

        # Session should be deleted
        session = await mock_db.sessions.find_one({"itcode": "logout_user"})
        assert session is None