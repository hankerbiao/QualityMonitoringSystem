import asyncio
from contextlib import asynccontextmanager

import httpx
import pytest

from app.libs.photo_sources import PhotoSourceClient
from app.services.process_record_service import SOURCE_DEFINITIONS

PAGE = {"status": 0, "total": 1, "rows": [{"id": 1, "scan_code": "SN-1"}]}


@asynccontextmanager
async def source_client(handler):
    client = PhotoSourceClient(SOURCE_DEFINITIONS["system1"], "user", "password")
    await client._client.aclose()
    client._client = httpx.AsyncClient(
        base_url=client.definition.api_base_url,
        transport=httpx.MockTransport(handler),
        follow_redirects=True,
    )
    try:
        yield client
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "expired_payload",
    [
        {"code": 401, "success": False, "rows": [], "total": 0},
        {"code": "403"},
        {"data": {"code": 401}},
        {"success": False, "message": "session expired"},
        {"success": False, "msg": "登录已过期，请重新登录"},
        {"loggedIn": False},
        {"data": {"isLogin": False}},
    ],
)
async def test_expired_session_recovers_records_without_saving_config(expired_payload):
    logins = 0

    def handler(request):
        nonlocal logins
        if request.url.path == "/api/user/login":
            logins += 1
            return httpx.Response(200, json={"status": 0, "data": {"token": f"token-{logins}"}})
        if request.headers["Authorization"] == "Bearer token-1":
            return httpx.Response(200, json=expired_payload)
        return httpx.Response(200, json=PAGE)

    async with source_client(handler) as client:
        result = await client.fetch_page(1, 30)

    assert result["rows"][0]["scan_code"] == "SN-1"
    assert logins == 2


@pytest.mark.asyncio
async def test_redirect_to_login_page_recovers_records():
    logins = 0

    def handler(request):
        nonlocal logins
        if request.url.path == "/api/user/login":
            logins += 1
            return httpx.Response(200, json={"status": 0, "token": f"token-{logins}"})
        if request.url.path == "/login":
            return httpx.Response(
                200, text="<html>Login</html>", headers={"Content-Type": "text/html"}
            )
        if request.headers["Authorization"] == "Bearer token-1":
            return httpx.Response(302, headers={"Location": "/login"})
        return httpx.Response(200, json=PAGE)

    async with source_client(handler) as client:
        result = await client.fetch_page(1, 30)

    assert result["rows"][0]["scan_code"] == "SN-1"
    assert logins == 2


@pytest.mark.asyncio
async def test_relogin_drops_stale_authorization_and_cookies():
    logins = 0

    def handler(request):
        nonlocal logins
        if request.url.path == "/api/user/login":
            logins += 1
            if request.headers.get("Authorization") or request.headers.get("Cookie"):
                return httpx.Response(401, json={"message": "stale credentials"})
            return httpx.Response(
                200,
                json={"status": 0, "token": f"token-{logins}"},
                headers={"Set-Cookie": f"session=session-{logins}; Path=/"},
            )
        if request.headers["Authorization"] == "Bearer token-1":
            return httpx.Response(401)
        assert request.headers["Cookie"] == "session=session-2"
        return httpx.Response(200, json=PAGE)

    async with source_client(handler) as client:
        result = await client.fetch_page(1, 30)

    assert result["rows"][0]["scan_code"] == "SN-1"


@pytest.mark.asyncio
async def test_user_agent_bound_session_remains_valid_for_queries():
    login_user_agent = None

    def handler(request):
        nonlocal login_user_agent
        if request.url.path == "/api/user/login":
            login_user_agent = request.headers["User-Agent"]
            return httpx.Response(200, json={"status": 0})
        if request.headers["User-Agent"] != login_user_agent:
            return httpx.Response(401)
        return httpx.Response(200, json=PAGE)

    async with source_client(handler) as client:
        result = await client.fetch_page(1, 30)

    assert result["rows"][0]["scan_code"] == "SN-1"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure",
    [
        {"success": False, "message": "数据库暂不可用", "rows": [], "total": 0},
        {"code": 500, "message": "数据库暂不可用", "rows": [], "total": 0},
    ],
)
async def test_business_failure_is_reported_instead_of_empty_records(failure):
    logins = 0

    def handler(request):
        nonlocal logins
        if request.url.path == "/api/user/login":
            logins += 1
            return httpx.Response(200, json={"status": 0})
        return httpx.Response(200, json=failure)

    async with source_client(handler) as client:
        with pytest.raises(RuntimeError, match="数据库暂不可用"):
            await client.fetch_page(1, 30)

    assert logins == 1


@pytest.mark.asyncio
async def test_repeated_auth_failure_is_bounded_and_next_query_logs_in_again():
    logins = 0
    recovered = False

    def handler(request):
        nonlocal logins
        if request.url.path == "/api/user/login":
            logins += 1
            return httpx.Response(200, json={"status": 0, "token": f"token-{logins}"})
        return httpx.Response(200, json=PAGE if recovered else {"code": 401, "rows": []})

    async with source_client(handler) as client:
        with pytest.raises(RuntimeError, match="登录"):
            await client.fetch_page(1, 30)
        assert logins == 2
        recovered = True
        result = await client.fetch_page(1, 30)

    assert result["rows"][0]["scan_code"] == "SN-1"
    assert logins == 3


@pytest.mark.asyncio
async def test_login_status_does_not_claim_success_after_failed_recovery():
    logins = 0

    def handler(request):
        nonlocal logins
        if request.url.path == "/api/user/login":
            logins += 1
            return httpx.Response(200, json={"status": 0})
        return httpx.Response(200, json={"data": {"isLogin": False}})

    async with source_client(handler) as client:
        with pytest.raises(RuntimeError, match="登录"):
            await client.get_login_status()

    assert logins == 2


@pytest.mark.asyncio
async def test_parallel_queries_share_one_session_refresh():
    logins = 0
    expired_requests = 0
    all_expired_requests_started = asyncio.Event()

    async def handler(request):
        nonlocal logins, expired_requests
        if request.url.path == "/api/user/login":
            logins += 1
            await asyncio.sleep(0)
            return httpx.Response(200, json={"status": 0, "token": f"token-{logins}"})
        if request.headers["Authorization"] == "Bearer token-1":
            expired_requests += 1
            if expired_requests == 5:
                all_expired_requests_started.set()
            await asyncio.wait_for(all_expired_requests_started.wait(), timeout=2)
            return httpx.Response(401)
        if request.headers["Authorization"] != f"Bearer token-{logins}":
            return httpx.Response(401)
        return httpx.Response(200, json=PAGE)

    async with source_client(handler) as client:
        await client.login()
        results = await asyncio.gather(*(client.fetch_page(1, 30) for _ in range(5)))

    assert all(result["rows"][0]["scan_code"] == "SN-1" for result in results)
    assert logins == 2


@pytest.mark.asyncio
async def test_login_rejects_failure_code_without_caching_a_session():
    def handler(request):
        return httpx.Response(200, json={"code": 401, "message": "账号已禁用"})

    async with source_client(handler) as client:
        with pytest.raises(RuntimeError, match="账号已禁用"):
            await client.login()
        assert client._logged_in is False


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["system1", "system2"])
@pytest.mark.parametrize("code", ["310", 310])
async def test_upstream_login_success_code_allows_status_check_and_queries(source, code):
    client = PhotoSourceClient(SOURCE_DEFINITIONS[source], "user", "password")
    await client._client.aclose()
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path == "/api/user/login":
            return httpx.Response(
                200,
                json={
                    "status": True,
                    "code": code,
                    "message": "登陆成功",
                    "data": {"token": "source-token"},
                },
            )
        assert request.headers["Authorization"] == "Bearer source-token"
        if request.url.path == "/api/user/GetCurrentUserInfo":
            return httpx.Response(200, json={"status": True, "data": {"isLogin": True}})
        return httpx.Response(200, json=PAGE)

    client._client = httpx.AsyncClient(
        base_url=client.definition.api_base_url,
        transport=httpx.MockTransport(handler),
    )
    try:
        await client.login()
        await client.get_login_status()
        result = await client.fetch_page(1, 30)
        assert client._logged_in is True
    finally:
        await client.close()

    assert result["rows"][0]["scan_code"] == "SN-1"
    assert calls == [
        "/api/user/login",
        "/api/user/GetCurrentUserInfo",
        client.definition.page_path,
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"status": False, "code": "310", "message": "账号或密码错误"},
        {"success": False, "code": "310", "message": "账号或密码错误"},
        {"status": True, "code": 500, "message": "登录服务异常"},
    ],
)
async def test_explicit_login_failure_does_not_cache_session(payload):
    def handler(request):
        return httpx.Response(200, json=payload)

    async with source_client(handler) as client:
        with pytest.raises(RuntimeError, match=payload["message"]):
            await client.login()
        assert client._logged_in is False
