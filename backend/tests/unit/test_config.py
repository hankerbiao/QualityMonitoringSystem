from app.core.config import Settings, validate_security_settings


def _production_settings(**overrides) -> Settings:
    values = {
        "DEBUG": False,
        "JWT_SECRET": "j" * 32,
        "OA_JWT_SECRET": "o" * 32,
        "ALERT_TOKEN_SECRET": "a" * 32,
        "DEFAULT_ADMIN_USERNAME": "admin",
        "DEFAULT_ADMIN_PASSWORD": "a" * 16,
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
