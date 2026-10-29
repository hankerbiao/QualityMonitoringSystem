from datetime import date
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.api import incoming_materials as api
from app.api.auth import get_current_user
from app.base_access import base_access_scope, current_base_permissions
from app.main import app
from app.services import incoming_materials as service
from app.services.image_access import image_grant


@pytest.fixture(autouse=True)
def incoming_status(monkeypatch):
    statuses = {"incoming-materials": "available"}
    monkeypatch.setattr(api, "get_database", lambda: None)
    monkeypatch.setattr(api, "SettingsService", lambda _db: type(
        "StatusService", (), {"get_dashboard_statuses": AsyncMock(side_effect=lambda: statuses)}
    )())
    return statuses


def make_rows(count):
    return [
        {"id": i, "location_info": "DN00", "basecode": "TJ", "value": f"row-{i}"}
        for i in range(count)
    ]


def setup_pages(monkeypatch, rows):
    monkeypatch.setattr(service.process_record_gateway, "_ensure_clients", AsyncMock(return_value={"system1": object()}))
    fetch = AsyncMock(side_effect=lambda client, page: {
        "total": len(rows), "rows": rows[(page - 1) * 30 : page * 30],
    })
    monkeypatch.setattr(service, "fetch_page", fetch)
    return fetch


async def test_location_match_and_missing_field(monkeypatch):
    rows = make_rows(6)
    for row, value in zip(rows, ["DN00", "9N00", " dn00 ", "N00A", "", None], strict=True):
        row["location_info"] = value
    del rows[-1]["location_info"]
    setup_pages(monkeypatch, rows)
    data = await service.query_incoming_materials("")
    assert [row["id"] for row in data["rows"]] == [0, 1, 2]
    assert (data["upstreamTotal"], data["readCount"], data["matchedCount"], data["complete"]) == (6, 6, 3, True)
    for row in rows:
        row.pop("location_info", None)
    with pytest.raises(ValueError, match="缺少库位"):
        await service.query_incoming_materials("")


async def test_default_reads_all_pages_and_keyword_search(monkeypatch):
    rows = make_rows(932)
    fetch = setup_pages(monkeypatch, rows)
    default = await service.query_incoming_materials("")
    assert default["upstreamTotal"] == 932
    assert default["readCount"] == 932
    assert default["matchedCount"] == 932
    assert default["complete"]
    assert fetch.await_count == 33  # 32 pages and a first-page consistency check
    result = await service.query_incoming_materials("ROW-931")
    assert result["complete"] and result["readCount"] == 932
    assert [row["id"] for row in result["rows"]] == [931]


async def test_base_access_is_applied_before_counts_and_search(monkeypatch):
    rows = make_rows(3)
    rows[1]["basecode"] = "KS"
    rows[2]["basecode"] = "1000"
    setup_pages(monkeypatch, rows)
    with base_access_scope(["TJ"]):
        result = await service.query_incoming_materials("")
        assert result["upstreamTotal"] is None
        assert result["readCount"] == result["matchedCount"] == 2
        assert [row["id"] for row in result["rows"]] == [0, 2]
        rows[0]["basecode"] = "unknown"
        with pytest.raises(ValueError, match="基地字段"):
            await service.query_incoming_materials("")


async def test_multiple_bases_match_aliases_and_search_all_pages(monkeypatch):
    rows = make_rows(905)
    rows[903]["basecode"] = "KS"
    rows[904]["basecode"] = "AY"
    setup_pages(monkeypatch, rows)
    result = await service.query_incoming_materials("", bases=["天津", "3000"])
    assert result["complete"]
    assert len(result["rows"]) == 904
    assert result["rows"][-1]["basecode"] == "KS"
    with base_access_scope(["1000"]):
        result = await service.query_incoming_materials("", bases=["天津", "昆山"])
        assert all(row["basecode"] == "TJ" for row in result["rows"])


async def test_combined_filters_search_all_pages(monkeypatch):
    rows = make_rows(905)
    rows[-1].update({"basecode": "TJ", "selmatnr": "MAT-123", "supplier": "Supplier A",
                     "ebeln": "PO-99", "prueflos": "LOT-10", "abnormal_class": "外观异常",
                     "pastrterm": "2026-10-12 10:00:00"})
    setup_pages(monkeypatch, rows)
    result = await service.query_incoming_materials(
        "", base="1000", material="mat-123", supplier="supplier", order="99", lot="lot-10",
        category="外观", date_from=date(2026, 10, 1), date_to=date(2026, 10, 31),
    )
    assert result["complete"]
    assert [row["id"] for row in result["rows"]] == [904]
    outside = await service.query_incoming_materials("", date_from=date(2026, 10, 13))
    assert outside["rows"] == []


async def test_empty_and_page_failures(monkeypatch):
    setup_pages(monkeypatch, [])
    assert (await service.query_incoming_materials(""))["rows"] == []
    rows = make_rows(31)
    fetch = setup_pages(monkeypatch, rows)
    async def changed(client, page):
        data = {"total": len(rows), "rows": rows[(page - 1) * 30 : page * 30]}
        if page == 2:
            data["total"] += 1
        return data
    fetch.side_effect = changed
    with pytest.raises(ValueError, match="发生变化"):
        await service.query_incoming_materials("")
    fetch.side_effect = [{"total": len(rows), "rows": rows[:30]}, RuntimeError("网络错误")]
    with pytest.raises(RuntimeError, match="网络错误"):
        await service.query_incoming_materials("")


def test_endpoint_requires_dashboard_permission_and_passes_base_scope(monkeypatch):
    async def scoped_query(keyword, **kwargs):
        return {"scope": current_base_permissions(), "keyword": keyword}
    query = AsyncMock(side_effect=scoped_query)
    monkeypatch.setattr(api, "query_incoming_materials", query)
    user = {"role": "user", "dashboardPermissions": [], "basePermissions": ["TJ"]}
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        client = TestClient(app)
        assert client.get("/api/incoming-materials/realtime").status_code == 403
        assert query.await_count == 0
        user["dashboardPermissions"] = ["incoming-materials"]
        response = client.get("/api/incoming-materials/realtime?keyword=test")
        assert response.status_code == 200
        assert response.json()["data"]["scope"] == ["1000"]
        assert query.await_args.args == ("test",)
        assert client.get("/api/incoming-materials/realtime?bases=天津&bases=昆山").status_code == 403
        assert client.get("/api/incoming-materials/realtime?bases=天津").status_code == 200
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_images_are_granted_only_for_valid_paths_on_accessible_rows(monkeypatch):
    prefix = service.IMAGE_PREFIX
    rows = make_rows(2)
    rows[0]['bad_img'] = f'{prefix}one.jpg,{prefix}two.jpg,Upload/Tables/other/private.jpg'
    rows[0]['report_attachment'] = f'{prefix}报告,第1版.doc,{prefix}报告2.pptx'
    rows[1].update({'basecode': 'KS', 'bad_img': f'{prefix}private.jpg'})
    setup_pages(monkeypatch, rows)
    with base_access_scope(['TJ']):
        result = await service.query_incoming_materials('')
        assert [photo['path'] for photo in result['rows'][0]['_incomingPhotos']] == [f'{prefix}one.jpg', f'{prefix}two.jpg']
        assert [report['path'] for report in result['rows'][0]['_incomingReports']] == [f'{prefix}报告,第1版.doc', f'{prefix}报告2.pptx']
        assert len(result['rows']) == 1


def test_image_endpoint_checks_grant_base_path_and_content_type(monkeypatch):
    path = service.IMAGE_PREFIX + 'example.jpg'
    fetch = AsyncMock(return_value=(b'image', 'image/jpeg'))
    monkeypatch.setattr(api.process_record_gateway, 'fetch_image', fetch)
    user = {'role': 'user', 'dashboardPermissions': ['incoming-materials'], 'basePermissions': ['TJ']}
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        client = TestClient(app)
        token = image_grant(service.IMAGE_SOURCE, path, 'TJ')
        response = client.get('/api/incoming-materials/image', params={'path': path, 'accessToken': token})
        assert response.status_code == 200 and response.content == b'image'
        assert response.headers['content-type'] == 'image/jpeg'
        assert client.get('/api/incoming-materials/image', params={'path': path, 'accessToken': 'invalid'}).status_code == 403
        wrong_base = image_grant(service.IMAGE_SOURCE, path, 'KS')
        assert client.get('/api/incoming-materials/image', params={'path': path, 'accessToken': wrong_base}).status_code == 403
        assert client.get('/api/incoming-materials/image', params={'path': 'Upload/Tables/other/image.jpg', 'accessToken': token}).status_code == 400
        assert client.get('/api/incoming-materials/image', params={'path': service.IMAGE_PREFIX + '../secret.jpg', 'accessToken': token}).status_code == 400
        fetch.return_value = (b'<html>bad</html>', 'text/html')
        assert client.get('/api/incoming-materials/image', params={'path': path, 'accessToken': token}).status_code == 502
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_report_download_requires_its_own_grant_and_base_access(monkeypatch):
    path = service.IMAGE_PREFIX + '报告,第一版.pptx'
    fetch = AsyncMock(return_value=(b'file bytes', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'))
    monkeypatch.setattr(api.process_record_gateway, 'fetch_image', fetch)
    app.dependency_overrides[get_current_user] = lambda: {'role': 'user', 'dashboardPermissions': ['incoming-materials'], 'basePermissions': ['TJ']}
    try:
        client = TestClient(app)
        token = image_grant(service.REPORT_SOURCE, path, 'TJ')
        response = client.get('/api/incoming-materials/report', params={'path': path, 'accessToken': token})
        assert response.status_code == 200 and response.content == b'file bytes'
        assert response.headers['content-disposition'].startswith("attachment; filename*=UTF-8''")
        photo_token = image_grant(service.IMAGE_SOURCE, path, 'TJ')
        assert client.get('/api/incoming-materials/report', params={'path': path, 'accessToken': photo_token}).status_code == 403
        wrong_base = image_grant(service.REPORT_SOURCE, path, 'KS')
        assert client.get('/api/incoming-materials/report', params={'path': path, 'accessToken': wrong_base}).status_code == 403
        fetch.return_value = (b'<html>', 'text/html')
        assert client.get('/api/incoming-materials/report', params={'path': path, 'accessToken': token}).status_code == 502
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_admin_only_status_blocks_all_incoming_endpoints_for_users(incoming_status):
    incoming_status['incoming-materials'] = 'admin-only'
    user = {'role': 'user', 'dashboardPermissions': ['incoming-materials'], 'basePermissions': None}
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        client = TestClient(app)
        for url in ('/api/incoming-materials/realtime', '/api/incoming-materials/image?path=x', '/api/incoming-materials/report?path=x'):
            assert client.get(url).status_code == 403
        user['role'] = 'admin'
        assert client.get('/api/incoming-materials/image?path=x').status_code == 400
    finally:
        app.dependency_overrides.pop(get_current_user, None)
