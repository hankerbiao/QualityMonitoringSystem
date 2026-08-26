"""
Unit tests for Pydantic schema validation
"""

import pytest
from pydantic import ValidationError

from app.schemas.ai import AIConfig, AIMessage, ChatRequest, RTYContext
from app.schemas.rty import RTYData
from app.schemas.settings import (
    AIConfigSchema,
    AIConfigUpdate,
    EmailAlertConfig,
    EmailAlertConfigUpdate,
    FeatureFlags,
    FeatureFlagsUpdate,
    ModelTargetBase,
    ModelTargetsResponse,
    SettingsUpdateRequest,
)

# ─── RTY Schemas ─────────────────────────────────────────────────────────────


class TestRTYData:
    def test_valid_rty_data(self):
        data = RTYData(
            id="abc123",
            time="2026-06-01",
            model="普通机型",
            productModel="6210 C21",
            base="天津",
            defectCount=10,
            inputCount=1000,
            rtyRate=99.0,
            targetRate=99.0,
        )
        assert data.defectCount == 10
        assert data.rtyRate == 99.0

    def test_optional_fields_defaults(self):
        data = RTYData(
            id="abc",
            time="2026-06-01",
            model="普通机型",
            productModel="X",
            base="天津",
            defectCount=0,
            inputCount=100,
            rtyRate=100.0,
            targetRate=99.0,
        )
        assert data.salesOrder == ""
        assert data.status == ""
        assert data.customer == ""


# ─── Model Target Schemas ────────────────────────────────────────────────────


class TestModelTarget:
    def test_valid_target_rate(self):
        target = ModelTargetBase(model="6210 C21", targetRate=99.5)
        assert target.targetRate == 99.5

    def test_boundary_values_accepted(self):
        # 0 and 100 are valid
        low = ModelTargetBase(model="A", targetRate=0.0)
        high = ModelTargetBase(model="B", targetRate=100.0)
        assert low.targetRate == 0.0
        assert high.targetRate == 100.0

    def test_rate_below_zero_rejected(self):
        with pytest.raises(ValidationError):
            ModelTargetBase(model="Bad", targetRate=-0.1)

    def test_rate_above_100_rejected(self):
        with pytest.raises(ValidationError):
            ModelTargetBase(model="Bad", targetRate=100.1)


class TestModelTargetsResponse:
    def test_empty_dict_default(self):
        resp = ModelTargetsResponse()
        assert resp.items == {}

    def test_dict_mapping(self):
        resp = ModelTargetsResponse(items={"6210 C21": 99.0, "6410 X21": 98.5})
        assert resp.items["6210 C21"] == 99.0
        assert resp.items["6410 X21"] == 98.5


# ─── Email Alert Schemas ─────────────────────────────────────────────────────


class TestEmailAlertConfig:
    def test_valid_config(self):
        config = EmailAlertConfig(
            enabled=True,
            emails="alice@example.com; bob@example.com",
            attachReport=True,
        )
        assert config.enabled is True
        assert "alice" in config.emails

    def test_email_alert_update_partial(self):
        update = EmailAlertConfigUpdate(enabled=False)
        assert update.enabled is False
        assert update.emails is None


# ─── Feature Flags Schemas ───────────────────────────────────────────────────


class TestFeatureFlags:
    def test_defaults(self):
        flags = FeatureFlags()
        assert flags.voiceInputEnabled is False

    def test_update_partial(self):
        update = FeatureFlagsUpdate(voiceInputEnabled=True)
        assert update.voiceInputEnabled is True


# ─── AI Config Schemas ───────────────────────────────────────────────────────


class TestAIConfigSchema:
    def test_defaults(self):
        ai = AIConfigSchema()
        assert ai.apiUrl == ""
        assert ai.modelId == ""
        assert ai.apiKey == ""
        assert ai.maxTokens == 4096

    def test_max_tokens_boundary(self):
        ai = AIConfigSchema(maxTokens=1)
        assert ai.maxTokens == 1

    def test_max_tokens_too_large_rejected(self):
        with pytest.raises(ValidationError):
            AIConfigSchema(maxTokens=32769)

    def test_update_partial(self):
        update = AIConfigUpdate(apiUrl="https://api.example.com", maxTokens=8192)
        assert update.apiUrl == "https://api.example.com"
        assert update.modelId is None


# ─── Settings Update Request ─────────────────────────────────────────────────


class TestSettingsUpdateRequest:
    def test_partial_update_ai_only(self):
        req = SettingsUpdateRequest(
            ai=AIConfigUpdate(apiUrl="https://api.example.com/v1/chat/completions")
        )
        assert req.ai is not None
        assert req.ai.apiUrl == "https://api.example.com/v1/chat/completions"
        assert req.processRecords is None

    def test_partial_update_model_targets(self):
        req = SettingsUpdateRequest(modelTargets={"6210 C21": 99.0, "6410 X21": 98.5})
        assert req.modelTargets == {"6210 C21": 99.0, "6410 X21": 98.5}


# ─── AI Request Schemas ──────────────────────────────────────────────────────


class TestChatRequest:
    def test_valid_chat_request(self):
        req = ChatRequest(
            config=AIConfig(
                apiUrl="https://api.example.com/v1/chat/completions",
                modelId="gpt-4o-mini",
                apiKey="sk-test",
                maxTokens=4096,
            ),
            messages=[
                AIMessage(role="user", content="分析本月 RTY 趋势"),
            ],
            context=RTYContext(totalInput=5000, totalDefect=50, avgRty=99.0),
        )
        assert req.config.modelId == "gpt-4o-mini"
        assert len(req.messages) == 1
        assert req.context.totalInput == 5000

    def test_invalid_message_role(self):
        with pytest.raises(ValidationError):
            AIMessage(role="invalid_role", content="hello")

    def test_valid_roles(self):
        for role in ("system", "user", "assistant"):
            msg = AIMessage(role=role, content="test")
            assert msg.role == role
