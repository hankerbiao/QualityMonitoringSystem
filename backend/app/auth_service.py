import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from app.auth_permissions import ALL_DASHBOARD_PERMISSIONS, normalize_dashboard_permissions
from app.core.config import get_settings


class AuthService:
    password_hasher = PasswordHasher()

    def __init__(self, db: Any) -> None:
        self.db = db

    @staticmethod
    def _base64url_decode(value: str) -> bytes:
        padding = "=" * (-len(value) % 4)
        return base64.urlsafe_b64decode(value + padding)

    @staticmethod
    def _base64url_encode(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

    def _sign_jwt(self, payload: dict, secret: str) -> str:
        header = {"alg": "HS256", "typ": "JWT"}
        header_b64 = self._base64url_encode(json.dumps(header, separators=(",", ":")).encode())
        payload_b64 = self._base64url_encode(json.dumps(payload, separators=(",", ":")).encode())
        signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
        signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
        sig_b64 = self._base64url_encode(signature)
        return f"{header_b64}.{payload_b64}.{sig_b64}"

    def _verify_jwt(self, token: str, secret: str) -> dict:
        try:
            header_b64, payload_b64, signature_b64 = token.split(".")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid token format") from None
        signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
        expected_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
        try:
            sig_bytes = self._base64url_decode(signature_b64)
        except Exception:
            raise HTTPException(
                status_code=400, detail="Invalid token signature encoding"
            ) from None
        if not hmac.compare_digest(expected_sig, sig_bytes):
            raise HTTPException(status_code=400, detail="Invalid token signature")
        try:
            return json.loads(self._base64url_decode(payload_b64))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid token payload") from None

    def create_access_token(self, username: str, issued_at: datetime | None = None) -> str:
        settings = get_settings()
        now = issued_at or datetime.now(timezone.utc)
        exp = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        return self._sign_jwt(
            {
                "sub": username,
                "type": "access",
                "iat": now.timestamp(),
                "exp": int(exp.timestamp()),
            },
            settings.JWT_SECRET,
        )

    def create_refresh_token(self, username: str, issued_at: datetime | None = None) -> str:
        settings = get_settings()
        now = issued_at or datetime.now(timezone.utc)
        exp = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
        return self._sign_jwt(
            {
                "sub": username,
                "type": "refresh",
                "iat": now.timestamp(),
                "exp": int(exp.timestamp()),
            },
            settings.JWT_SECRET,
        )

    def verify_access_token(self, token: str) -> dict:
        payload = self._verify_jwt(token, get_settings().JWT_SECRET)
        if payload.get("type") != "access":
            raise HTTPException(status_code=400, detail="Invalid token type")
        if datetime.now(timezone.utc).timestamp() > float(payload.get("exp", 0)):
            raise HTTPException(status_code=401, detail="Access token expired")
        return payload

    def verify_refresh_token(self, token: str) -> dict:
        payload = self._verify_jwt(token, get_settings().JWT_SECRET)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=400, detail="Invalid token type")
        if datetime.now(timezone.utc).timestamp() > float(payload.get("exp", 0)):
            raise HTTPException(status_code=401, detail="Refresh token expired")
        return payload

    @classmethod
    def hash_password(cls, password: str) -> str:
        return cls.password_hasher.hash(password)

    @classmethod
    def verify_password(cls, password: str, password_hash: str) -> bool:
        try:
            return cls.password_hasher.verify(password_hash, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False

    @staticmethod
    def _user_profile(user: dict, username: str | None = None) -> dict:
        stored = user.get("profile") or {}
        resolved_username = (
            username or user.get("username") or user.get("itcode") or stored.get("itcode")
        )
        role = user.get("role") or stored.get("role") or "user"
        display_name = (
            user.get("displayName")
            or stored.get("displayName")
            or stored.get("姓名")
            or stored.get("name")
            or resolved_username
        )
        is_active = user.get("isActive", stored.get("isActive", True))
        if user.get("deletedAt") or stored.get("deletedAt"):
            is_active = False
        permissions = user.get("dashboardPermissions", stored.get("dashboardPermissions"))
        if role == "admin":
            permissions = list(ALL_DASHBOARD_PERMISSIONS)
        else:
            permissions = normalize_dashboard_permissions(permissions)
        return {
            **stored,
            "itcode": resolved_username,
            "username": resolved_username,
            "name": display_name,
            "姓名": display_name,
            "role": role,
            "auth_type": "local",
            "isActive": bool(is_active),
            "dashboardPermissions": permissions,
        }

    async def _ensure_admin(self, username: str, password: str, now: datetime) -> dict:
        profile = self._user_profile(
            {"username": username, "displayName": "系统管理员", "role": "admin", "isActive": True},
            username,
        )
        user = {
            "username": username,
            "itcode": username,
            "displayName": "系统管理员",
            "role": "admin",
            "isActive": True,
            "dashboardPermissions": list(ALL_DASHBOARD_PERMISSIONS),
            "passwordHash": self.hash_password(password),
            "profile": profile,
            "updatedAt": now.isoformat(),
            "createdAt": now.isoformat(),
        }
        try:
            # Bootstrap only: concurrent logins must never overwrite a stored password.
            await self.db.users.insert_one(user)
        except DuplicateKeyError:
            existing = await self.db.users.find_one({"username": username})
            if existing is None:
                raise HTTPException(status_code=409, detail="管理员账号初始化冲突") from None
            return existing
        return user

    async def authenticate_local(self, username: str, password: str) -> dict:
        now = datetime.now(timezone.utc)
        settings = get_settings()
        username = username.strip()
        if not username or not password:
            raise HTTPException(status_code=401, detail="用户名或密码错误")
        user = await self.db.users.find_one({"username": username})
        is_configured_admin = hmac.compare_digest(username, settings.DEFAULT_ADMIN_USERNAME)
        if (
            user is None
            and is_configured_admin
            and hmac.compare_digest(password, settings.DEFAULT_ADMIN_PASSWORD)
        ):
            user = await self._ensure_admin(username, password, now)
        if user is None:
            raise HTTPException(status_code=401, detail="用户名或密码错误")
        profile = self._user_profile(user, username)
        if not profile["isActive"]:
            raise HTTPException(status_code=403, detail="用户已被禁用")
        if not self.verify_password(password, user.get("passwordHash", "")):
            raise HTTPException(status_code=401, detail="用户名或密码错误")

        session_data = await self._create_session(username, now)
        return {
            "ok": True,
            "user": profile,
            "access_token": session_data["access_token"],
            "refresh_token": session_data["refresh_token"],
            "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        }

    async def change_password(
        self, username: str, current_password: str, new_password: str
    ) -> None:
        user = await self.db.users.find_one({"username": username})
        if user is None or not self._user_profile(user, username)["isActive"]:
            raise HTTPException(status_code=403, detail="账号不可用")
        password_hash = user.get("passwordHash", "")
        if not self.verify_password(current_password, password_hash):
            raise HTTPException(status_code=400, detail="当前密码错误")
        if current_password == new_password:
            raise HTTPException(status_code=400, detail="新密码不能与当前密码相同")
        new_hash = self.hash_password(new_password)
        now = datetime.now(timezone.utc).isoformat()
        result = await self.db.users.update_one(
            {"username": username, "passwordHash": password_hash},
            {
                "$set": {
                    "passwordHash": new_hash,
                    "passwordChangedAt": now,
                    "updatedAt": now,
                }
            },
        )
        if result.matched_count != 1:
            raise HTTPException(status_code=409, detail="密码已变更，请重新登录后重试")
        await self.revoke_user_sessions(username)

    @staticmethod
    def _check_password_change(user: dict, payload: dict) -> None:
        # Access tokens remain signed after sessions are removed; reject pre-change tokens too.
        changed_at = user.get("passwordChangedAt")
        if (
            changed_at
            and float(payload.get("iat", 0)) <= datetime.fromisoformat(changed_at).timestamp()
        ):
            raise HTTPException(status_code=401, detail="密码已修改，请重新登录")

    async def refresh_access_token(self, refresh_token: str) -> dict:
        now = datetime.now(timezone.utc)
        payload = self.verify_refresh_token(refresh_token)
        username = payload.get("sub")
        session = await self.db.sessions.find_one({"refreshToken": refresh_token})
        if not session:
            raise HTTPException(status_code=401, detail="Refresh token not found")
        user = await self.db.users.find_one({"username": username})
        if user is None:
            raise HTTPException(status_code=401, detail="用户不存在")
        self._check_password_change(user, payload)
        if not self._user_profile(user, username)["isActive"]:
            raise HTTPException(status_code=403, detail="用户已被禁用")
        new_access_token = self.create_access_token(username, now)
        await self.db.sessions.update_one(
            {"sessionId": session["sessionId"]},
            {"$set": {"accessToken": new_access_token, "updatedAt": now.isoformat()}},
        )
        return {
            "access_token": new_access_token,
            "refresh_token": refresh_token,
            "expires_in": get_settings().ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        }

    async def _create_session(self, username: str, now: datetime) -> dict:
        settings = get_settings()
        access_token = self.create_access_token(username, now)
        refresh_token = self.create_refresh_token(username, now)
        session_id = f"sess_{int(time.time() * 1000)}_{username}"
        expires_at = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
        await self.db.sessions.insert_one(
            {
                "sessionId": session_id,
                "username": username,
                "itcode": username,
                "accessToken": access_token,
                "refreshToken": refresh_token,
                "createdAt": now.isoformat(),
                "updatedAt": now.isoformat(),
                "expiresAt": expires_at.isoformat(),
            }
        )
        return {
            "session_id": session_id,
            "access_token": access_token,
            "refresh_token": refresh_token,
        }

    async def require_login(self, token: str | None) -> dict:
        if not token:
            raise HTTPException(status_code=401, detail="Missing session token")
        try:
            payload = self.verify_access_token(token)
            username = payload.get("sub")
        except HTTPException:
            raise HTTPException(status_code=401, detail="Invalid or expired access token") from None
        user = await self.db.users.find_one({"username": username})
        if user is None:
            raise HTTPException(status_code=401, detail="用户不存在")
        self._check_password_change(user, payload)
        profile = self._user_profile(user, username)
        if not profile["isActive"]:
            raise HTTPException(status_code=403, detail="用户已被禁用")
        return {
            "itcode": username,
            "username": username,
            "role": profile["role"],
            "isActive": profile["isActive"],
            "dashboardPermissions": profile["dashboardPermissions"],
            "user": profile,
        }

    async def revoke_session(self, session_id: str) -> None:
        await self.db.sessions.delete_one({"sessionId": session_id})

    async def revoke_user_sessions(self, username: str) -> None:
        await self.db.sessions.delete_many({"$or": [{"username": username}, {"itcode": username}]})
