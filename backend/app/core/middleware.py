"""
请求上下文中间件

- 生成/透传 request_id（优先取客户端 X-Request-ID，否则自动生成）
- 通过 loguru 的 contextualize 让本次请求内的每一行日志都携带 request_id
- 把 request_id 回写到响应头，便于前后端串联排查
"""
import uuid

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
