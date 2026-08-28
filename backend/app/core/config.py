"""
Configuration management using pydantic-settings
"""

from functools import lru_cache
from typing import Final

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PLACEHOLDER_SECRETS: Final = {
    "change-me",
    "change-me-before-production",
    "change-me-alert-report-token-secret-please-override",
    "default-jwt-secret-change-in-production",
    "your-secret-here",
    "replace-me",
}


class Settings(BaseSettings):
    """应用配置"""

    # 应用基础配置
    APP_NAME: str = "QualiBoard"
    DEBUG: bool = True

    # MongoDB 配置
    MONGODB_URL: str = "mongodb://10.17.154.252:27019"
    MONGODB_DB_NAME: str = "quality_monitoring"
    PROCESS_RECORD_CREDENTIAL_KEY: str = ""

    # API 配置
    API_V1_PREFIX: str = "/api"

    # 本地管理员登录；生产环境必须显式配置
    DEFAULT_ADMIN_USERNAME: str = ""
    DEFAULT_ADMIN_PASSWORD: str = ""

    # OA 登录配置（保留兼容旧回调，前端不再使用）
    OA_JWT_SECRET: str = ""
    OA_LOGIN_URL: str = "http://10.2.48.65/auth/oa/callback"
    OA_APP_NAME: str = "qualiboard"
    OA_LOGIN_BASE_URL: str = "http://tl.cooacloud.com/springboard_v3/login_proxy"
    SESSION_EXPIRE_DAYS: int = 30
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    AUTH_COOKIE_SECURE: bool = False
    JWT_SECRET: str = ""

    # CORS 白名单（生产环境必须显式配置，禁止用 "*"）
    CORS_ORIGINS: list[str] = Field(default_factory=lambda: ["http://localhost:4000"])

    # 告警报表公开链接（免登录签名 token）
    ALERT_TOKEN_SECRET: str = ""
    ALERT_TOKEN_TTL_DAYS: int = 7
    # 报表链接指向的前端地址（用于邮件中拼装 URL）
    APP_PUBLIC_BASE_URL: str = "http://localhost:4000"

    # 邮件代理地址（中间件转发，用于发送告警邮件）
    # 默认地址由运维提供；如环境变化可通过环境变量 MAIL_PROXY_URL 覆盖。
    MAIL_PROXY_URL: str = "http://10.32.129.1/springboard_v3/mail_proxy/buqualiboard"

    # 日志配置
    LOG_DIR: str = "logs"
    LOG_LEVEL: str = "INFO"
    LOG_ROTATION: str = "500 MB"
    LOG_RETENTION: str = "30 days"
    LOG_COMPRESSION: str = "zip"
    LOG_JSON_FORMAT: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        # HANA variables in backend/.env are consumed by scripts/sync_views.py.
        extra="ignore",
    )


def validate_security_settings(settings: Settings) -> None:
    """Validate credentials that must be explicit in non-debug deployments."""
    if settings.DEBUG:
        return

    required_secrets = {
        "JWT_SECRET": settings.JWT_SECRET,
        "OA_JWT_SECRET": settings.OA_JWT_SECRET,
        "ALERT_TOKEN_SECRET": settings.ALERT_TOKEN_SECRET,
        "DEFAULT_ADMIN_PASSWORD": settings.DEFAULT_ADMIN_PASSWORD,
    }
    invalid = [name for name, value in required_secrets.items() if _is_weak_secret(value, name)]
    if invalid:
        names = ", ".join(invalid)
        raise RuntimeError(f"生产环境必须配置强安全凭据: {names}")


def _is_weak_secret(value: str, name: str) -> bool:
    normalized = value.strip().lower()
    if not normalized or normalized in PLACEHOLDER_SECRETS:
        return True
    if name == "DEFAULT_ADMIN_PASSWORD":
        return normalized in {"admin", "admin123", "password", "changeme"} or len(value) < 12
    return len(value) < 32


@lru_cache
def get_settings() -> Settings:
    """获取配置单例"""
    return Settings()
