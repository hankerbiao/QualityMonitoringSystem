"""
通用响应模型
"""
from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Response(BaseModel, Generic[T]):
    """统一 API 响应格式"""
    success: bool = True
    message: str | None = None
    data: T | None = None
    error: str | None = None


class PaginatedResponse(BaseModel, Generic[T]):
    """分页响应格式"""
    items: list[T]
    total: int
    page: int
    limit: int
    has_more: bool


class ErrorResponse(BaseModel):
    """错误响应"""
    success: bool = False
    error: str
    detail: str | None = None
