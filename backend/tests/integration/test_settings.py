"""
Integration tests for Settings API endpoints
"""

import pytest


@pytest.fixture(autouse=True)
async def authenticate_as_admin(client):
    response = await client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin123"}
    )
    client.headers.update({"Authorization": f"Bearer {response.json()['access_token']}"})


@pytest.mark.integration
class TestGetAllSettings:
    """Tests for GET /api/settings"""

    async def test_empty_db_returns_defaults(self, client, db_clean):
        """No configs in DB should return default values."""
        response = await client.get("/api/settings")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["processRecords"]["username"] == ""
        assert data["data"]["processRecords"]["hasPassword"] is False
        assert data["data"]["modelTargets"] == {}
        assert data["data"]["emailAlert"]["enabled"] is True
        assert data["data"]["dashboardStatuses"] == {
            "rty": "available",
            "station-pass-rate": "available",
            "lrr": "available",
            "doa": "planned",
            "mfr": "planned",
        }
        assert data["data"]["cycleStatsConfig"]["selectedModels"] == []

    async def test_dashboard_statuses_can_be_updated_and_read_publicly(self, client, db_clean):
        response = await client.put(
            "/api/settings",
            json={"dashboardStatuses": {"doa": "available", "mfr": "planned"}},
        )
        assert response.status_code == 200
        assert response.json()["data"]["dashboardStatuses"]["doa"] == "available"

        public_response = await client.get("/api/settings/dashboard-statuses")
        assert public_response.status_code == 200
        assert public_response.json()["data"]["doa"] == "available"
        assert public_response.json()["data"]["mfr"] == "planned"

    async def test_invalid_dashboard_status_is_rejected(self, client, db_clean):
        response = await client.put(
            "/api/settings",
            json={"dashboardStatuses": {"doa": "released"}},
        )
        assert response.status_code == 422

    async def test_unified_update_includes_cycle_stats_and_keeps_secrets_masked(
        self, client, db_clean
    ):
        response = await client.put(
            "/api/settings",
            json={
                "modelTargets": {"X1": 98.5},
                "cycleStatsConfig": {"selectedModels": ["X1"]},
            },
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["modelTargets"] == {"X1": 98.5}
        assert data["cycleStatsConfig"] == {"selectedModels": ["X1"]}

    async def test_station_pass_rate_config_persists_selected_stations(self, client, db_clean):
        initial = await client.get("/api/settings")
        assert initial.json()["data"]["stationPassRateConfig"] == {
            "selectedStations": [],
            "configured": False,
        }

        response = await client.put(
            "/api/settings",
            json={"stationPassRateConfig": {"selectedStations": ["OP10", "OP20"]}},
        )
        assert response.status_code == 200
        assert response.json()["data"]["stationPassRateConfig"] == {
            "selectedStations": ["OP10", "OP20"],
            "configured": True,
        }

        stored = await db_clean.configs.find_one({"key": "station_pass_rate_config"})
        assert stored["selectedStations"] == ["OP10", "OP20"]

        reread = await client.get("/api/settings")
        assert reread.json()["data"]["stationPassRateConfig"]["selectedStations"] == [
            "OP10",
            "OP20",
        ]

    async def test_removed_feature_flags_are_rejected(self, client, db_clean):
        response = await client.put(
            "/api/settings",
            json={"featureFlags": {"voiceInputEnabled": True}},
        )
        assert response.status_code == 422
        assert "featureFlags" in response.text

    async def test_removed_routes_return_404(self, client, db_clean):
        assert (await client.get("/api/settings/feature-flags")).status_code == 404
        assert (await client.put("/api/settings/feature-flags", json={})).status_code == 404
        assert (await client.get("/api/faults")).status_code == 404


@pytest.mark.integration
class TestProcessRecordConfig:
    """Tests for the shared realtime source credentials."""

    async def test_get_default(self, client, db_clean):
        response = await client.get("/api/settings/process-records")
        assert response.status_code == 200
        assert response.json()["data"] == {"username": "", "hasPassword": False}

    async def test_update_never_returns_password(self, client, db_clean):
        response = await client.put(
            "/api/settings/process-records",
            json={"username": "caokp", "password": "123456"},
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data == {"username": "caokp", "hasPassword": True}
        assert "password" not in data
        stored = await db_clean.configs.find_one({"key": "process_record_config"})
        assert "password" not in stored
        assert stored["passwordCiphertext"] != "123456"

    async def test_empty_password_preserves_stored_password(self, client, db_clean):
        await client.put(
            "/api/settings/process-records",
            json={"username": "caokp", "password": "123456"},
        )
        response = await client.put(
            "/api/settings/process-records",
            json={"username": "new-user", "password": ""},
        )
        assert response.json()["data"] == {"username": "new-user", "hasPassword": True}

    async def test_connection_test_returns_bad_request_for_unreadable_password(
        self, client, db_clean
    ):
        await db_clean.configs.insert_one(
            {
                "key": "process_record_config",
                "username": "caokp",
                "passwordCiphertext": "not-a-valid-fernet-ciphertext",
            }
        )

        response = await client.post("/api/settings/process-records/test")

        assert response.status_code == 400
        assert response.json()["detail"] == "Stored credential cannot be decrypted"


@pytest.mark.integration
class TestModelTargets:
    """Tests for model targets CRUD"""

    async def test_get_empty_model_targets(self, client, db_clean):
        response = await client.get("/api/settings/model-targets")
        assert response.status_code == 200
        assert response.json()["data"]["items"] == {}

    async def test_put_model_targets(self, client, db_clean):
        response = await client.put(
            "/api/settings/model-targets",
            json={"6210 C21": 99.0, "6410 X21": 98.5},
        )
        assert response.status_code == 200
        items = response.json()["data"]["items"]
        assert items["6210 C21"] == 99.0
        assert items["6410 X21"] == 98.5

    async def test_invalid_target_rate_rejected(self, client, db_clean):
        """Rate > 100 should be rejected."""
        response = await client.put(
            "/api/settings/model-targets",
            json={"BadModel": 150.0},
        )
        assert response.status_code == 400

    async def test_negative_target_rate_rejected(self, client, db_clean):
        """Negative rate should be rejected."""
        response = await client.put(
            "/api/settings/model-targets",
            json={"BadModel": -5.0},
        )
        assert response.status_code == 400

    async def test_add_single_model_target(self, client, db_clean):
        response = await client.post(
            "/api/settings/model-targets/6210 C31?targetRate=98.5",
        )
        assert response.status_code == 200
        assert response.json()["data"]["items"]["6210 C31"] == 98.5

    async def test_delete_model_target(self, client, db_clean):
        # First add
        await client.put("/api/settings/model-targets", json={"ToDelete": 99.0})
        # Then delete
        response = await client.delete("/api/settings/model-targets/ToDelete")
        assert response.status_code == 200
        assert "ToDelete" not in response.json()["data"]["items"]

    async def test_delete_nonexistent_model_returns_404(self, client, db_clean):
        response = await client.delete("/api/settings/model-targets/DoesNotExist")
        assert response.status_code == 404


@pytest.mark.integration
class TestEmailAlert:
    """Tests for email alert config"""

    async def test_get_default_email_config(self, client, db_clean):
        response = await client.get("/api/settings/email-alert")
        assert response.status_code == 200
        assert response.json()["data"]["enabled"] is True

    async def test_update_email_alert(self, client, db_clean):
        response = await client.put(
            "/api/settings/email-alert",
            json={"enabled": False, "emails": "qa@company.com", "attachReport": False},
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["enabled"] is False
        assert "qa@company.com" in data["emails"]

    async def test_invalid_email_format_rejected(self, client, db_clean):
        response = await client.put(
            "/api/settings/email-alert",
            json={"emails": "not-an-email"},
        )
        assert response.status_code == 400

    async def test_empty_update_returns_400(self, client, db_clean):
        response = await client.put("/api/settings/email-alert", json={})
        assert response.status_code == 400
