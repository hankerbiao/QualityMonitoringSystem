"""
Unit tests for AuthService - JWT handling, OA callback, session management
"""
import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.auth_service import AuthService

# ─── JWT Sign/Verify Helpers ─────────────────────────────────────────────────

SECRET = "bc3868bfa47ef87440a9e874afaad77c706c6229d08e5bb74f51ab726d072fc4"


def _make_jwt(payload: dict, secret: str = SECRET) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=1)
    full = {**payload, "exp": int(exp.timestamp()), "iat": int(now.timestamp())}
    header_b64 = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    payload_b64 = base64.urlsafe_b64encode(json.dumps(full, ensure_ascii=False).encode()).rstrip(b"=").decode()
    sig = hmac.new(secret.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{header_b64}.{payload_b64}.{sig_b64}"


# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def auth_service(_mock_db, _mock_settings, monkeypatch):
    from app.core import config as config_module
    monkeypatch.setattr(config_module, "get_settings", lambda: _mock_settings)
    from app import auth_service as auth_svc_module
    monkeypatch.setattr(auth_svc_module, "get_settings", lambda: _mock_settings)
    yield AuthService(_mock_db)


# ─── JWT Decoding Tests ──────────────────────────────────────────────────────

class TestJWTSignature:
    """Tests for JWT signature verification."""

    def test_valid_jwt_is_decoded(self, auth_service):
        token = _make_jwt({"itcode": "alice"})
        result = auth_service._decode_and_verify_jwt(token, SECRET)
        assert result["itcode"] == "alice"

    def test_wrong_secret_raises(self, auth_service):
        token = _make_jwt({"itcode": "alice"}, secret="wrong-secret")
        with pytest.raises(Exception) as exc_info:
            auth_service._decode_and_verify_jwt(token, SECRET)
        assert "signature" in str(exc_info.value).lower()

    def test_malformed_token_raises(self, auth_service):
        with pytest.raises(Exception) as exc_info:
            auth_service._decode_and_verify_jwt("not.a.jwt", SECRET)
        err = str(exc_info.value).lower()
        assert "format" in err or "signature" in err

    def test_tampered_signature_raises(self, auth_service):
        token = _make_jwt({"itcode": "alice"}, secret=SECRET)
        parts = token.split(".")
        parts[-1] = "X" * len(parts[-1])
        tampered = ".".join(parts)
        with pytest.raises(Exception) as exc_info:
            auth_service._decode_and_verify_jwt(tampered, SECRET)
        assert "signature" in str(exc_info.value).lower()


class TestJWTExpiration:
    """Tests for token expiration checking."""

    def test_expired_token_raises(self, auth_service):
        """Token with past exp claim should be rejected."""
        now = datetime.now(timezone.utc)
        past = now - timedelta(hours=2)
        payload = {"itcode": "alice", "exp": int(past.timestamp()), "iat": int(past.timestamp())}
        header_b64 = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
        payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
        sig = hmac.new(SECRET.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256).digest()
        sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
        token = f"{header_b64}.{payload_b64}.{sig_b64}"

        with pytest.raises(Exception) as exc_info:
            auth_service._decode_and_verify_jwt(token, SECRET)
        assert "expired" in str(exc_info.value).lower()

    def test_missing_exp_raises(self, auth_service):
        now = datetime.now(timezone.utc)
        payload = {"itcode": "alice", "iat": int(now.timestamp())}
        header_b64 = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
        payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
        sig = hmac.new(SECRET.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256).digest()
        sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
        token = f"{header_b64}.{payload_b64}.{sig_b64}"

        with pytest.raises(Exception) as exc_info:
            auth_service._decode_and_verify_jwt(token, SECRET)
        assert "exp" in str(exc_info.value).lower()


# ─── Local Login Tests ──────────────────────────────────────────────────────

@pytest.mark.asyncio
class TestLocalLogin:
    """Tests for local username/password authentication."""

    async def test_default_admin_creates_user_and_session(self, auth_service, _mock_db):
        result = await auth_service.authenticate_local("admin", "admin123")

        assert result["ok"] is True
        assert result["user"]["itcode"] == "admin"
        assert "access_token" in result
        assert "refresh_token" in result

        user = await _mock_db.users.find_one({"itcode": "admin"})
        assert user["profile"]["auth_type"] == "local"
        assert "password" not in user["profile"]

        session = await _mock_db.sessions.find_one({"itcode": "admin"})
        assert session is not None

    async def test_wrong_password_does_not_create_session(self, auth_service, _mock_db):
        session_count = await _mock_db.sessions.count_documents({})

        with pytest.raises(Exception) as exc_info:
            await auth_service.authenticate_local("admin", "wrong-password")

        assert "401" in str(exc_info.value)
        assert await _mock_db.sessions.count_documents({}) == session_count


# ─── OA Callback Tests ───────────────────────────────────────────────────────

@pytest.mark.asyncio
class TestOACallback:
    """Tests for OA login callback handling."""

    async def test_success_callback_creates_user_and_session(self, auth_service, _mock_db):
        token = _make_jwt({"itcode": "newuser", "name": "New User"})
        result = await auth_service.handle_oa_callback("success", token, "http://localhost:3000")

        assert result["ok"] is True
        assert result["user"]["itcode"] == "newuser"
        assert "access_token" in result
        assert "refresh_token" in result

        user = await _mock_db.users.find_one({"itcode": "newuser"})
        assert user is not None
        assert user["profile"]["itcode"] == "newuser"
        assert user["profile"]["name"] == "New User"

        session = await _mock_db.sessions.find_one({"itcode": "newuser"})
        assert session is not None
        assert "accessToken" in session
        assert "refreshToken" in session

    async def test_failed_status_raises(self, auth_service):
        token = _make_jwt({"itcode": "alice"})
        with pytest.raises(Exception) as exc_info:
            await auth_service.handle_oa_callback("fail", token, None)
        assert "failed" in str(exc_info.value).lower()

    async def test_token_without_itcode_raises(self, auth_service):
        token = _make_jwt({"name": "No Itcode"})
        with pytest.raises(Exception) as exc_info:
            await auth_service.handle_oa_callback("success", token, None)
        assert "itcode" in str(exc_info.value).lower()

    async def test_callback_updates_existing_user(self, auth_service, _mock_db):
        """Second login for same itcode should update profile, not duplicate."""
        token1 = _make_jwt({"itcode": "alice", "name": "Alice V1"})
        token2 = _make_jwt({"itcode": "alice", "name": "Alice V2"})

        await auth_service.handle_oa_callback("success", token1, None)
        await auth_service.handle_oa_callback("success", token2, None)

        users = await _mock_db.users.find_one({"itcode": "alice"})
        assert users is not None
        assert users["profile"]["name"] == "Alice V2"


# ─── Session Management Tests ────────────────────────────────────────────────

@pytest.mark.asyncio
class TestRequireLogin:
    """Tests for session validation in require_login."""

    async def test_valid_access_token_returns_user(self, auth_service, _mock_db):
        token = _make_jwt({"itcode": "bob"})
        await auth_service.handle_oa_callback("success", token, None)

        session = await _mock_db.sessions.find_one({"itcode": "bob"})
        access_token = session["accessToken"]

        result = await auth_service.require_login(access_token)

        assert result["itcode"] == "bob"
        assert "user" in result

    async def test_missing_token_raises_401(self, auth_service):
        with pytest.raises(Exception) as exc_info:
            await auth_service.require_login(None)
        assert "401" in str(exc_info.value)

    async def test_invalid_token_raises_401(self, auth_service):
        with pytest.raises(Exception) as exc_info:
            await auth_service.require_login("not-a-real-token")
        assert "401" in str(exc_info.value)

    async def test_revoked_session_cannot_be_used_via_refresh_token(self, auth_service, _mock_db):
        """Revoking session invalidates the refresh token (not access token, which is stateless JWT)."""
        token = _make_jwt({"itcode": "charlie"})
        result = await auth_service.handle_oa_callback("success", token, None)
        refresh_token = result["refresh_token"]

        session = await _mock_db.sessions.find_one({"itcode": "charlie"})
        await auth_service.revoke_session(session["sessionId"])

        # Refresh token should now be invalid
        with pytest.raises(Exception) as exc_info:
            await auth_service.refresh_access_token(refresh_token)
        assert "401" in str(exc_info.value)
