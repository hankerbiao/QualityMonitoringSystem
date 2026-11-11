from types import SimpleNamespace

import pytest

from app.services import oa_user_directory as directory


@pytest.mark.asyncio
async def test_employee_suggestions_search_meilisearch_with_single_character(monkeypatch):
    requests = []

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "hits": [
                    {
                        "itcode": "zhangbing",
                        "realname": "张兵",
                        "email": "zhangbing@example.com",
                        "department": "质量部",
                        "position": "工程师",
                    },
                    {"realname": "无邮箱员工"},
                ]
            }

    class Client:
        def __init__(self, **kwargs):
            assert kwargs["trust_env"] is False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, *, json, headers):
            requests.append((url, json, headers))
            return Response()

    monkeypatch.setattr(
        directory,
        "get_settings",
        lambda: SimpleNamespace(
            OA_EMPLOYEE_SEARCH_URL="https://meilisearch.example.test/search",
            OA_EMPLOYEE_SEARCH_API_KEY="server-key",
        ),
    )
    monkeypatch.setattr(directory.httpx, "AsyncClient", Client)

    matches = await directory.search_employee_suggestions(" z ")

    assert [employee["email"] for employee in matches] == ["zhangbing@example.com"]
    url, payload, headers = requests[0]
    assert url == "https://meilisearch.example.test/search"
    assert payload == {
        "q": "z",
        "limit": 10,
        "matchingStrategy": "last",
        "attributesToRetrieve": ["email", "realname", "department", "position", "itcode"],
        "attributesToHighlight": ["email", "realname"],
    }
    assert headers == {"Authorization": "Bearer server-key"}


@pytest.mark.asyncio
async def test_employee_suggestions_unwrap_gateway_envelope(monkeypatch):
    """1oa 网关把 Meilisearch 结果包在 {"data": {"hits": [...]}} 里。"""

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "data": {
                    "estimatedTotalHits": 2,
                    "hits": [
                        {"itcode": "linxj1", "realname": "LIN.SHIAN-JIANN", "email": "linxj1@example.com",
                         "department": "中科天机", "position": "首席科学家"},
                        {"itcode": "nobody", "realname": "无邮箱员工"},
                    ],
                    "limit": 10,
                    "query": "li",
                },
                "meta": {"request_id": "req_1"},
                "error": None,
            }

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, *, json, headers):
            return Response()

    monkeypatch.setattr(
        directory,
        "get_settings",
        lambda: SimpleNamespace(
            OA_EMPLOYEE_SEARCH_URL="https://gw.example.test/search",
            OA_EMPLOYEE_SEARCH_API_KEY="server-key",
        ),
    )
    monkeypatch.setattr(directory.httpx, "AsyncClient", Client)

    matches = await directory.search_employee_suggestions("li")

    assert [employee["email"] for employee in matches] == ["linxj1@example.com"]
    assert matches[0]["itcode"] == "linxj1"


@pytest.mark.asyncio
async def test_employee_suggestions_surface_gateway_error(monkeypatch):
    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"data": None, "meta": {"request_id": "req_2"}, "error": "invalid api key"}

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, *, json, headers):
            return Response()

    monkeypatch.setattr(
        directory,
        "get_settings",
        lambda: SimpleNamespace(
            OA_EMPLOYEE_SEARCH_URL="https://gw.example.test/search",
            OA_EMPLOYEE_SEARCH_API_KEY="server-key",
        ),
    )
    monkeypatch.setattr(directory.httpx, "AsyncClient", Client)

    with pytest.raises(RuntimeError, match="invalid api key"):
        await directory.search_employee_suggestions("li")
