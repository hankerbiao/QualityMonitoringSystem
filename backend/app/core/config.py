"""
Configuration management using pydantic-settings
"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """应用配置"""

    # 应用基础配置
    APP_NAME: str = "QualiBoard"
    DEBUG: bool = True

    # MongoDB 配置
    MONGODB_URL: str = "mongodb://10.17.154.252:27017"
    MONGODB_DB_NAME: str = "quality_monitoring"

    # API 配置
    API_V1_PREFIX: str = "/api"

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


@lru_cache()
def get_settings() -> Settings:
    """获取配置单例"""
    return Settings()