"""
请求上下文中间件

- 生成/透传 request_id（优先取客户端 X-Request-ID，否则自动生成）
- 通过 loguru 的 contextualize 让本次请求内的每一行日志都携带 request_id
- 把 request_id 回写到响应头，便于前后端串联排查
"""
import time
import uuid
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware

from app.core.context import request_id_var
from app.core.logger import logger


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
        request_id_var.set(rid)

        with logger.contextualize(request_id=rid):
            response = await call_next(request)

        response.headers["X-Request-ID"] = rid
        return response


class UsageTrackingMiddleware(BaseHTTPMiddleware):
    """记录已认证业务 API 的状态与耗时，不采集参数和请求体。"""

    async def dispatch(self, request, call_next):
        started_at = time.perf_counter()
        response = await call_next(request)

        path = request.url.path
        excluded = ("/api/auth", "/api/operations", "/api/alert-report")
        if not path.startswith("/api/") or path.startswith(excluded):
            return response

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return response

        try:
            from app.auth_service import AuthService
            from app.db.mongodb import get_database
            from app.services.operations_service import module_from_path

            db = get_database()
            payload = AuthService(db).verify_access_token(auth_header[7:])
            itcode = payload.get("sub")
            if itcode:
                await db.usage_events.insert_one(
                    {
                        "eventType": "api_request",
                        "itcode": itcode,
                        "module": module_from_path(path),
                        "path": path[:160],
                        "method": request.method,
                        "statusCode": response.status_code,
                        "durationMs": round((time.perf_counter() - started_at) * 1000, 2),
                        "timestamp": datetime.now(timezone.utc),
                    }
                )
        except Exception as exc:
            logger.debug(f"Usage event skipped: {exc}")

        return response
