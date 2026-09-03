"""Application infrastructure lifecycle helpers."""

from datetime import datetime
from typing import Any

from app.core.config import Settings
from app.core.logger import log_error, log_info, setup_logger
from app.db.mongodb import close_mongo_connection, connect_to_mongo
from app.services.data_gateway_client import data_gateway
from app.services.process_record_service import process_record_gateway
from app.services.weekly_alert import run_weekly_production_check


def configure_logging(settings: Settings) -> Any:
    """Configure application and audit sinks, returning the audit logger."""
    audit_logger = setup_logger(
        log_dir=settings.LOG_DIR,
        level=settings.LOG_LEVEL,
        rotation=settings.LOG_ROTATION,
        retention=settings.LOG_RETENTION,
        compression=settings.LOG_COMPRESSION,
        json_format=settings.LOG_JSON_FORMAT,
    )
    from app.core import logger as logger_module

    logger_module.audit_logger = audit_logger
    return audit_logger


def log_startup(settings: Settings) -> None:
    log_info("=" * 60)
    log_info("QualiBoard API 启动中...")
    log_info(f"调试模式: {settings.DEBUG}")
    log_info(f"日志级别: {settings.LOG_LEVEL}")
    log_info(f"日志目录: {settings.LOG_DIR}")


def create_scheduler() -> Any | None:
    """Create and start alert jobs; a scheduler failure must not stop HTTP."""
    scheduler: Any | None = None
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler

        scheduler = AsyncIOScheduler()
        scheduler.add_job(
            run_weekly_production_check,
            "cron",
            hour=17,
            minute=0,
            id="weekly_production_alert",
            replace_existing=True,
        )
        from app.api.lrr import warm_default_lrr_list_cache

        scheduler.add_job(
            warm_default_lrr_list_cache,
            "interval",
            minutes=15,
            id="lrr_default_cache_prewarm",
            replace_existing=True,
            next_run_time=datetime.now(),
        )
        scheduler.start()
        log_info("APScheduler 已启动：预警任务和 LRR 默认缓存预热已注册")
        return scheduler
    except Exception as exc:
        log_error(f"APScheduler 启动失败，定时预警将不会自动执行: {exc}")
        if scheduler is not None:
            try:
                scheduler.shutdown(wait=False)
            except Exception as shutdown_exc:
                log_error(f"APScheduler 启动回滚失败: {shutdown_exc}")
        return None


def shutdown_scheduler(scheduler: Any | None) -> None:
    if scheduler is None:
        return
    try:
        scheduler.shutdown(wait=False)
        log_info("APScheduler 已关闭")
    except Exception as exc:
        log_error(f"APScheduler 关闭异常: {exc}")


async def startup_infrastructure(settings: Settings) -> Any | None:
    configure_logging(settings)
    log_startup(settings)
    await connect_to_mongo()
    log_info("MongoDB 连接成功")
    return create_scheduler()


async def shutdown_infrastructure(scheduler: Any | None) -> None:
    shutdown_scheduler(scheduler)
    log_info("关闭 MongoDB 连接...")
    await process_record_gateway.close()
    await data_gateway.close()
    await close_mongo_connection()
    log_info("QualiBoard API 已关闭")
    log_info("=" * 60)
