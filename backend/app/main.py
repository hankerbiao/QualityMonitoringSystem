"""
QualiBoard 品质看板 Backend - FastAPI Application
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import ai, auth, rty, settings
from app.core.config import get_settings
from app.core.logger import log_error, log_info, setup_logger
from app.core.middleware import RequestContextMiddleware
from app.db.mongodb import close_mongo_connection, connect_to_mongo


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
    log_info("QualiBoard API 启动中...")
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

# 提前解析 CORS 白名单，供中间件使用
def settings_cors_origins() -> list[str]:
    return get_settings().CORS_ORIGINS

# CORS 配置（白名单，禁止 "*" + credentials 的危险组合）
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 请求上下文中间件：为每行日志自动绑定 request_id（及后续用户上下文）
app.add_middleware(RequestContextMiddleware)


# 注册路由
app.include_router(rty.router, prefix="/api/rty", tags=["RTY"])
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(ai.router, prefix="/api/ai", tags=["AI"])
app.include_router(auth.router, prefix="/api", tags=["Auth"])


@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {"status": "healthy", "version": "1.0.0"}


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """全局异常处理：把错误信息连同请求上下文一起记录，保证每行错误日志都有上下文"""
    log_error(
        f"HTTP {exc.status_code}: {exc.detail}",
        status_code=exc.status_code,
        path=request.url.path,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": str(exc.detail)},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """未捕获异常：记录完整堆栈与上下文，避免敏感信息直接外泄到响应"""
    log_error(f"Unhandled error: {exc}", path=request.url.path, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": "Internal Server Error"},
    )


# 全局审计日志器（由 lifespan 在 logger.py 模块内初始化，见 logger_module.audit_logger）
def run():
    """运行服务器"""
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=get_settings().DEBUG,
    )
