import json

import pytest

from app.libs.photo_sources import PhotoSourceClient
from app.services.process_record_service import (
    SOURCE_DEFINITIONS,
    _record_sort_key,
    normalize_record,
)


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


def test_normalize_system1_collects_three_photo_slots():
    item = normalize_record(
        "system1",
        {
            "id": 9,
            "scan_code": "6102292204461634",
            "process": "TJM-OP320",
            "photo_url_one": "Upload/Tables/Tb_process_scan_photo/one.jpg",
            "photo_url_two": "Upload/Tables/Tb_process_scan_photo/two.jpg",
            "photo_url_three": None,
            "custom": "preserved",
        },
    )
    assert item.key == "system1:9"
    assert item.sn == "6102292204461634"
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
    assert item.base == "3000"
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
    later_system1 = normalize_record(
        "system1", {"id": 2, "CreateDate": "2026-07-22 15:50:00"}
    )
    earlier_system2 = normalize_record(
        "system2", {"Id": 1, "SubmitTime": "2026-07-22T15:37:00"}
    )
    rows = sorted([earlier_system2, later_system1], key=_record_sort_key, reverse=True)
    assert rows[0] is later_system1
