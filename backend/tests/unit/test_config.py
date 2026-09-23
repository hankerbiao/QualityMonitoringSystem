from app.core.config import Settings, validate_security_settings


def _production_settings(**overrides) -> Settings:
    values = {
        "DEBUG": False,
        "JWT_SECRET": "j" * 32,
        "ALERT_TOKEN_SECRET": "a" * 32,
        "DEFAULT_ADMIN_USERNAME": "admin",
        "DEFAULT_ADMIN_PASSWORD": "a" * 16,
        "DATA_GATEWAY_URL": "http://gateway.test",
    }
    values.update(overrides)
    return Settings(**values)


def test_production_security_settings_accept_explicit_values():
    validate_security_settings(_production_settings())


def test_production_security_settings_reject_missing_secret():
    settings = _production_settings(JWT_SECRET="")

    try:
        validate_security_settings(settings)
    except RuntimeError as exc:
        assert "JWT_SECRET" in str(exc)
    else:
        raise AssertionError("missing JWT secret must fail production validation")


def test_production_security_settings_reject_default_admin_password():
    settings = _production_settings(DEFAULT_ADMIN_PASSWORD="admin123")

    try:
        validate_security_settings(settings)
    except RuntimeError as exc:
        assert "DEFAULT_ADMIN_PASSWORD" in str(exc)
    else:
        raise AssertionError("default admin password must fail production validation")


def test_production_security_settings_reject_missing_admin_username():
    settings = _production_settings(DEFAULT_ADMIN_USERNAME="")

    try:
        validate_security_settings(settings)
    except RuntimeError as exc:
        assert "DEFAULT_ADMIN_USERNAME" in str(exc)
    else:
        raise AssertionError("missing admin username must fail production validation")


def test_settings_reject_missing_data_gateway_url():
    try:
        validate_security_settings(_production_settings(DATA_GATEWAY_URL=""))
    except RuntimeError as exc:
        assert "DATA_GATEWAY_URL" in str(exc)
    else:
        raise AssertionError("missing gateway URL must fail validation")


def test_settings_ignores_hana_sync_variables():
    settings = Settings(HANA_ADDRESS="hana.internal", HANA_USER="sync_user")

    assert settings.MONGODB_DB_NAME == "quality_monitoring"


def test_data_gateway_timeout_default_allows_slow_production_queries():
    settings = _production_settings()

    assert settings.DATA_GATEWAY_TIMEOUT_SECONDS == 120.0
