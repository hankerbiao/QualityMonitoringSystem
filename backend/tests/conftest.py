"""
Pytest configuration and shared fixtures.

All async work happens inside async test functions using `await`.  Fixtures are
pure sync and return plain Python objects.  This avoids pytest-asyncio's
fixture event-loop scoping issues entirely.
"""
import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import pytest

from tests.mock_motor import MockMotorClient


def _make_access_token(itcode: str, secret: str, minutes: int = 15) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=minutes)
    payload = {"sub": itcode, "type": "access", "iat": int(now.timestamp()), "exp": int(exp.timestamp())}
    h_b64 = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    p_b64 = base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False).encode()).rstrip(b"=").decode()
    sig = hmac.new(secret.encode(), f"{h_b64}.{p_b64}".encode(), hashlib.sha256).digest()
    s_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{h_b64}.{p_b64}.{s_b64}"


# ─── Session-scoped settings ─────────────────────────────────────────────────

@pytest.fixture(scope="session")
def _mock_settings():
    from app.core.config import Settings
    return Settings(
        DEBUG=True,
        MONGODB_URL="mongodb://localhost:27017",
        MONGODB_DB_NAME="test_quality_monitoring",
        PROCESS_RECORD_CREDENTIAL_KEY="-Y1CqTw8-WDwRbbkyZ8wAEZbs4uT29bW-U7zQZd4eG4=",
        DEFAULT_ADMIN_USERNAME="admin",
        DEFAULT_ADMIN_PASSWORD="admin123",
        SESSION_EXPIRE_DAYS=30,
        ACCESS_TOKEN_EXPIRE_MINUTES=15,
        REFRESH_TOKEN_EXPIRE_DAYS=30,
        JWT_SECRET="test-jwt-secret-key-for-testing-only",
        ALERT_TOKEN_SECRET="test-alert-token-secret-key-for-testing-only",
        LOG_DIR="logs",
        LOG_LEVEL="INFO",
        LOG_ROTATION="500 MB",
        LOG_RETENTION="30 days",
        LOG_COMPRESSION="zip",
        LOG_JSON_FORMAT=False,
    )


# Aliases so tests can use either name
mock_settings = _mock_settings


@pytest.fixture(autouse=True)
def disable_data_gateway_for_tests(monkeypatch):
    """Keep the production gateway singleton from leaking into local tests."""
    from app.services import data_gateway_client

    monkeypatch.setattr(data_gateway_client.data_gateway, "base_url", "")


# ─── Session-scoped mock DB ──────────────────────────────────────────────────

@pytest.fixture(scope="session")
def _mock_db(_mock_settings):
    """Session-scoped in-memory mock DB, patched once per session."""
    client = MockMotorClient()
    db = client["test_quality_monitoring"]

    from app.db import mongodb as mongodb_module
    mongodb_module.get_database = lambda: db
    mongodb_module.mongodb.db = db
    mongodb_module.mongodb.client = client

    from app.core import config as config_module
    config_module.get_settings = lambda: _mock_settings

    from app import auth_service as auth_svc_module
    auth_svc_module.get_settings = lambda: _mock_settings

    return db


mock_db = _mock_db


# ─── Per-test DB cleanup ─────────────────────────────────────────────────────

@pytest.fixture
def db_clean(_mock_db):
    """Fixture that provides _mock_db AND clears all collections after each test."""
    yield _mock_db
    # Clear all collections after each test
    for coll in list(_mock_db._collections.values()):
        coll._docs.clear()


# ─── App ─────────────────────────────────────────────────────────────────────

@pytest.fixture
def app():
    """FastAPI app for testing with lifespan disabled."""
    from contextlib import asynccontextmanager

    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    from app.api import admin_users, auth, doa, mfr, operations, rty, settings

    @asynccontextmanager
    async def noop_lifespan(app):
        yield

    test_app = FastAPI(title="QualiBoard API", version="1.0.0", lifespan=noop_lifespan)
    test_app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
    )
    test_app.include_router(rty.router, prefix="/api/rty", tags=["RTY"])
    test_app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
    test_app.include_router(auth.router, prefix="/api", tags=["Auth"])
    test_app.include_router(admin_users.router, prefix="/api", tags=["Admin Users"])
    test_app.include_router(operations.router, prefix="/api/operations", tags=["Operations"])
    test_app.include_router(doa.router, prefix="/api/doa", tags=["DOA"])
    test_app.include_router(mfr.router, prefix="/api/mfr", tags=["MFR"])
    return test_app


# ─── Client (depends on db_clean, shares the same _mock_db) ─────────────────

@pytest.fixture
def client(db_clean, app):
    """Sync fixture: creates AsyncClient using the same db_clean instance."""
    from httpx import ASGITransport, AsyncClient
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture
async def admin_client(db_clean, app):
    """Authenticated client for administrator-only integration tests."""
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        response = await http_client.post(
            "/api/auth/login", json={"username": "admin", "password": "admin123"}
        )
        token = response.json()["access_token"]
        http_client.headers.update({"Authorization": f"Bearer {token}"})
        yield http_client


# ─── Token Factories ─────────────────────────────────────────────────────────

@pytest.fixture
def make_test_access_token(_mock_settings):
    def _make(itcode: str, minutes: int = 15) -> str:
        return _make_access_token(itcode, _mock_settings.JWT_SECRET, minutes)
    return _make
