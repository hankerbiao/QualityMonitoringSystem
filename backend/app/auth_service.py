import base64
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status

from app.core.config import get_settings


class AuthService:
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
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token format")

        signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
        expected_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
        try:
            sig_bytes = self._base64url_decode(signature_b64)
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token signature encoding")
        if not hmac.compare_digest(expected_sig, sig_bytes):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token signature")

        try:
            payload_bytes = self._base64url_decode(payload_b64)
            payload = json.loads(payload_bytes)
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token payload")

        return payload

    @staticmethod
    def _decode_and_verify_jwt(token: str, secret: str) -> dict:
        try:
            header_b64, payload_b64, signature_b64 = token.split(".")
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid token format",
            )

        signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
        expected_sig = hmac.new(
            secret.encode("utf-8"), signing_input, hashlib.sha256
        ).digest()

        try:
            sig_bytes = base64.urlsafe_b64decode(signature_b64 + "=" * (-len(signature_b64) % 4))
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid token signature encoding",
            )

        if not hmac.compare_digest(expected_sig, sig_bytes):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid token signature",
            )

        try:
            payload_bytes = base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4))
            payload = json.loads(payload_bytes)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid token payload",
            )

        exp = payload.get("exp")
        if exp is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Token missing exp",
            )

        now_ts = datetime.now(timezone.utc).timestamp()
        if now_ts > float(exp):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Token has expired",
            )

        return payload

    def create_access_token(self, itcode: str) -> str:
        settings = get_settings()
        now = datetime.now(timezone.utc)
        exp = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        payload = {
            "sub": itcode,
            "type": "access",
            "iat": int(now.timestamp()),
            "exp": int(exp.timestamp()),
        }
        return self._sign_jwt(payload, settings.JWT_SECRET)

    def create_refresh_token(self, itcode: str) -> str:
        settings = get_settings()
        now = datetime.now(timezone.utc)
        exp = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
        payload = {
            "sub": itcode,
            "type": "refresh",
            "iat": int(now.timestamp()),
            "exp": int(exp.timestamp()),
        }
        return self._sign_jwt(payload, settings.JWT_SECRET)

    def verify_access_token(self, token: str) -> dict:
        settings = get_settings()
        payload = self._verify_jwt(token, settings.JWT_SECRET)
        if payload.get("type") != "access":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token type")
        now_ts = datetime.now(timezone.utc).timestamp()
        if now_ts > float(payload.get("exp", 0)):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Access token expired")
        return payload

    def verify_refresh_token(self, token: str) -> dict:
        settings = get_settings()
        payload = self._verify_jwt(token, settings.JWT_SECRET)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token type")
        now_ts = datetime.now(timezone.utc).timestamp()
        if now_ts > float(payload.get("exp", 0)):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired")
        return payload

    async def refresh_access_token(self, refresh_token: str) -> dict:
        payload = self.verify_refresh_token(refresh_token)
        itcode = payload.get("sub")

        session = await self.db.sessions.find_one({"refreshToken": refresh_token})
        if not session:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token not found")

        new_access_token = self.create_access_token(itcode)

        now = datetime.now(timezone.utc)
        settings = get_settings()
        await self.db.sessions.update_one(
            {"sessionId": session["sessionId"]},
            {
                "$set": {
                    "accessToken": new_access_token,
                    "updatedAt": now.isoformat(),
                }
            },
        )

        return {
            "access_token": new_access_token,
            "refresh_token": refresh_token,
            "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        }

    async def handle_oa_callback(
        self, status_value: str, payload_token: str, next_url: str | None = None
    ) -> dict:
        if status_value != "success":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OA login failed",
            )

        settings = get_settings()
        decoded = self._decode_and_verify_jwt(payload_token, settings.OA_JWT_SECRET)

        itcode = decoded.get("itcode")
        if not itcode:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Token missing itcode",
            )

        now = datetime.now(timezone.utc)

        await self.db.users.update_one(
            {"itcode": itcode},
            {
                "$set": {
                    "itcode": itcode,
                    "profile": decoded,
                    "updatedAt": now.isoformat(),
                },
                "$setOnInsert": {
                    "createdAt": now.isoformat(),
                },
            },
            upsert=True,
        )

        session_data = await self._create_session(itcode, now)

        return {
            "ok": True,
            "user": decoded,
            "next": next_url,
            "access_token": session_data["access_token"],
            "refresh_token": session_data["refresh_token"],
            "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        }

    async def _create_session(self, itcode: str, now: datetime) -> dict:
        settings = get_settings()

        access_token = self.create_access_token(itcode)
        refresh_token = self.create_refresh_token(itcode)
        session_id = f"sess_{int(time.time() * 1000)}_{itcode}"

        expires_at = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

        await self.db.sessions.insert_one(
            {
                "sessionId": session_id,
                "itcode": itcode,
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
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing session token",
            )

        try:
            payload = self.verify_access_token(token)
            itcode = payload.get("sub")
        except HTTPException:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired access token",
            )

        user = await self.db.users.find_one({"itcode": itcode}) or {}
        return {
            "itcode": itcode,
            "user": user.get("profile") or {},
        }

    async def revoke_session(self, session_id: str) -> None:
        await self.db.sessions.delete_one({"sessionId": session_id})
