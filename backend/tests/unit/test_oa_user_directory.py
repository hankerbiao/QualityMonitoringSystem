from types import SimpleNamespace

import pytest

from app.core.config import Settings
from app.services import oa_user_directory as directory


@pytest.fixture(autouse=True)
def clear_cache():
    directory.clear_employee_cache()
    yield
    directory.clear_employee_cache()


@pytest.mark.asyncio
async def test_employee_directory_reads_all_pages_and_sends_api_key(monkeypatch):
    requests = []

    class Response:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class Client:
        def __init__(self, **_kwargs):
            assert _kwargs["trust_env"] is False
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, url, *, params, headers):
            requests.append((url, params, headers))
            if params["page"] == 1:
                return Response({"items": [{"itcode": "a1", "realname": "张三", "email": "a@example.com"}], "page": 1, "page_size": 200, "has_more": True})
            return Response({"items": [{"itcode": "b2", "realname": "李四", "email": "b@example.com"}], "page": 2, "page_size": 200, "has_more": False})

    monkeypatch.setattr(directory, "get_settings", lambda: SimpleNamespace(
        OA_USER_API_KEY="server-key",
        OA_USER_API_URL="https://oa.example.test/users",
        OA_USER_CACHE_TTL_SECONDS=300,
    ))
    monkeypatch.setattr(directory.httpx, "AsyncClient", Client)

    matches = await directory.search_employees("李四")

    assert [employee["email"] for employee in matches] == ["b@example.com"]
    assert [request[1]["page"] for request in requests] == [1, 2]
    assert all(request[2] == {"X-API-Key": "server-key"} for request in requests)


def test_employee_directory_cache_defaults_to_one_week():
    assert Settings().OA_USER_CACHE_TTL_SECONDS == 7 * 24 * 60 * 60


@pytest.mark.asyncio
async def test_employee_search_matches_email_itcode_and_department(monkeypatch):
    async def load_employees():
        directory._cache = [
            {"itcode": "abc123", "realname": "张三", "internalName": "Sam", "email": "sam@example.com", "department": "质量部"},
            {"itcode": "def456", "realname": "李四", "internalName": "Lee", "email": "lee@example.com", "department": "研发部"},
        ]
        directory._cache_expires_at = 99999999999
        return directory._cache

    monkeypatch.setattr(directory, "_load_employees", load_employees)

    assert (await directory.search_employees("ABC1"))[0]["email"] == "sam@example.com"
    assert (await directory.search_employees("研发"))[0]["email"] == "lee@example.com"
    assert (await directory.search_employees("lee@example"))[0]["itcode"] == "def456"
    assert await directory.search_employees("x") == []
