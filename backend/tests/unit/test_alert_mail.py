from app.schemas.alert_report import AlertContext, AlertReportData, AlertReportSummary
from app.services.alert_mail import build_alert_email_html, build_test_email_html
from app.services.alert_mail_support import parse_emails, target_from_config


def test_parse_emails_accepts_ui_delimiters_and_drops_invalid_values():
    assert parse_emails("a@example.com; b@example.com,invalid") == [
        "a@example.com",
        "b@example.com",
    ]


def test_target_from_missing_config_uses_legacy_recipients():
    target = target_from_config(None)
    assert target.enabled is True
    assert target.recipients


def test_alert_template_escapes_report_values():
    report = AlertReportData(
        context=AlertContext(title="<unsafe>"),
        summary=AlertReportSummary(productModel="<model>"),
    )
    html = build_alert_email_html(report, "https://example.test/report")
    assert "&lt;unsafe&gt;" in html
    assert "<unsafe>" not in html


def test_test_email_template_preserves_beijing_time_text():
    html = build_test_email_html(sent_at="2026-10-26 16:30")
    assert "发送时间：2026-10-26 16:30" in html
