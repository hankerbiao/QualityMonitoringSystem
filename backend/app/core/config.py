"""
Configuration management using pydantic-settings
"""

from functools import lru_cache

from pydantic_settings import BaseSettings


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

    # 本地管理员登录（生产环境应通过环境变量覆盖默认密码）
    DEFAULT_ADMIN_USERNAME: str = "admin"
    DEFAULT_ADMIN_PASSWORD: str = "admin123"

    # OA 登录配置（保留兼容旧回调，前端不再使用）
    # ⚠️ 安全: 以下密钥为代码内兜底值，已落入 git 历史，生产环境必须通过环境变量覆盖，
    #    并立即轮换（revoke）已暴露的密钥。切勿依赖默认值。
    OA_JWT_SECRET: str = "bc3868bfa47ef87440a9e874afaad77c706c6229d08e5bb74f51ab726d072fc4"
    OA_LOGIN_URL: str = "http://10.2.48.65/auth/oa/callback"
    OA_APP_NAME: str = "qualiboard"
    OA_LOGIN_BASE_URL: str = "http://tl.cooacloud.com/springboard_v3/login_proxy"
    SESSION_EXPIRE_DAYS: int = 30
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    JWT_SECRET: str = "default-jwt-secret-change-in-production"

    # CORS 白名单（生产环境必须显式配置，禁止用 "*"）
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    # 告警报表公开链接（免登录签名 token）
    # ⚠️ 安全: 生产环境必须通过环境变量 ALERT_TOKEN_SECRET 覆盖，并立即轮换默认值
    ALERT_TOKEN_SECRET: str = "change-me-alert-report-token-secret-please-override"
    ALERT_TOKEN_TTL_DAYS: int = 7
    # 报表链接指向的前端地址（用于邮件中拼装 URL）
    APP_PUBLIC_BASE_URL: str = "http://localhost:3000"

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

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


@lru_cache
def get_settings() -> Settings:
    """获取配置单例"""
    return Settings()
