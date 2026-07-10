"""
请求级上下文（基于 contextvars）

用于在异步请求生命周期内安全传递 request_id 与当前用户，
供审计日志装饰器与日志中间件读取，从而让每一行日志都自带上下文。
"""
from contextvars import ContextVar

# 请求唯一 ID：由中间件在请求进入时生成/透传，贯穿整个请求生命周期
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

# 当前操作用户（itcode）：由认证依赖在解析出用户后写入
user_var: ContextVar[str] = ContextVar("user", default="anonymous")


def get_request_id() -> str:
    return request_id_var.get()


def get_user() -> str:
    return user_var.get()
