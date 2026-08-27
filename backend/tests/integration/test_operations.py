"""运营监控接口集成测试。"""

from datetime import datetime, timezone

import pytest


@pytest.mark.integration
class TestOperationsDashboard:
    async def test_requires_authentication(self, client):
        response = await client.get("/api/operations/dashboard?days=30")
        assert response.status_code == 401

    async def test_tracks_and_aggregates_usage(self, client, db_clean, make_test_access_token):
        now = datetime.now(timezone.utc)
        token = make_test_access_token("alice")
        headers = {"Authorization": f"Bearer {token}"}

        await db_clean.users.insert_one(
            {
                "itcode": "alice",
                "profile": {"itcode": "alice", "name": "Alice Zhang"},
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

    async def test_rejects_invalid_period(self, client, make_test_access_token):
        token = make_test_access_token("alice")
        response = await client.get(
            "/api/operations/dashboard?days=365",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 422

    async def test_reports_sync_data_sources(self, client, db_clean, make_test_access_token):
        now = datetime.now(timezone.utc)
        token = make_test_access_token("alice")
        headers = {"Authorization": f"Bearer {token}"}
        await db_clean.rty_sync_checkpoints.insert_one(
            {
                "_id": "sales_orders:SG",
                "source": "sales_orders",
                "source_name": "SG",
                "last_success_date": "2026-08-26",
                "updated_at": now,
            }
        )
        await db_clean.sales_orders_sap.insert_one(
            {
                "aufnr": "000000000001",
                "source_records": {"KK": {"fetched_at": "2026-08-26T02:30:00Z"}},
            }
        )
        await db_clean._hana_sync_checkpoints.insert_one(
            {
                "_id": "Z_V_ZMES_T_001",
                "view_id": "Z_V_ZMES_T_001",
                "collection": "station_records_sap",
                "watermark": "2026-08-25",
                "updated_at": now,
            }
        )
        await db_clean.scs_doa_incremental_progress.insert_one(
            {
                "_id": "scs_doa_incremental",
                "last_success_at": now,
                "watermark_date": "2026-08-24",
            }
        )

        response = await client.get("/api/operations/dashboard?days=30", headers=headers)
        assert response.status_code == 200
        sources = {item["key"]: item for item in response.json()["syncDataSources"]}
        assert sources["sales-orders-sg"]["lastSyncedAt"] is not None
        assert sources["sales-orders-sg"]["latestDataAt"] == "2026-08-26"
        assert sources["sales-orders-kk"]["lastSyncedAt"] == "2026-08-26T02:30:00Z"
        assert sources["hana-z_v_zmes_t_001"]["collection"] == "station_records_sap"
        assert sources["hana-z_v_zmes_t_001"]["latestDataAt"] == "2026-08-25"
        assert sources["scs-doa"]["latestDataAt"] == "2026-08-24"
