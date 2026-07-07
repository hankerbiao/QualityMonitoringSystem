from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import RedirectResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional

from app.auth_service import AuthService
from app.db.mongodb import get_database

router = APIRouter()


def get_auth_service() -> AuthService:
    db = get_database()
    return AuthService(db)


class OALoginRequest(BaseModel):
    status: str
    payload: str
    next: Optional[str] = None


class RefreshRequest(BaseModel):
    refresh_token: str


async def get_current_user(request: Request) -> dict:
    service = get_auth_service()
    token = request.headers.get("Authorization")
    if token and token.startswith("Bearer "):
        token = token[7:]
    return await service.require_login(token)


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
async def oa_login_callback_get(
    request: Request,
    status: str = Query(..., description="登录状态"),
    payload: str = Query(..., description="JWT token"),
    next: Optional[str] = Query(None, description="回调跳转地址"),
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

        frontend_base = next or "http://localhost:3000"
        access_token = result.get("access_token", "")
        refresh_token = result.get("refresh_token", "")

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
            secure=False,
            samesite="lax",
            max_age=15 * 60,
        )
        response.set_cookie(
            key="qms_refresh_token",
            value=refresh_token,
            httponly=True,
            secure=False,
            samesite="lax",
            max_age=30 * 24 * 60 * 60,
        )

        return response

    except HTTPException as e:
        error_msg = e.detail or "Login failed"
        frontend_base = next or "http://localhost:3000"
        redirect_url = f"{frontend_base}/login?status=error&error={error_msg}"
        return RedirectResponse(url=redirect_url, status_code=302)


@router.post("/auth/refresh")
async def refresh_token(request: RefreshRequest):
    """使用 refresh_token 换发新的 access_token"""
    service = get_auth_service()
    try:
        result = await service.refresh_access_token(request.refresh_token)
        return {"ok": True, **result}
    except HTTPException as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)


@router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """获取当前用户信息"""
    return current_user


@router.post("/auth/logout")
async def logout(request: Request):
    """退出登录"""
    from app.core.logger import get_audit_logger, log_info

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