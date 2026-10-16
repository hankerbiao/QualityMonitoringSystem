"""User management request and response models."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.auth_permissions import ALL_DASHBOARD_PERMISSIONS
from app.base_access import normalize_base_permissions


class BasePermissionsModel(BaseModel):
    # None grants every base; an empty list grants no production data.
    basePermissions: list[str] | None = Field(default=None, max_length=100)

    @field_validator("basePermissions")
    @classmethod
    def validate_bases(cls, values: list[str] | None) -> list[str] | None:
        if values is not None and any(
            not value.strip() or len(value.strip()) > 40 for value in values
        ):
            raise ValueError("基地编码不能为空或超过 40 个字符")
        return normalize_base_permissions(values)


class UserSummary(BasePermissionsModel):
    username: str
    displayName: str
    role: Literal["user", "admin"]
    isActive: bool
    isProtected: bool = False
    dashboardPermissions: list[str] = Field(default_factory=lambda: list(ALL_DASHBOARD_PERMISSIONS))
    createdAt: str | None = None
    updatedAt: str | None = None


class CreateUserRequest(BasePermissionsModel):
    username: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    displayName: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=128)
    dashboardPermissions: list[str] = Field(default_factory=lambda: list(ALL_DASHBOARD_PERMISSIONS))


class UpdateUserRequest(BasePermissionsModel):
    role: Literal["user", "admin"] | None = None
    displayName: str | None = Field(default=None, min_length=1, max_length=80)
    isActive: bool | None = None
    dashboardPermissions: list[str] | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


class ResetPasswordRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)
