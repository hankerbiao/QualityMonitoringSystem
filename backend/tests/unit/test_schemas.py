"""
Unit tests for Pydantic schema validation
"""

import pytest
from pydantic import ValidationError

from app.schemas.rty import RTYData
from app.schemas.settings import (
    EmailAlertConfig,
    EmailAlertConfigUpdate,
    ModelTargetBase,
    ModelTargetsResponse,
    SettingsUpdateRequest,
    StationPassRateConfig,
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


# ─── Settings Update Request ─────────────────────────────────────────────────


class TestSettingsUpdateRequest:
    def test_partial_update_model_targets(self):
        req = SettingsUpdateRequest(modelTargets={"6210 C21": 99.0, "6410 X21": 98.5})
        assert req.modelTargets == {"6210 C21": 99.0, "6410 X21": 98.5}

    def test_station_pass_rate_config_defaults_to_unconfigured(self):
        config = StationPassRateConfig()
        assert config.selectedStations == []
        assert config.configured is False
