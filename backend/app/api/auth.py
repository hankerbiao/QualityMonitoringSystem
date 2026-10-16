from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.auth_service import AuthService
from app.core.context import user_var
from app.core.logger import audit_log
from app.db.mongodb import get_database

router = APIRouter()


def get_auth_service() -> AuthService:
    return AuthService(get_database())


class LocalLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


async def get_current_user(request: Request) -> dict:
    token = request.headers.get("Authorization", "")
    token = token[7:] if token.startswith("Bearer ") else None
    user = await get_auth_service().require_login(token)
    user_var.set(user.get("username", "anonymous"))
    return user


async def require_admin(current_user: Annotated[dict, Depends(get_current_user)]) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅管理员可执行此操作")
    return current_user


@router.post("/auth/login")
@audit_log("LOCAL_LOGIN", "/auth/login")
async def local_login(payload: LocalLoginRequest):
    return await get_auth_service().authenticate_local(
        username=payload.username.strip(), password=payload.password
    )


@router.post("/auth/refresh")
async def refresh_token(payload: RefreshRequest):
    result = await get_auth_service().refresh_access_token(payload.refresh_token)
    return {"ok": True, **result}


@router.post("/auth/change-password")
@audit_log("CHANGE_OWN_PASSWORD", "/auth/change-password", method="POST")
async def change_password(
    payload: ChangePasswordRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
    request: Request,
):
    await get_auth_service().change_password(
        current_user["username"], payload.current_password, payload.new_password
    )
    return {"ok": True}


@router.get("/auth/me")
async def get_me(current_user: Annotated[dict, Depends(get_current_user)]):
    return current_user


@router.post("/auth/logout")
async def logout(request: Request):
    token = request.headers.get("Authorization", "")
    token = token[7:] if token.startswith("Bearer ") else ""
    if token:
        try:
            session = await get_database().sessions.find_one({"accessToken": token})
            if session:
                await get_auth_service().revoke_session(session["sessionId"])
        except Exception:
            pass
    return {"ok": True}
