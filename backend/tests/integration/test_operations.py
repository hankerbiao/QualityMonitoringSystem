"""运营监控接口集成测试。"""

from datetime import datetime, timezone

import pytest


@pytest.mark.integration
class TestOperationsDashboard:
    async def test_requires_authentication(self, client):
        response = await client.get("/api/operations/dashboard?days=30")
        assert response.status_code == 401

    async def test_user_can_report_but_cannot_read_dashboard(self, client, db_clean, make_test_access_token):
        await db_clean.users.insert_one(
            {"username": "bob", "itcode": "bob", "role": "user", "isActive": True}
        )
        headers = {"Authorization": f"Bearer {make_test_access_token('bob')}"}
        response = await client.post(
            "/api/operations/events", headers=headers,
            json={"event_type": "page_view", "path": "/mfr"},
        )
        assert response.status_code == 204
        assert (await db_clean.usage_events.find_one({"itcode": "bob"}))["module"] == "mfr"
        assert (await client.get("/api/operations/dashboard", headers=headers)).status_code == 403

    async def test_historical_paths_and_paginated_activity(self, client, db_clean, make_test_access_token):
        now = datetime.now(timezone.utc)
        await db_clean.users.insert_one(
            {"username": "alice", "itcode": "alice", "role": "admin", "isActive": True}
        )
        for path in ("/station-pass-rate", "/repair-quality", "/mfr", "/reinsert-rate"):
            await db_clean.usage_events.insert_one({
                "eventType": "page_view", "itcode": "alice", "module": "other",
                "path": path, "timestamp": now,
            })
        await db_clean.usage_events.insert_one({
            "eventType": "api_request", "itcode": "alice", "module": "rty",
            "path": "/api/rty/repair-quality", "statusCode": 200, "timestamp": now,
        })
        headers = {"Authorization": f"Bearer {make_test_access_token('alice')}"}
        response = await client.get(
            "/api/operations/dashboard?days=30&activityPage=2&activityPageSize=2", headers=headers,
        )
        assert response.status_code == 200
        data = response.json()
        modules = {item["key"]: item for item in data["modules"]}
        for key in ("station-pass-rate", "repair-quality", "mfr", "reinsert-rate"):
            assert modules[key]["pageViews"] == 1
        assert modules["repair-quality"]["apiRequests"] == 1
        assert data["activityTotal"] == 4
        assert len(data["recentActivity"]) == 2
        assert all(item["module"] != "其他功能" for item in data["recentActivity"])

    async def test_tracks_and_aggregates_usage(self, client, db_clean, make_test_access_token):
        now = datetime.now(timezone.utc)
        token = make_test_access_token("alice")
        headers = {"Authorization": f"Bearer {token}"}

        await db_clean.users.insert_one(
            {
                "username": "alice",
                "itcode": "alice",
                "role": "admin",
                "isActive": True,
                "profile": {"itcode": "alice", "name": "Alice Zhang", "role": "admin"},
                "createdAt": now.isoformat(),
            }
        )
        await db_clean.sessions.insert_one(
            {
                "sessionId": "sess_test_alice",
                "itcode": "alice",
                "createdAt": now.isoformat(),
            }
        )

        track_response = await client.post(
            "/api/operations/events",
            headers=headers,
            json={"event_type": "page_view", "path": "/rty"},
        )
        assert track_response.status_code == 204
        home_response = await client.post(
            "/api/operations/events",
            headers=headers,
            json={"event_type": "page_view", "path": "/"},
        )
        assert home_response.status_code == 204
        await db_clean.usage_events.insert_one(
            {
                "eventType": "page_view",
                "itcode": "alice",
                "module": "home",
                "path": "/",
                "statusCode": 200,
                "timestamp": now,
            }
        )

        response = await client.get("/api/operations/dashboard?days=30", headers=headers)
        assert response.status_code == 200
        data = response.json()

        assert data["summary"]["activeUsers"] == 1
        assert data["summary"]["visits"] == 1
        assert data["summary"]["pageViews"] == 1
        assert data["summary"]["totalUsers"] == 1
        assert data["modules"][0]["key"] == "rty"
        assert data["modules"][0]["pageViews"] == 1
        assert data["recentActivity"][0]["displayName"] == "Alice Zhang"
        assert all(item["module"] != "系统首页" for item in data["recentActivity"])
        assert await db_clean.usage_events.count_documents({}) == 2

    async def test_rejects_invalid_period(self, client):
        # The operations dashboard is administrator-only.
        admin_token = (
            await client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        ).json()["access_token"]
        response = await client.get(
            "/api/operations/dashboard?days=365",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert response.status_code == 422

    async def test_reports_sync_data_sources(self, client, monkeypatch):
        from app.services import operations_service

        await client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        headers = {
            "Authorization": f"Bearer {(await client.post('/api/auth/login', json={'username': 'admin', 'password': 'admin123'})).json()['access_token']}"
        }

        async def data_status():
            return {
                "salesOrdersLastSyncedAt": "2026-08-26T02:30:00Z",
                "faultsLastSyncedAt": "2026-08-25T01:00:00Z",
                "stationRecordsLastSyncedAt": "2026-08-25T02:00:00Z",
                "serialBindingsLastSyncedAt": "2026-08-25T03:00:00Z",
                "bomPostingsLastSyncedAt": "2026-08-25T04:00:00Z",
                "scsDoaLastSyncedAt": "2026-08-24T05:00:00Z",
                "scsChangeLastSyncedAt": "2026-08-24T06:00:00Z",
            }

        monkeypatch.setattr(operations_service.data_gateway, "data_status", data_status)

        response = await client.get("/api/operations/dashboard?days=30", headers=headers)
        assert response.status_code == 200
        sources = {item["key"]: item for item in response.json()["syncDataSources"]}
        assert sources["sales-orders"]["lastSyncedAt"] == "2026-08-26T02:30:00Z"
        assert sources["hana-station"]["lastSyncedAt"] == "2026-08-25T02:00:00Z"
        assert sources["scs-doa"]["lastSyncedAt"] == "2026-08-24T05:00:00Z"
        assert sources["scs-change"]["lastSyncedAt"] == "2026-08-24T06:00:00Z"
        assert all(source["collection"] == "" for source in sources.values())
