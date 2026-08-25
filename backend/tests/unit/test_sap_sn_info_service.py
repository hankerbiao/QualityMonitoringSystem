"""Unit tests for the SAP SN information client."""

import hashlib
from datetime import datetime

import httpx

from app.services.sap_sn_info_service import (
    KK_URL,
    METHOD,
    SG_URL,
    SapSnInfoService,
)


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self.payload = payload

    def json(self):
        if self.payload is None:
            raise ValueError("invalid json")
        return self.payload


class FakeClient:
    def __init__(self, responses=None, error=None):
        self.responses = responses or {}
        self.error = error
        self.calls = []

    async def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "json": json, "headers": headers})
        if self.error:
            raise self.error
        return self.responses.get(url, FakeResponse(200, {"MSGTY": "S", "DATA": []}))


def test_build_headers_and_payload():
    service = SapSnInfoService()
    now = datetime(2026, 3, 9)
    headers = service._build_headers(now)
    expected = hashlib.md5(
        f"sugon{METHOD}20260309sugon".encode()
    ).hexdigest().upper()
    assert headers["method"] == METHOD
    assert headers["time"] == "20260309"
    assert headers["sign"] == expected
    assert service._build_payload(["SN-1"]) == {"SN_LIST": ["SN-1"]}


async def test_fetch_all_success_and_partial_failure():
    client = FakeClient(
        responses={
            SG_URL: FakeResponse(200, {"MSGTY": "S", "DATA": [{"PCODE": "SN-1"}]}),
            KK_URL: FakeResponse(500, {"MSGTY": "E", "MSGTX": "down"}),
        }
    )
    results = await SapSnInfoService(client).fetch_all(["SN-1"])
    assert results["SG"].success is True
    assert results["SG"].records == [{"PCODE": "SN-1"}]
    assert results["KK"].success is False
    assert "HTTP 500" in (results["KK"].error or "")
    assert {call["url"] for call in client.calls} == {SG_URL, KK_URL}


async def test_network_error_is_reported_per_source():
    results = await SapSnInfoService(FakeClient(error=httpx.ConnectTimeout("down"))).fetch_all(["SN-1"])
    assert all(result.success is False for result in results.values())
    assert all("SAP request failed" in (result.error or "") for result in results.values())
