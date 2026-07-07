"""
QualiBoard 品质看板 Backend - FastAPI Application
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import rty, settings, ai, auth
from app.core.config import get_settings
from app.core.logger import setup_logger, log_info, log_warning, log_error
from app.db.mongodb import connect_to_mongo, close_mongo_connection


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 初始化日志系统
    global audit_logger
    app_settings = get_settings()
    audit_logger = setup_logger(
        log_dir=app_settings.LOG_DIR,
        level=app_settings.LOG_LEVEL,
        rotation=app_settings.LOG_ROTATION,
        retention=app_settings.LOG_RETENTION,
        compression=app_settings.LOG_COMPRESSION,
        json_format=app_settings.LOG_JSON_FORMAT,
    )

    # 导入审计日志器供其他模块使用
    from app.core import logger as logger_module
    logger_module.audit_logger = audit_logger

    log_info("=" * 60)
    log_info(f"QualiBoard API 启动中...")
    log_info(f"调试模式: {app_settings.DEBUG}")
    log_info(f"日志级别: {app_settings.LOG_LEVEL}")
    log_info(f"日志目录: {app_settings.LOG_DIR}")

    await connect_to_mongo()
    log_info("MongoDB 连接成功")

    yield

    # 关闭阶段
    log_info("关闭 MongoDB 连接...")
    await close_mongo_connection()
    log_info("QualiBoard API 已关闭")
    log_info("=" * 60)


app = FastAPI(
    title="QualiBoard API",
    description="QualiBoard 品质看板后端 API，支持 RTY/LRR/DOA/MFR 数据管理",
    version="1.0.0",
    docs_url="/docs" if get_settings().DEBUG else None,
    redoc_url="/redoc" if get_settings().DEBUG else None,
    lifespan=lifespan,
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 注册路由
app.include_router(rty.router, prefix="/api/rty", tags=["RTY"])
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(ai.router, prefix="/api/ai", tags=["AI"])
app.include_router(auth.router, prefix="/api", tags=["Auth"])


@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {"status": "healthy", "version": "1.0.0"}


# 全局审计日志器
audit_logger = None


def run():
    """运行服务器"""
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=get_settings().DEBUG,
    )