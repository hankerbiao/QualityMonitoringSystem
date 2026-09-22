"""Authentication roles and dashboard permission helpers."""

from typing import Annotated, Final

from fastapi import Depends, HTTPException, status

ALL_DASHBOARD_PERMISSIONS: Final[tuple[str, ...]] = (
    "rty",
    "station-pass-rate",
    "lrr",
    "process-records",
    "metadata",
    "doa",
    "doa-repairs",
    "mfr",
)

DASHBOARD_LABELS: Final[dict[str, str]] = {
    "rty": "RTY 整机直通率",
    "station-pass-rate": "工位过站直通率",
    "lrr": "LRR 部件故障率",
    "process-records": "关键工位影像追溯",
    "metadata": "元数据",
    "doa": "DOA 报修率",
    "doa-repairs": "DOA 维修明细",
    "mfr": "MFR 现网月化故障率",
}


def normalize_dashboard_permissions(values: list[str] | tuple[str, ...] | None) -> list[str]:
    allowed = set(ALL_DASHBOARD_PERMISSIONS)
    if values is None:
        return list(ALL_DASHBOARD_PERMISSIONS)
    normalized = []
    for value in values:
        if value in allowed and value not in normalized:
            normalized.append(value)
    return normalized


def has_dashboard_permission(user: dict, permission: str) -> bool:
    if user.get("role") == "admin":
        return True
    return permission in set(user.get("dashboardPermissions") or [])


def dashboard_dependency(permission: str):
    """Build a FastAPI dependency enforcing one dashboard permission."""
    from app.api.auth import get_current_user

    async def dependency(current_user: Annotated[dict, Depends(get_current_user)]) -> dict:
        if not has_dashboard_permission(current_user, permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该看板")
        return current_user

    return dependency
