from types import SimpleNamespace

import app.libs.alert_token as alert_token


def test_build_alert_report_url_uses_public_base_path(monkeypatch):
    monkeypatch.setattr(
        alert_token,
        "get_settings",
        lambda: SimpleNamespace(APP_PUBLIC_BASE_URL="https://apps.1oa.com.cn/QualiBoard/"),
    )

    assert (
        alert_token.build_alert_report_url("sample-token")
        == "https://apps.1oa.com.cn/QualiBoard/alert-report/sample-token"
    )
