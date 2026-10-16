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
        assert "无法解密" in response.json()["detail"]
        assert "管理员" in response.json()["detail"]


@pytest.mark.integration
class TestModelTargets:
    """Tests for model targets CRUD"""

    async def test_template_models_include_all_source_scopes_without_date_filters(
        self, client, monkeypatch
    ):
        from unittest.mock import AsyncMock

        from app.services.data_gateway_client import data_gateway

        loader = AsyncMock(return_value={"items": ["Normal", " L6 ", "Historical", "Normal", " "]})
        orders = AsyncMock(side_effect=AssertionError("Template must not paginate orders"))
        monkeypatch.setattr(data_gateway, "request_json", loader)
        monkeypatch.setattr(data_gateway, "all_orders", orders)
        response = await client.get("/api/settings/model-targets/models")
        assert response.status_code == 200
        assert response.json()["data"] == ["Historical", "L6", "Normal"]
        loader.assert_awaited_once_with("GET", "/api/orders/models")
        orders.assert_not_awaited()

    @pytest.mark.parametrize(
        "targets",
        [
            {"": 99},
            {" M ": 99, "M": 98},
            {"M": -1},
            {"M": 101},
            {"M": True},
        ],
    )
    async def test_unified_save_rejects_invalid_imported_targets_before_writing(
        self, client, db_clean, targets
    ):
        response = await client.put("/api/settings", json={"modelTargets": targets})
        assert response.status_code == 422
        assert await db_clean.configs.find_one({"key": "model_targets"}) is None

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


@pytest.fixture
async def ordinary_user_headers(client):
    created = await client.post(
        "/api/admin/users",
        json={
            "username": "settings-user",
            "displayName": "Settings User",
            "password": "initial-password",
            "dashboardPermissions": [],
        },
    )
    assert created.status_code == 201
    login = await client.post(
        "/api/auth/login",
        json={"username": "settings-user", "password": "initial-password"},
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.integration
class TestOrdinaryUserSettings:
    async def test_template_source_models_are_accessible_without_dashboard_permissions(
        self, client, ordinary_user_headers, monkeypatch
    ):
        from unittest.mock import AsyncMock

        from app.services.data_gateway_client import data_gateway

        monkeypatch.setattr(data_gateway, "order_models", AsyncMock(return_value=["M"]))
        response = await client.get(
            "/api/settings/model-targets/models", headers=ordinary_user_headers
        )
        assert response.status_code == 200
        assert response.json()["data"] == ["M"]

    async def test_reads_quality_and_shared_station_settings(self, client, ordinary_user_headers):
        await client.put(
            "/api/settings",
            json={
                "processRecords": {"username": "private-source", "password": "secret"},
                "modelTargets": {"X1": 98.5},
                "emailAlert": {"emails": "quality@company.com"},
                "cycleStatsConfig": {"selectedModels": ["private-model"]},
                "stationPassRateConfig": {"selectedStations": ["OP10"]},
            },
        )
        response = await client.get("/api/settings", headers=ordinary_user_headers)
        assert response.status_code == 200
        data = response.json()["data"]
        assert set(data) == {"modelTargets", "emailAlert", "stationPassRateConfig"}
        assert data["stationPassRateConfig"] == {
            "selectedStations": ["OP10"],
            "configured": True,
        }
        assert data["modelTargets"] == {"X1": 98.5}
        assert data["emailAlert"]["emails"] == "quality@company.com"
        assert "private-source" not in response.text
        assert "private-model" not in response.text

    async def test_saves_allowed_sections_without_changing_admin_settings(
        self, client, db_clean, ordinary_user_headers
    ):
        await client.put(
            "/api/settings",
            json={
                "processRecords": {"username": "private-source", "password": "secret"},
                "dashboardStatuses": {"doa": "planned"},
            },
        )
        before = await db_clean.configs.find_one({"key": "process_record_config"})
        response = await client.put(
            "/api/settings",
            headers=ordinary_user_headers,
            json={
                "modelTargets": {"X1": 99},
                "emailAlert": {
                    "enabled": False,
                    "emails": "quality@company.com",
                    "weeklyProductionThreshold": 100,
                },
            },
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert set(data) == {"modelTargets", "emailAlert", "stationPassRateConfig"}
        assert data["modelTargets"] == {"X1": 99}
        assert data["emailAlert"]["weeklyProductionThreshold"] == 100
        assert data["emailAlert"]["enabled"] is False
        assert await db_clean.configs.find_one({"key": "process_record_config"}) == before
        admin_data = (await client.get("/api/settings")).json()["data"]
        assert admin_data["modelTargets"] == {"X1": 99}
        assert admin_data["dashboardStatuses"]["doa"] == "planned"

    @pytest.mark.parametrize(
        "forbidden_section",
        [
            {"processRecords": {"username": "changed"}},
            {"dashboardStatuses": {"doa": "available"}},
            {"cycleStatsConfig": {"selectedModels": ["X1"]}},
            {"stationPassRateConfig": {"selectedStations": ["OP10"]}},
            {"processRecords": None},
        ],
    )
    async def test_rejects_admin_fields_before_writing_anything(
        self, client, db_clean, ordinary_user_headers, forbidden_section
    ):
        response = await client.put(
            "/api/settings",
            headers=ordinary_user_headers,
            json={"modelTargets": {"must-not-save": 99}, **forbidden_section},
        )
        assert response.status_code == 403
        assert await db_clean.configs.find_one({"key": "model_targets"}) is None

    @pytest.mark.parametrize(
        ("method", "path", "payload"),
        [
            ("get", "/api/settings/process-records", None),
            ("put", "/api/settings/process-records", {"username": "changed"}),
            ("post", "/api/settings/process-records/test", {}),
            ("get", "/api/settings/cycle-stats-config", None),
            ("put", "/api/settings/cycle-stats-config", {"selectedModels": ["X1"]}),
            ("post", "/api/settings/email-alert/run-weekly-check", None),
            ("get", "/api/admin/users", None),
        ],
    )
    async def test_cannot_use_other_configuration_endpoints(
        self, client, ordinary_user_headers, method, path, payload
    ):
        kwargs = {"headers": ordinary_user_headers}
        if payload is not None:
            kwargs["json"] = payload
        assert (await client.request(method, path, **kwargs)).status_code == 403

    async def test_model_and_email_pages_support_section_endpoints(
        self, client, ordinary_user_headers, monkeypatch
    ):
        from app.api import settings

        response = await client.put(
            "/api/settings/model-targets", headers=ordinary_user_headers, json={"X1": 98}
        )
        assert response.status_code == 200
        assert (
            await client.get("/api/settings/model-targets", headers=ordinary_user_headers)
        ).json()["data"]["items"] == {"X1": 98}
        assert (
            await client.post(
                "/api/settings/model-targets/X2?targetRate=99", headers=ordinary_user_headers
            )
        ).status_code == 200
        assert (
            await client.delete("/api/settings/model-targets/X2", headers=ordinary_user_headers)
        ).status_code == 200
        assert (
            await client.put(
                "/api/settings/email-alert",
                headers=ordinary_user_headers,
                json={"emails": "quality@company.com"},
            )
        ).status_code == 200
        assert (
            await client.get("/api/settings/email-alert", headers=ordinary_user_headers)
        ).json()["data"]["emails"] == "quality@company.com"

        async def candidates(threshold):
            return {"threshold": threshold, "modelsChecked": 0, "details": []}

        monkeypatch.setattr(settings, "get_weekly_production_candidates", candidates)
        response = await client.get(
            "/api/settings/email-alert/qualified-models?threshold=100",
            headers=ordinary_user_headers,
        )
        assert response.status_code == 200
        assert response.json()["data"]["threshold"] == 100

    @pytest.mark.parametrize(
        ("method", "path", "payload"),
        [
            ("get", "/api/settings", None),
            ("put", "/api/settings", {"modelTargets": {"X1": 99}}),
            ("get", "/api/settings/model-targets", None),
            ("get", "/api/settings/model-targets/models", None),
            ("put", "/api/settings/email-alert", {"enabled": False}),
            ("get", "/api/settings/email-alert/qualified-models?threshold=50", None),
        ],
    )
    async def test_anonymous_users_cannot_access_settings(self, client, method, path, payload):
        client.headers.pop("Authorization")
        kwargs = {"json": payload} if payload is not None else {}
        assert (await client.request(method, path, **kwargs)).status_code == 401
