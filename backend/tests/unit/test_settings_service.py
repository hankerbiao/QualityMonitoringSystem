from app.services.settings_service import SettingsService


def test_legacy_dashboard_status_remains_restricted():
    result = SettingsService.dashboard_statuses_from_doc(
        {"statuses": {"doa": "planned", "mfr": "available"}}
    )
    assert result["doa"] == "admin-only"
    assert result["mfr"] == "available"
    assert SettingsService.dashboard_statuses_from_doc(None)["doa"] == "available"


def test_email_from_doc_generates_rule_description_for_a_custom_threshold():
    config = SettingsService.email_from_doc(
        {
            "enabled": True,
            "emails": "qa@example.com",
            "weeklyProductionThreshold": 25,
        }
    )

    assert config.weeklyProductionThreshold == 25
    assert config.triggerCondition == (
        "当某机型周生产量达到设定阈值（当前 25 台），且实际 RTY 低于目标直通率时，"
        "系统将在每天 17:00 自动发送预警邮件。"
    )


def test_email_from_doc_preserves_a_user_written_description():
    config = SettingsService.email_from_doc(
        {
            "weeklyProductionThreshold": 25,
            "triggerCondition": "仅在重点机型未达标时通知质量负责人。",
        }
    )

    assert config.triggerCondition == "仅在重点机型未达标时通知质量负责人。"
