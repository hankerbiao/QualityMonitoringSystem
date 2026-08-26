
from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.auth_service import AuthService
from app.core.config import get_settings
from app.core.context import user_var
from app.core.logger import audit_log, get_audit_logger, get_client_ip
from app.db.mongodb import get_database

router = APIRouter()


def get_auth_service() -> AuthService:
    db = get_database()
    return AuthService(db)


class OALoginRequest(BaseModel):
    status: str
    payload: str
    next: str | None = None


class LocalLoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


async def get_current_user(request: Request) -> dict:
    service = get_auth_service()
    token = request.headers.get("Authorization")
    if token and token.startswith("Bearer "):
        token = token[7:]
    user = await service.require_login(token)
    # 把已认证用户写入请求级上下文（contextvars），供审计日志装饰器读取
    user_var.set(user.get("itcode", "anonymous"))
    return user


def _safe_redirect_target(next_url: str | None, request: Request | None = None) -> str:
    """校验 OA 回跳地址，防止开放重定向（open redirect）。

    优先级：
    1. `next` 为相对路径 → 直接用；
    2. `next` 的 origin 命中 CORS 白名单或部署公网地址(APP_PUBLIC_BASE_URL) → 用；
    3. 回退到 APP_PUBLIC_BASE_URL（部署的前端地址），不再写死 localhost:3000。
    """
    settings = get_settings()
    default = settings.APP_PUBLIC_BASE_URL or "http://localhost:3000"
    if not next_url:
        # 没有 next 时回退到部署的前端公网地址（注意：不能用 request.url.origin，
        # 因为回调请求打在后端端口上，其 origin 是后端而非前端）
        return default
    if next_url.startswith("/"):
        return next_url
    try:
        parsed = urlparse(next_url)
    except ValueError:
        return default
    allowed = set(settings.CORS_ORIGINS)
    allowed.add(default)
    if parsed.scheme in ("http", "https") and parsed.netloc in allowed:
        return next_url
    return default


@router.post("/auth/login")
@audit_log("LOCAL_LOGIN", "/auth/login")
async def local_login(payload: LocalLoginRequest):
    """使用本地用户名和密码登录。"""
    service = get_auth_service()
    return await service.authenticate_local(
        username=payload.username.strip(),
        password=payload.password,
    )


@router.post("/auth/oa/callback")
async def oa_login_callback(payload: OALoginRequest):
    """处理 OA 登录回调 (POST JSON 格式)"""
    service = get_auth_service()
    return await service.handle_oa_callback(
        status_value=payload.status,
        payload_token=payload.payload,
        next_url=payload.next,
    )


@router.get("/auth/oa/callback")
@audit_log("OA_LOGIN", "/auth/oa/callback")
async def oa_login_callback_get(
    request: Request,
    status: str = Query(..., description="登录状态"),
    payload: str = Query(..., description="JWT token"),
    next: str | None = Query(None, description="回调跳转地址"),
):
    """处理 OA 登录回调 (GET URL 参数格式)

    OA 系统回调时自动跳转到此接口，
    后端处理登录后重定向到前端页面
    """
    service = get_auth_service()

    try:
        result = await service.handle_oa_callback(
            status_value=status,
            payload_token=payload,
            next_url=next,
        )
        get_audit_logger().log(
            action="OA_URL_TOKEN_COMPAT",
            resource="/auth/oa/callback",
            client_ip=get_client_ip(request),
            method="GET",
            details="URL token redirect compatibility path used; token content omitted",
        )

        frontend_base = _safe_redirect_target(next, request)
        access_token = result.get("access_token", "")
        refresh_token = result.get("refresh_token", "")

        # 注意：token 同时写入 HttpOnly Cookie（下方 set_cookie）与 URL 查询参数。
        # URL 方式仅为兼容前端现有读取逻辑，建议后续统一改为仅用 Cookie 以避免 token 进入历史/Referer。
        redirect_url = (
            f"{frontend_base}/login"
            f"?status=success"
            f"&access_token={access_token}"
            f"&refresh_token={refresh_token}"
            f"&expires_in={result.get('expires_in', 900)}"
        )

        response = RedirectResponse(url=redirect_url, status_code=302)
        response.set_cookie(
            key="qms_access_token",
            value=access_token,
            httponly=True,
            secure=get_settings().AUTH_COOKIE_SECURE,
            samesite="lax",
            max_age=15 * 60,
        )
        response.set_cookie(
            key="qms_refresh_token",
            value=refresh_token,
            httponly=True,
            secure=get_settings().AUTH_COOKIE_SECURE,
            samesite="lax",
            max_age=30 * 24 * 60 * 60,
        )

        return response

    except HTTPException as e:
        error_msg = e.detail or "Login failed"
        frontend_base = _safe_redirect_target(next, request)
        redirect_url = f"{frontend_base}/login?status=error&error={error_msg}"
        return RedirectResponse(url=redirect_url, status_code=302)
    except Exception as e:  # 兜底：任何未预期异常都不要暴露裸 500，重定向到前端错误页并记录完整堆栈
        from app.core.logger import log_error

        log_error(f"OA 回调未预期异常: {e}", path=str(request.url), exc_info=e)
        frontend_base = _safe_redirect_target(next, request)
        safe_msg = "login_failed"
        redirect_url = f"{frontend_base}/login?status=error&error={safe_msg}"
        return RedirectResponse(url=redirect_url, status_code=302)


@router.post("/auth/refresh")
async def refresh_token(request: RefreshRequest):
    """使用 refresh_token 换发新的 access_token"""
    service = get_auth_service()
    try:
        result = await service.refresh_access_token(request.refresh_token)
        return {"ok": True, **result}
    except HTTPException as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from None


@router.get("/auth/me")
async def get_me(current_user: Annotated[dict, Depends(get_current_user)]):
    """获取当前用户信息"""
    return current_user


@router.post("/auth/logout")
async def logout(request: Request):
    """退出登录"""
    from app.core.logger import log_info

    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else ""

    if token:
        service = get_auth_service()
        try:
            payload = service.verify_access_token(token)
            session = await get_database().sessions.find_one({"accessToken": token})
            if session:
                await service.revoke_session(session["sessionId"])
                log_info(f"用户退出登录: itcode={payload.get('sub')}, session={session['sessionId'][:12]}...")
        except Exception:
            pass

    return {"ok": True}
