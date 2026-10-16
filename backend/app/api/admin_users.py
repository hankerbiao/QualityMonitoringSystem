"""Administrator-only local user management endpoints."""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pymongo.errors import DuplicateKeyError

from app.api.auth import require_admin
from app.auth_permissions import (
    ALL_DASHBOARD_PERMISSIONS,
    normalize_dashboard_permissions,
)
from app.auth_service import AuthService
from app.base_access import BASE_OPTIONS, require_scope_subset
from app.core.config import get_settings
from app.core.logger import get_audit_logger
from app.db.mongodb import get_database
from app.schemas.users import (
    CreateUserRequest,
    ResetPasswordRequest,
    UpdateUserRequest,
    UserSummary,
)

router = APIRouter()


def _service() -> AuthService:
    return AuthService(get_database())


def _summary(doc: dict) -> UserSummary:
    profile = AuthService._user_profile(doc)
    return UserSummary(
        username=profile["username"],
        displayName=profile["name"],
        role=profile["role"],
        isActive=profile["isActive"],
        isProtected=profile["username"] == get_settings().DEFAULT_ADMIN_USERNAME,
        dashboardPermissions=profile["dashboardPermissions"],
        basePermissions=profile["basePermissions"],
        createdAt=doc.get("createdAt"),
        updatedAt=doc.get("updatedAt"),
    )


def _is_deleted(doc: dict) -> bool:
    profile = doc.get("profile") or {}
    return bool(doc.get("deletedAt") or profile.get("deletedAt"))


def _check_protected_account(doc: dict) -> None:
    if AuthService._user_profile(doc)["username"] == get_settings().DEFAULT_ADMIN_USERNAME:
        raise HTTPException(status_code=403, detail="不能管理内置管理员账号")


def _permissions(values: list[str] | None) -> list[str]:
    normalized = normalize_dashboard_permissions(values)
    if values is not None and set(values) - set(ALL_DASHBOARD_PERMISSIONS):
        raise HTTPException(status_code=422, detail="包含无效的看板权限")
    return normalized


@router.get("/admin/users", response_model=list[UserSummary])
async def list_users(_: Annotated[dict, Depends(require_admin)]):
    docs = await get_database().users.find({}).sort("createdAt", -1).to_list(length=1000)
    return [_summary(doc) for doc in docs if not _is_deleted(doc)]


@router.get("/admin/base-options")
async def base_options(current_user: Annotated[dict, Depends(require_admin)]):
    allowed = current_user.get("basePermissions")
    options = {code: name for code, name, _ in BASE_OPTIONS}
    for doc in await get_database().users.find({}).to_list(length=1000):
        for code in AuthService._user_profile(doc)["basePermissions"] or []:
            options.setdefault(code, code)
    return [
        {"code": code, "name": name}
        for code, name in options.items()
        if allowed is None or code in allowed
    ]


@router.post("/admin/users", response_model=UserSummary, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: CreateUserRequest,
    current_user: Annotated[dict, Depends(require_admin)],
):
    require_scope_subset(current_user, payload.basePermissions)
    db = get_database()
    username = payload.username.strip()
    if username == get_settings().DEFAULT_ADMIN_USERNAME:
        raise HTTPException(status_code=409, detail="该用户名保留给管理员")
    display_name = payload.displayName.strip()
    if not display_name:
        raise HTTPException(status_code=422, detail="显示姓名不能为空")
    now = datetime.now(timezone.utc).isoformat()
    permissions = _permissions(payload.dashboardPermissions)
    profile = {
        "itcode": username,
        "username": username,
        "name": display_name,
        "姓名": display_name,
        "role": "user",
        "auth_type": "local",
        "isActive": True,
        "dashboardPermissions": permissions,
        "basePermissions": payload.basePermissions,
    }
    doc = {
        "username": username,
        "itcode": username,
        "displayName": display_name,
        "role": "user",
        "isActive": True,
        "dashboardPermissions": permissions,
        "basePermissions": payload.basePermissions,
        "passwordHash": _service().hash_password(payload.password),
        "profile": profile,
        "createdAt": now,
        "updatedAt": now,
    }

    matches = await db.users.find(
        {"$or": [{"username": username}, {"itcode": username}]}
    ).to_list(length=10)
    if matches:
        if any(not _is_deleted(match) for match in matches):
            raise HTTPException(status_code=409, detail="用户名已存在")

        # MongoDB keeps username and itcode unique even for soft-deleted users.
        # Reuse the old document so the new account can keep the same identity
        # without dropping the historical record or violating those indexes.
        existing = matches[0]
        try:
            await db.users.update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "username": username,
                        "itcode": username,
                        "displayName": display_name,
                        "role": "user",
                        "isActive": True,
                        "dashboardPermissions": permissions,
                        "basePermissions": payload.basePermissions,
                        "passwordHash": doc["passwordHash"],
                        "profile": profile,
                        "deletedAt": None,
                        "updatedAt": now,
                    }
                },
            )
        except DuplicateKeyError:
            raise HTTPException(status_code=409, detail="用户名已存在") from None
        await _service().revoke_user_sessions(username)
        refreshed = await db.users.find_one({"_id": existing["_id"]})
        return _summary(refreshed or {**existing, **doc, "deletedAt": None, "updatedAt": now})

    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="用户名已存在") from None
    return _summary(doc)


@router.patch("/admin/users/{username}", response_model=UserSummary)
async def update_user(
    username: str,
    payload: UpdateUserRequest,
    current_user: Annotated[dict, Depends(require_admin)],
):
    db = get_database()
    doc = await db.users.find_one({"username": username})
    if not doc:
        raise HTTPException(status_code=404, detail="用户不存在")
    if _is_deleted(doc):
        raise HTTPException(status_code=404, detail="用户不存在")
    _check_protected_account(doc)
    require_scope_subset(current_user, AuthService._user_profile(doc)["basePermissions"])
    if username == current_user["username"] and (
        payload.role == "user" or payload.isActive is False
    ):
        raise HTTPException(status_code=403, detail="不能取消自己的管理员身份或禁用自己的账号")
    previous_role = AuthService._user_profile(doc)["role"]
    updates: dict = {}
    result_doc = dict(doc)
    result_profile = dict(doc.get("profile") or {})
    if payload.role is not None:
        updates["role"] = payload.role
        updates["profile.role"] = payload.role
        result_doc["role"] = payload.role
        result_profile["role"] = payload.role
    if payload.displayName is not None:
        display_name = payload.displayName.strip()
        if not display_name:
            raise HTTPException(status_code=422, detail="显示姓名不能为空")
        updates["displayName"] = display_name
        updates["profile.name"] = display_name
        updates["profile.姓名"] = display_name
        result_doc["displayName"] = display_name
        result_profile.update({"name": display_name, "姓名": display_name})
    if payload.isActive is not None:
        updates["isActive"] = payload.isActive
        updates["profile.isActive"] = payload.isActive
        result_doc["isActive"] = payload.isActive
        result_profile["isActive"] = payload.isActive
    if payload.dashboardPermissions is not None:
        permissions = _permissions(payload.dashboardPermissions)
        updates["dashboardPermissions"] = permissions
        updates["profile.dashboardPermissions"] = permissions
        result_doc["dashboardPermissions"] = permissions
        result_profile["dashboardPermissions"] = permissions
    if "basePermissions" in payload.model_fields_set:
        require_scope_subset(current_user, payload.basePermissions)
        updates["basePermissions"] = payload.basePermissions
        updates["profile.basePermissions"] = payload.basePermissions
        result_doc["basePermissions"] = payload.basePermissions
        result_profile["basePermissions"] = payload.basePermissions
    if payload.password is not None:
        updates["passwordHash"] = _service().hash_password(payload.password)
    if not updates:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")
    updates["updatedAt"] = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"username": username}, {"$set": updates})
    if payload.role is not None and payload.role != previous_role:
        get_audit_logger().log(
            action="CHANGE_USER_ROLE",
            resource=f"User:{username}",
            user_id=current_user["username"],
            method="PATCH",
            details=f"role: {previous_role} -> {payload.role}",
        )
    if "basePermissions" in payload.model_fields_set:
        get_audit_logger().log(
            action="CHANGE_USER_BASE_PERMISSIONS",
            resource=f"User:{username}",
            user_id=current_user["username"],
            method="PATCH",
            details=f"basePermissions: {AuthService._user_profile(doc)['basePermissions']} -> "
            f"{payload.basePermissions}",
        )
    if payload.isActive is False or payload.password is not None:
        await _service().revoke_user_sessions(username)
    result_doc["profile"] = result_profile
    updated = await db.users.find_one({"username": username})
    return _summary(updated or result_doc)


@router.delete("/admin/users/{username}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    username: str,
    current_user: Annotated[dict, Depends(require_admin)],
):
    db = get_database()
    doc = await db.users.find_one({"username": username})
    if not doc or _is_deleted(doc):
        raise HTTPException(status_code=404, detail="用户不存在")
    _check_protected_account(doc)
    require_scope_subset(current_user, AuthService._user_profile(doc)["basePermissions"])
    if username == current_user["username"]:
        raise HTTPException(status_code=403, detail="不能删除自己的账号")
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one(
        {"username": username},
        {
            "$set": {
                "deletedAt": now,
                "isActive": False,
                "profile.isActive": False,
                "updatedAt": now,
            }
        },
    )
    await _service().revoke_user_sessions(username)


@router.post("/admin/users/{username}/reset-password", response_model=UserSummary)
async def reset_password(
    username: str,
    payload: ResetPasswordRequest,
    current_user: Annotated[dict, Depends(require_admin)],
):
    db = get_database()
    doc = await db.users.find_one({"username": username})
    if not doc:
        raise HTTPException(status_code=404, detail="用户不存在")
    if _is_deleted(doc):
        raise HTTPException(status_code=404, detail="用户不存在")
    _check_protected_account(doc)
    require_scope_subset(current_user, AuthService._user_profile(doc)["basePermissions"])
    await db.users.update_one(
        {"username": username},
        {
            "$set": {
                "passwordHash": _service().hash_password(payload.password),
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    await _service().revoke_user_sessions(username)
    updated = await db.users.find_one({"username": username})
    return _summary(updated or doc)
