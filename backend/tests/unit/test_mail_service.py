from types import SimpleNamespace

import pytest

from app.services import mail_service


@pytest.mark.asyncio
async def test_send_email_bypasses_environment_proxy_for_mail_relay(monkeypatch):
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

        async def post(self, url, json):
            captured["url"] = url
            captured["payload"] = json
            return MockResponse()

    monkeypatch.setattr(mail_service.httpx, "AsyncClient", MockAsyncClient)
    monkeypatch.setattr(
        mail_service,
        "get_settings",
        lambda: SimpleNamespace(MAIL_PROXY_URL="http://mail-relay.test/send"),
    )

    response = await mail_service.send_email("subject", "<p>body</p>", ["qa@example.com"])

    assert response == {"accepted": True}
    assert captured["client_options"]["trust_env"] is False
    assert captured["url"] == "http://mail-relay.test/send"
    assert captured["payload"]["to"] == ["qa@example.com"]
