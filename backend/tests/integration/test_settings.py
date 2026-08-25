"""
Integration tests for Settings API endpoints
"""
import pytest


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
        assert data["data"]["featureFlags"]["voiceInputEnabled"] is False
        assert data["data"]["ai"]["apiUrl"] == ""
        assert data["data"]["cycleStatsConfig"]["selectedModels"] == []

    async def test_unified_update_includes_cycle_stats_and_keeps_secrets_masked(self, client, db_clean):
        response = await client.put(
            "/api/settings",
            json={
                "modelTargets": {"X1": 98.5},
                "cycleStatsConfig": {"selectedModels": ["X1"]},
                "ai": {"apiUrl": "https://example.test", "apiKey": "secret"},
            },
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["modelTargets"] == {"X1": 98.5}
        assert data["cycleStatsConfig"] == {"selectedModels": ["X1"]}
        assert data["ai"]["apiKey"] == ""
        assert data["ai"]["hasApiKey"] is True


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


@pytest.mark.integration
class TestFeatureFlags:
    """Tests for feature flags"""

    async def test_get_default_flags(self, client, db_clean):
        response = await client.get("/api/settings/feature-flags")
        assert response.status_code == 200
        assert response.json()["data"]["voiceInputEnabled"] is False

    async def test_update_feature_flag(self, client, db_clean):
        response = await client.put(
            "/api/settings/feature-flags",
            json={"voiceInputEnabled": True},
        )
        assert response.status_code == 200
        assert response.json()["data"]["voiceInputEnabled"] is True


@pytest.mark.integration
class TestAIConfig:
    """Tests for AI model config"""

    async def test_get_default_ai_config(self, client, db_clean):
        response = await client.get("/api/settings/ai")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["apiUrl"] == ""
        assert data["apiKey"] == ""  # Never returned in plaintext

    async def test_update_ai_config(self, client, db_clean):
        response = await client.put(
            "/api/settings/ai",
            json={
                "apiUrl": "https://api.example.com/v1/chat/completions",
                "modelId": "gpt-4o-mini",
                "apiKey": "sk-secret-key",
                "maxTokens": 8192,
            },
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["apiUrl"] == "https://api.example.com/v1/chat/completions"
        assert data["modelId"] == "gpt-4o-mini"
        assert data["apiKey"] == ""  # Masked
        assert data["hasApiKey"] is True
        assert data["maxTokens"] == 8192

        get_response = await client.get("/api/settings")
        all_ai = get_response.json()["data"]["ai"]
        assert all_ai["apiKey"] == ""
        assert all_ai["hasApiKey"] is True

    async def test_partial_ai_update(self, client, db_clean):
        # Set initial
        await client.put("/api/settings/ai", json={"apiUrl": "https://old.com", "modelId": "old-model"})
        # Update only modelId
        response = await client.put("/api/settings/ai", json={"modelId": "new-model"})
        data = response.json()["data"]
        assert data["apiUrl"] == "https://old.com"
        assert data["modelId"] == "new-model"

    async def test_empty_api_key_preserves_existing_key(self, client, db_clean):
        await client.put(
            "/api/settings/ai",
            json={"apiUrl": "https://api.example.com", "modelId": "model", "apiKey": "secret"},
        )

        single_response = await client.put("/api/settings/ai", json={"apiKey": ""})
        assert single_response.status_code == 200
        assert single_response.json()["data"]["apiKey"] == ""
        assert single_response.json()["data"]["hasApiKey"] is True

        response = await client.put(
            "/api/settings",
            json={"ai": {"apiUrl": "https://api.example.com", "modelId": "new-model", "apiKey": ""}},
        )

        assert response.status_code == 200
        assert response.json()["data"]["ai"]["hasApiKey"] is True
        stored = await db_clean.configs.find_one({"key": "ai_config"})
        assert stored["apiKey"] == "secret"
