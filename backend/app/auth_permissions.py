"""Authentication roles and dashboard permission helpers."""

from typing import Annotated, Final

from fastapi import Depends, HTTPException, Request, status

from app.base_access import base_access_scope, require_base_access

ALL_DASHBOARD_PERMISSIONS: Final[tuple[str, ...]] = (
    "rty",
    "station-pass-rate",
    "repair-quality",
    "reinsert-rate",
    "lrr",
    "process-records",
    "doa",
    "doa-repairs",
    "mfr",
)

DASHBOARD_LABELS: Final[dict[str, str]] = {
    "rty": "RTY 整机直通率",
    "station-pass-rate": "工位过站直通率",
    "repair-quality": "维修通过率分析",
    "reinsert-rate": "重插率分析",
    "lrr": "LRR 部件故障率",
    "process-records": "关键工位影像追溯",
    "doa": "DOA 报修率",
    "doa-repairs": "DOA 维修明细",
    "mfr": "MFR 现网月化故障率",
}


def normalize_dashboard_permissions(values: list[str] | tuple[str, ...] | None) -> list[str]:
    allowed = set(ALL_DASHBOARD_PERMISSIONS)
    if values is None:
        return [value for value in ALL_DASHBOARD_PERMISSIONS if value != "reinsert-rate"]
    normalized = []
    for value in values:
        if value in allowed and value not in normalized:
            normalized.append(value)
    return normalized


def has_dashboard_permission(user: dict, permission: str) -> bool:
    if user.get("role") == "admin":
        return True
    return permission in set(user.get("dashboardPermissions") or [])


def dashboard_dependency(permission: str | tuple[str, ...]):
    """Build a FastAPI dependency enforcing one dashboard permission."""
    from app.api.auth import get_current_user

    async def dependency(
        request: Request, current_user: Annotated[dict, Depends(get_current_user)]
    ):
        permissions = (permission,) if isinstance(permission, str) else permission
        if not any(has_dashboard_permission(current_user, value) for value in permissions):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该看板")
        with base_access_scope(current_user.get("basePermissions")):
            for key in ("base", "bases"):
                for value in request.query_params.getlist(key):
                    require_base_access(value)
            yield current_user

    return dependency
