from types import SimpleNamespace

import pytest

from app.services import mail_service


@pytest.mark.asyncio
async def test_send_email_uses_mail_service_contract_without_runtime_proxy(monkeypatch):
    captured = {}

    class MockResponse:
        status_code = 200

        def json(self):
            return {"accepted": True}

    class MockAsyncClient:
        def __init__(self, **kwargs):
            captured["client_options"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers, json):
            captured["url"] = url
            captured["headers"] = headers
            captured["payload"] = json
            return MockResponse()

    monkeypatch.setattr(mail_service.httpx, "AsyncClient", MockAsyncClient)
    monkeypatch.setattr(
        mail_service,
        "get_settings",
        lambda: SimpleNamespace(
            MAIL_PROXY_URL="https://mail-service.test/send",
            MAIL_PROXY_TOKEN="test-token",
        ),
    )

    response = await mail_service.send_email(
        "subject",
        "<p>body</p>",
        ["qa@example.com"],
        cc=["cc@example.com"],
    )

    assert response == {"accepted": True}
    assert captured["client_options"]["trust_env"] is False
    assert captured["url"] == "https://mail-service.test/send"
    assert captured["headers"] == {
        "Authorization": "Bearer test-token",
        "Content-Type": "application/json",
    }
    assert captured["payload"]["to"] == ["qa@example.com"]
    assert captured["payload"]["cc"] == ["cc@example.com"]
    assert captured["payload"]["subject"] == "subject"
    assert captured["payload"]["content"] == "<p>body</p>"
    assert captured["payload"]["contentType"] == "text/html; charset=utf-8"
