"""User management request and response models."""

from pydantic import BaseModel, Field

from app.auth_permissions import ALL_DASHBOARD_PERMISSIONS


class UserSummary(BaseModel):
    username: str
    displayName: str
    role: str
    isActive: bool
    dashboardPermissions: list[str] = Field(default_factory=lambda: list(ALL_DASHBOARD_PERMISSIONS))
    createdAt: str | None = None
    updatedAt: str | None = None


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    displayName: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=128)
    dashboardPermissions: list[str] = Field(default_factory=lambda: list(ALL_DASHBOARD_PERMISSIONS))


class UpdateUserRequest(BaseModel):
    displayName: str | None = Field(default=None, min_length=1, max_length=80)
    isActive: bool | None = None
    dashboardPermissions: list[str] | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


class ResetPasswordRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)
