"""Unit tests for local password authentication and session access."""

import pytest
from fastapi import HTTPException

from app.auth_permissions import ALL_DASHBOARD_PERMISSIONS


@pytest.fixture
def auth_service(_mock_db):
    from app.auth_service import AuthService

    return AuthService(_mock_db)


@pytest.mark.asyncio
class TestLocalAuthentication:
    async def test_default_admin_creates_hashed_user_and_session(self, auth_service, _mock_db):
        result = await auth_service.authenticate_local("admin", "admin123")

        assert result["ok"] is True
        assert result["user"]["role"] == "admin"
        user = await _mock_db.users.find_one({"username": "admin"})
        assert user["passwordHash"].startswith("$argon2id$")
        assert "password" not in user
        assert user["dashboardPermissions"] == list(ALL_DASHBOARD_PERMISSIONS)

    async def test_wrong_password_does_not_create_session(self, auth_service, _mock_db):
        session_count = await _mock_db.sessions.count_documents({})
        with pytest.raises(HTTPException) as exc_info:
            await auth_service.authenticate_local("admin", "wrong-password")
        assert exc_info.value.status_code == 401
        assert await _mock_db.sessions.count_documents({}) == session_count

    async def test_created_user_can_login(self, auth_service, _mock_db):
        password_hash = auth_service.hash_password("user-password")
        await _mock_db.users.insert_one(
            {
                "username": "alice",
                "itcode": "alice",
                "displayName": "Alice",
                "role": "user",
                "isActive": True,
                "dashboardPermissions": ["rty"],
                "passwordHash": password_hash,
                "profile": {"name": "Alice", "role": "user"},
            }
        )

        result = await auth_service.authenticate_local("alice", "user-password")
        assert result["user"]["name"] == "Alice"
        assert result["user"]["dashboardPermissions"] == ["rty"]

    async def test_disabled_user_cannot_login(self, auth_service, _mock_db):
        await _mock_db.users.insert_one(
            {
                "username": "disabled",
                "role": "user",
                "isActive": False,
                "passwordHash": auth_service.hash_password("user-password"),
                "profile": {"name": "Disabled", "role": "user"},
            }
        )
        with pytest.raises(HTTPException) as exc_info:
            await auth_service.authenticate_local("disabled", "user-password")
        assert exc_info.value.status_code == 403

    async def test_disabled_user_access_token_is_rejected(self, auth_service, _mock_db):
        await _mock_db.users.insert_one(
            {
                "username": "alice",
                "role": "user",
                "isActive": True,
                "passwordHash": auth_service.hash_password("user-password"),
            }
        )
        result = await auth_service.authenticate_local("alice", "user-password")
        await _mock_db.users.update_one({"username": "alice"}, {"$set": {"isActive": False}})

        with pytest.raises(HTTPException) as exc_info:
            await auth_service.require_login(result["access_token"])
        assert exc_info.value.status_code == 403
