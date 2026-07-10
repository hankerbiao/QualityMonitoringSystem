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
        # Default values (MES 缺省时返回空对象而非 null，前端无需判空)
        assert data["data"]["mes"] is not None
        assert data["data"]["mes"]["username"] == ""
        assert data["data"]["mes"]["hasPassword"] is False
        assert data["data"]["modelTargets"] == {}
        assert data["data"]["emailAlert"]["enabled"] is True
        assert data["data"]["featureFlags"]["voiceInputEnabled"] is False
        assert data["data"]["ai"]["apiUrl"] == ""


@pytest.mark.integration
class TestMESConfig:
    """Tests for GET/PUT /api/settings/mes"""

    async def test_get_mes_default(self, client, db_clean):
        response = await client.get("/api/settings/mes")
        assert response.status_code == 200
        assert response.json()["data"]["username"] == ""

    async def test_update_mes_config(self, client, db_clean):
        response = await client.put(
            "/api/settings/mes",
            json={"username": "mes_user", "password": "secret123"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["data"]["username"] == "mes_user"
        # 安全：响应不再返回明文密码，仅以 hasPassword 标识是否已配置
        assert "password" not in data["data"]
        assert data["data"]["hasPassword"] is True

        # Verify round-trip: GET should return updated values
        get_resp = await client.get("/api/settings/mes")
        assert get_resp.json()["data"]["username"] == "mes_user"

    async def test_partial_mes_update(self, client, db_clean):
        # Set initial
        await client.put("/api/settings/mes", json={"username": "old", "password": "pw"})
        # Partial update - only username
        response = await client.put("/api/settings/mes", json={"username": "new"})
        assert response.json()["data"]["username"] == "new"
        # 部分更新只改 username，密码被后端安全护栏忽略，hasPassword 仍为真
        assert response.json()["data"]["hasPassword"] is True


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
        assert data["maxTokens"] == 8192

    async def test_partial_ai_update(self, client, db_clean):
        # Set initial
        await client.put("/api/settings/ai", json={"apiUrl": "https://old.com", "modelId": "old-model"})
        # Update only modelId
        response = await client.put("/api/settings/ai", json={"modelId": "new-model"})
        data = response.json()["data"]
        assert data["apiUrl"] == "https://old.com"
        assert data["modelId"] == "new-model"
