import json

import pytest

from app.libs.photo_sources import PhotoSourceClient
from app.services.process_record_service import (
    BASE_FILTER_VALUES,
    SOURCE_DEFINITIONS,
    ProcessRecordGateway,
    _record_sort_key,
    get_filter_options,
    normalize_record,
)


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def test_normalize_system1_collects_three_photo_slots():
    item = normalize_record(
        "system1",
        {
            "id": 9,
            "scan_code": "6102292204461634",
            "base_code": "TJ",
            "process": "TJM-OP320",
            "photo_url_one": "Upload/Tables/Tb_process_scan_photo/one.jpg",
            "photo_url_two": "Upload/Tables/Tb_process_scan_photo/two.jpg",
            "photo_url_three": None,
            "custom": "preserved",
        },
    )
    assert item.key == "system1:9"
    assert item.sn == "6102292204461634"
    assert item.base == "天津"
    assert item.station == "TJM-OP320"
    assert [photo.path for photo in item.photos] == [
        "Upload/Tables/Tb_process_scan_photo/one.jpg",
        "Upload/Tables/Tb_process_scan_photo/two.jpg",
    ]
    assert item.raw["custom"] == "preserved"


def test_normalize_system1_splits_multiple_photos_in_one_slot():
    item = normalize_record(
        "system1",
        {
            "id": 10,
            "scan_code": "6102292204461634",
            "photo_url_three": (
                "Upload/Tables/Tb_process_scan_photo/one.jpg,"
                "Upload/Tables/Tb_process_scan_photo/two.jpg,"
                "Upload/Tables/Tb_process_scan_photo/three.jpg"
            ),
        },
    )
    assert [photo.path for photo in item.photos] == [
        "Upload/Tables/Tb_process_scan_photo/one.jpg",
        "Upload/Tables/Tb_process_scan_photo/two.jpg",
        "Upload/Tables/Tb_process_scan_photo/three.jpg",
    ]


def test_normalize_system2_preserves_all_display_fields():
    item = normalize_record(
        "system2",
        {
            "Base": "3000",
            "StationName": "机箱封盖前检查",
            "SubmitTime": "2026-07-22T14:36:16",
            "Id": 1251407,
            "Barcode": "6102286104479338",
            "Order": "SO-1",
            "Photos": "Upload/Tables/tb_assembly_image/image.jpg",
            "Files": "file.txt",
            "Remarks": "ok",
        },
    )
    assert item.base == "昆山"
    assert item.station == "机箱封盖前检查"
    assert item.order == "SO-1"
    assert item.files == "file.txt"
    assert item.remarks == "ok"
    assert item.raw["Id"] == 1251407


@pytest.mark.asyncio
async def test_fetch_page_builds_source_specific_sn_filter(monkeypatch):
    client = PhotoSourceClient(SOURCE_DEFINITIONS["system1"], "user", "password")
    captured = {}

    async def fake_request(method, url, **kwargs):
        captured.update({"method": method, "url": url, **kwargs})
        return FakeResponse({"status": 0, "total": 0, "rows": []})

    monkeypatch.setattr(client, "_request", fake_request)
    try:
        await client.fetch_page(1, 30, "6102292204461634")
    finally:
        await client.close()

    payload = captured["json"]
    assert payload["sort"] == "id"
    assert json.loads(payload["wheres"]) == [
        {
            "name": "scan_code",
            "value": "6102292204461634",
            "displayType": "text",
        }
    ]


@pytest.mark.asyncio
async def test_login_status_refreshes_an_expired_upstream_session():
    client = PhotoSourceClient(SOURCE_DEFINITIONS["system1"], "user", "password")
    calls = []
    status_checks = 0

    async def fake_post(url, **kwargs):
        nonlocal status_checks
        calls.append(url)
        if url == "/api/user/login":
            return FakeResponse({"status": 0})
        status_checks += 1
        return FakeResponse({"status": 401} if status_checks == 1 else {"loggedIn": True})

    client._client.post = fake_post
    try:
        result = await client.get_login_status()
    finally:
        await client.close()

    assert result == {"loggedIn": True}
    assert calls == [
        "/api/user/login",
        "/api/user/GetCurrentUserInfo",
        "/api/user/login",
        "/api/user/GetCurrentUserInfo",
    ]


@pytest.mark.asyncio
async def test_request_relogs_and_retries_when_upstream_returns_auth_status():
    client = PhotoSourceClient(SOURCE_DEFINITIONS["system1"], "user", "password")
    login_count = 0
    request_count = 0

    async def fake_post(url, **kwargs):
        nonlocal login_count
        assert url == "/api/user/login"
        login_count += 1
        return FakeResponse({"status": 0})

    async def fake_request(method, url, **kwargs):
        nonlocal request_count
        request_count += 1
        return FakeResponse({"status": 401} if request_count == 1 else {"status": 0})

    client._client.post = fake_post
    client._client.request = fake_request
    try:
        response = await client._request("POST", "/api/test")
    finally:
        await client.close()

    assert response.json() == {"status": 0}
    assert login_count == 2
    assert request_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("source", "base", "station", "expected_wheres"),
    [
        (
            "system1",
            "TJ",
            "TJM-OP320",
            [
                {"name": "base_code", "value": "TJ", "displayType": "select"},
                {"name": "process", "value": "TJM-OP320", "displayType": "select"},
                {"name": "scan_code", "value": "SN-1", "displayType": "text"},
            ],
        ),
        (
            "system2",
            "1000",
            "封箱检查",
            [
                {"name": "Base", "value": "1000", "displayType": "select"},
                {"name": "StationName", "value": "封箱检查"},
                {"name": "Barcode", "value": "SN-1", "displayType": "like"},
            ],
        ),
    ],
)
async def test_fetch_page_builds_source_specific_filter_payload(
    monkeypatch, source, base, station, expected_wheres
):
    client = PhotoSourceClient(SOURCE_DEFINITIONS[source], "user", "password")
    captured = {}

    async def fake_request(method, url, **kwargs):
        captured.update({"method": method, "url": url, **kwargs})
        return FakeResponse({"status": 0, "total": 0, "rows": []})

    monkeypatch.setattr(client, "_request", fake_request)
    try:
        await client.fetch_page(1, 30, sn="SN-1", base=base, station=station)
    finally:
        await client.close()

    assert json.loads(captured["json"]["wheres"]) == expected_wheres


@pytest.mark.asyncio
async def test_gateway_maps_one_base_name_for_each_source(monkeypatch):
    captured = {}

    class FakeClient:
        def __init__(self, source):
            self.source = source

        async def fetch_page(self, page, rows, **kwargs):
            captured[self.source] = kwargs
            return {"status": 0, "total": 0, "rows": []}

    gateway = ProcessRecordGateway()

    async def fake_ensure_clients():
        return {"system1": FakeClient("system1"), "system2": FakeClient("system2")}

    monkeypatch.setattr(gateway, "_ensure_clients", fake_ensure_clients)
    result = await gateway.query("all", 1, 30, "SN-1", "天津", "封箱检查")

    assert captured["system1"] == {"sn": "SN-1", "base": "TJ", "station": "封箱检查"}
    assert captured["system2"] == {
        "sn": "SN-1",
        "base": "1000",
        "station": "封箱检查",
    }
    assert result.total == 0


def test_filter_options_expose_supported_sources_without_upstream_codes():
    options = get_filter_options()
    bases = {option.name: option.sources for option in options.bases}

    assert BASE_FILTER_VALUES["大同"] == {"system1": "DT", "system2": "D000"}
    assert bases["天津"] == ["system1", "system2"]
    assert bases["青岛"] == ["system1"]
    assert "TJM-OP320" in options.system1Processes


def test_image_path_validation_blocks_upstream_escape():
    assert (
        PhotoSourceClient.validate_image_path("Upload/Tables/tb_assembly_image/image.jpg")
        == "Upload/Tables/tb_assembly_image/image.jpg"
    )
    with pytest.raises(ValueError):
        PhotoSourceClient.validate_image_path("../../etc/passwd")
    with pytest.raises(ValueError):
        PhotoSourceClient.validate_image_path("http://example.com/image.jpg")


def test_cross_source_times_sort_chronologically():
    later_system1 = normalize_record("system1", {"id": 2, "CreateDate": "2026-07-22 15:50:00"})
    earlier_system2 = normalize_record("system2", {"Id": 1, "SubmitTime": "2026-07-22T15:37:00"})
    rows = sorted([earlier_system2, later_system1], key=_record_sort_key, reverse=True)
    assert rows[0] is later_system1
