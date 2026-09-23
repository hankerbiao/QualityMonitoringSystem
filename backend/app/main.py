"""
QualiBoard 品质看板 Backend - FastAPI Application
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import (
    admin_users,
    alert_report,
    auth,
    data_gateway,
    doa,
    lrr,
    mfr,
    operations,
    process_records,
    rty,
    settings,
    sn_info,
)
from app.core.config import get_settings, validate_security_settings
from app.core.context import get_request_id
from app.core.lifecycle import shutdown_infrastructure, startup_infrastructure
from app.core.logger import log_error
from app.core.middleware import RequestContextMiddleware, UsageTrackingMiddleware
from app.services.data_gateway_client import DataGatewayError


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    app_settings = get_settings()
    validate_security_settings(app_settings)
    scheduler = await startup_infrastructure(app_settings)

    yield

    await shutdown_infrastructure(scheduler)


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
app.add_middleware(UsageTrackingMiddleware)


# 注册路由
app.include_router(rty.router, prefix="/api/rty", tags=["RTY"])
app.include_router(lrr.router, prefix="/api/lrr", tags=["LRR"])
app.include_router(mfr.router, prefix="/api/mfr", tags=["MFR"])
app.include_router(doa.router, prefix="/api/doa", tags=["DOA"])
app.include_router(alert_report.router, prefix="/api/alert-report", tags=["AlertReport"])
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(data_gateway.router, prefix="/api/data-gateway", tags=["Data Gateway"])
app.include_router(
    process_records.router,
    prefix="/api/process-records",
    tags=["Process Records"],
)
app.include_router(auth.router, prefix="/api", tags=["Auth"])
app.include_router(admin_users.router, prefix="/api", tags=["Admin Users"])
app.include_router(operations.router, prefix="/api/operations", tags=["Operations"])
app.include_router(sn_info.router, prefix="/api/sn-info", tags=["SN Info"])


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
    # 若 detail 本身是字典（如结构化的 502 错误体），原样返回，保留结构
    if isinstance(exc.detail, dict):
        payload = {"success": False, **exc.detail}
        payload.setdefault("requestId", get_request_id())
        return JSONResponse(status_code=exc.status_code, content=payload)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "code": "HTTP_ERROR",
            "error": str(exc.detail),
            "message": str(exc.detail),
            "retryable": False,
            "requestId": get_request_id(),
        },
    )


@app.exception_handler(DataGatewayError)
async def data_gateway_exception_handler(request: Request, exc: DataGatewayError):
    """Never fall back to local MongoDB after a configured gateway fails."""
    status_code = exc.status_code if exc.status_code and 400 <= exc.status_code < 500 else 502
    log_error(
        f"Data gateway error: {exc}",
        status_code=status_code,
        path=request.url.path,
    )
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "code": exc.code,
            "error": str(exc),
            "message": str(exc),
            "retryable": exc.retryable,
            "requestId": get_request_id(),
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """未捕获异常：记录完整堆栈与上下文，避免敏感信息直接外泄到响应"""
    log_error(f"Unhandled error: {exc}", path=request.url.path, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "code": "INTERNAL_ERROR",
            "error": "系统内部错误，请稍后重试",
            "message": "系统内部错误，请稍后重试",
            "retryable": True,
            "requestId": get_request_id(),
        },
    )


# 全局审计日志器由 lifespan 在 logger.py 模块内初始化。
