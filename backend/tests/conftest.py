"""
Pytest configuration and shared fixtures
"""
import pytest
import pytest_asyncio
import base64
import hashlib
import hmac
import json
import asyncio
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager

from tests.mock_motor import MockMotorClient, MockMotorDatabase


def _make_jwt(payload: dict, secret: str) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=1)
    full = {**payload, "exp": int(exp.timestamp()), "iat": int(now.timestamp())}
    h_b64 = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    p_b64 = base64.urlsafe_b64encode(json.dumps(full, ensure_ascii=False).encode()).rstrip(b"=").decode()
    sig = hmac.new(secret.encode(), f"{h_b64}.{p_b64}".encode(), hashlib.sha256).digest()
    s_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{h_b64}.{p_b64}.{s_b64}"


def _make_access_token(itcode: str, secret: str, minutes: int = 15) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=minutes)
    payload = {
        "sub": itcode, "type": "access",
        "iat": int(now.timestamp()), "exp": int(exp.timestamp()),
    }
    h_b64 = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    p_b64 = base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False).encode()).rstrip(b"=").decode()
    sig = hmac.new(secret.encode(), f"{h_b64}.{p_b64}".encode(), hashlib.sha256).digest()
    s_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{h_b64}.{p_b64}.{s_b64}"


# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def mock_settings():
    from app.core.config import Settings
    return Settings(
        DEBUG=True,
        MONGODB_URL="mongodb://localhost:27017",
        MONGODB_DB_NAME="test_quality_monitoring",
        OA_JWT_SECRET="bc3868bfa47ef87440a9e874afaad77c706c6229d08e5bb74f51ab726d072fc4",
        SESSION_EXPIRE_DAYS=30,
        ACCESS_TOKEN_EXPIRE_MINUTES=15,
        REFRESH_TOKEN_EXPIRE_DAYS=30,
        JWT_SECRET="test-jwt-secret-key-for-testing-only",
        LOG_DIR="logs",
        LOG_LEVEL="INFO",
        LOG_ROTATION="500 MB",
        LOG_RETENTION="30 days",
        LOG_COMPRESSION="zip",
        LOG_JSON_FORMAT=False,
    )


@pytest_asyncio.fixture
async def mock_db(mock_settings):
    """In-memory async MongoDB mock, isolated per test."""
    client = MockMotorClient()
    db: MockMotorDatabase = client["test_quality_monitoring"]

    from app.db import mongodb as mongodb_module
    original_get_db = mongodb_module.get_database

    mongodb_module.get_database = lambda: db
    mongodb_module.mongodb.db = db
    mongodb_module.mongodb.client = client

    from app.core import config as config_module
    original_get_settings = config_module.get_settings
    config_module.get_settings = lambda: mock_settings

    yield db

    mongodb_module.get_database = original_get_db
    mongodb_module.mongodb.db = None
    mongodb_module.mongodb.client = None
    config_module.get_settings = original_get_settings


# ─── RTY Test Data ───────────────────────────────────────────────────────────

@pytest.fixture
def sample_rty_data():
    now = datetime.now(tz=timezone.utc)
    return [
        {
            "time": "2026-06-01",
            "model": "普通机型",
            "productModel": "6210 C21",
            "customer": "客户A",
            "base": "天津",
            "defectCount": 10,
            "inputCount": 1000,
            "rtyRate": 99.0,
            "targetRate": 99.0,
            "salesOrder": "SO001",
            "productionOrder": "PO001",
            "productLine": "Line1",
            "orderType": "普通",
            "planStartDate": "2026-06-01",
            "planEndDate": "2026-06-30",
            "status": "已达成",
            "createdAt": now,
            "updatedAt": now,
        },
        {
            "time": "2026-06-02",
            "model": "普通机型",
            "productModel": "6210 C21",
            "customer": "客户A",
            "base": "昆山",
            "defectCount": 15,
            "inputCount": 1000,
            "rtyRate": 98.5,
            "targetRate": 99.0,
            "salesOrder": "SO002",
            "productionOrder": "PO002",
            "productLine": "Line2",
            "orderType": "普通",
            "planStartDate": "2026-06-02",
            "planEndDate": "2026-06-30",
            "status": "未达成",
            "createdAt": now,
            "updatedAt": now,
        },
        {
            "time": "2026-06-03",
            "model": "复合机型",
            "productModel": "6410 X21",
            "customer": "客户B",
            "base": "天津",
            "defectCount": 5,
            "inputCount": 500,
            "rtyRate": 99.0,
            "targetRate": 98.5,
            "salesOrder": "SO003",
            "productionOrder": "PO003",
            "productLine": "Line3",
            "orderType": "复合",
            "planStartDate": "2026-06-03",
            "planEndDate": "2026-06-30",
            "status": "已达成",
            "createdAt": now,
            "updatedAt": now,
        },
    ]


@pytest_asyncio.fixture
async def rty_collection(mock_db, sample_rty_data):
    """Insert sample RTY data and return the collection."""
    await mock_db.rty_data.insert_many(sample_rty_data)
    return mock_db.rty_data


# ─── App + Client ────────────────────────────────────────────────────────────

@pytest.fixture
def app():
    """FastAPI app for testing with lifespan disabled."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from app.api import rty, settings, ai, auth

    @asynccontextmanager
    async def noop_lifespan(app):
        yield

    test_app = FastAPI(
        title="QualiBoard API",
        version="1.0.0",
        lifespan=noop_lifespan,
    )
    test_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    test_app.include_router(rty.router, prefix="/api/rty", tags=["RTY"])
    test_app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
    test_app.include_router(ai.router, prefix="/api/ai", tags=["AI"])
    test_app.include_router(auth.router, prefix="/api", tags=["Auth"])

    return test_app


@pytest_asyncio.fixture
async def client(mock_db, app):
    """Async httpx client wired to the test app with mock DB."""
    from httpx import AsyncClient, ASGITransport

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ─── RTY Client (depends on rty_collection to seed data) ────────────────────

@pytest_asyncio.fixture
async def rty_client(mock_db, app):
    """Async httpx client with RTY test data pre-seeded."""
    now = datetime.now(tz=timezone.utc)
    seed_data = [
        {
            "time": "2026-06-01", "model": "普通机型", "productModel": "6210 C21",
            "customer": "客户A", "base": "天津", "defectCount": 10, "inputCount": 1000,
            "rtyRate": 99.0, "targetRate": 99.0, "salesOrder": "SO001",
            "productionOrder": "PO001", "productLine": "Line1", "orderType": "普通",
            "planStartDate": "2026-06-01", "planEndDate": "2026-06-30", "status": "已达成",
            "createdAt": now, "updatedAt": now,
        },
        {
            "time": "2026-06-02", "model": "普通机型", "productModel": "6210 C21",
            "customer": "客户A", "base": "昆山", "defectCount": 15, "inputCount": 1000,
            "rtyRate": 98.5, "targetRate": 99.0, "salesOrder": "SO002",
            "productionOrder": "PO002", "productLine": "Line2", "orderType": "普通",
            "planStartDate": "2026-06-02", "planEndDate": "2026-06-30", "status": "未达成",
            "createdAt": now, "updatedAt": now,
        },
        {
            "time": "2026-06-03", "model": "复合机型", "productModel": "6410 X21",
            "customer": "客户B", "base": "天津", "defectCount": 5, "inputCount": 500,
            "rtyRate": 99.0, "targetRate": 98.5, "salesOrder": "SO003",
            "productionOrder": "PO003", "productLine": "Line3", "orderType": "复合",
            "planStartDate": "2026-06-03", "planEndDate": "2026-06-30", "status": "已达成",
            "createdAt": now, "updatedAt": now,
        },
    ]
    await mock_db.rty_data.insert_many(seed_data)

    from httpx import AsyncClient, ASGITransport
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ─── Token Factories ─────────────────────────────────────────────────────────

@pytest.fixture
def valid_jwt():
    return _make_jwt(
        {"itcode": "testuser", "name": "Test User", "department": "QA"},
        "bc3868bfa47ef87440a9e874afaad77c706c6229d08e5bb74f51ab726d072fc4",
    )


@pytest.fixture
def valid_jwt_no_itcode():
    return _make_jwt(
        {"name": "No Itcode"},
        "bc3868bfa47ef87440a9e874afaad77c706c6229d08e5bb74f51ab726d072fc4",
    )


@pytest.fixture
def expired_jwt():
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    payload = {"itcode": "testuser", "exp": int(past.timestamp()), "iat": int(past.timestamp())}
    h_b64 = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    p_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    secret = "bc3868bfa47ef87440a9e874afaad77c706c6229d08e5bb74f51ab726d072fc4"
    sig = hmac.new(secret.encode(), f"{h_b64}.{p_b64}".encode(), hashlib.sha256).digest()
    s_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"{h_b64}.{p_b64}.{s_b64}"


@pytest.fixture
def make_test_access_token(mock_settings):
    def _make(itcode: str, minutes: int = 15) -> str:
        return _make_access_token(itcode, mock_settings.JWT_SECRET, minutes)
    return _make