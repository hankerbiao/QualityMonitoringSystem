"""带独立登录会话的实时影像数据源客户端。"""

import asyncio
import json
import time
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote, urlsplit

import httpx
from faker import Faker
from loguru import logger


@dataclass(frozen=True)
class SourceDefinition:
    key: str
    name: str
    api_base_url: str
    image_base_url: str
    page_path: str
    sort_field: str
    sn_field: str
    sn_display_type: str
    base_field: str
    base_display_type: str
    station_field: str
    station_display_type: str | None = None


class PhotoSourceClient:
    """每个上游系统持有一个独立的 Token/Cookie 会话。"""

    LOGIN_STATUS_CHECK_INTERVAL = 300.0

    def __init__(self, definition: SourceDefinition, username: str, password: str):
        self.definition = definition
        self.username = username
        self.password = password
        self._user_agent = Faker().user_agent()
        self._logged_in = False
        self._session_generation = 0
        self._last_login_status_check: float | None = None
        self._login_lock = asyncio.Lock()
        self._client = httpx.AsyncClient(
            base_url=definition.api_base_url,
            timeout=httpx.Timeout(20.0, connect=8.0),
            trust_env=False,
            follow_redirects=True,
        )

    def _headers(self) -> dict[str, str]:
        return {"User-Agent": self._user_agent}

    async def close(self) -> None:
        await self._client.aclose()

    @classmethod
    def _response_requires_login(cls, response: httpx.Response) -> bool:
        """Handle upstreams that report an expired session in a 200 response."""
        if response.status_code in (401, 403):
            return True
        path = urlsplit(str(getattr(response, "url", ""))).path.lower().rstrip("/")
        if path.endswith(("/login", "/login.html", "/login.aspx")):
            return True
        try:
            payload = response.json()
        except (TypeError, ValueError):
            return False
        return cls._payload_is_logged_out(payload)

    @staticmethod
    def _payload_is_logged_out(payload: Any) -> bool:
        if not isinstance(payload, dict):
            return False
        sections = [payload]
        if isinstance(payload.get("data"), dict):
            sections.append(payload["data"])
        auth_messages = (
            "未登录",
            "未登陆",
            "登录过期",
            "登录已过期",
            "登录失效",
            "登录已失效",
            "登录超时",
            "请先登录",
            "重新登录",
            "重新登陆",
            "token expired",
            "token has expired",
            "invalid token",
            "session expired",
            "session has expired",
            "not logged in",
            "not authenticated",
            "authentication required",
            "unauthorized",
        )
        for section in sections:
            if section.get("loggedIn") is False or section.get("isLogin") is False:
                return True
            if section.get("status") is False:
                return True
            if any(section.get(key) in (401, 403, "401", "403") for key in ("status", "code")):
                return True
            message = str(section.get("msg") or section.get("message") or "").casefold()
            if any(fragment in message for fragment in auth_messages):
                return True
        return False

    @staticmethod
    def _payload_has_error(payload: dict[str, Any]) -> bool:
        # Both photo systems use business code 310 for a successful login.
        return (
            payload.get("success") is False
            or payload.get("status") is False
            or payload.get("status") not in (None, 0, True)
            or payload.get("code") is False
            or payload.get("code") not in (None, 0, 200, 310, True, "0", "200", "310")
        )

    async def login(
        self,
        force: bool = False,
        *,
        expected_generation: int | None = None,
    ) -> dict[str, Any]:
        async with self._login_lock:
            # A concurrent request may already have replaced the expired session.
            if self._logged_in and (
                not force
                or (
                    expected_generation is not None
                    and expected_generation != self._session_generation
                )
            ):
                return {}

            self._logged_in = False
            self._last_login_status_check = None
            self._client.headers.pop("Authorization", None)
            self._client.cookies.clear()
            response = await self._client.post(
                "/api/user/login",
                json={"userName": self.username, "password": self.password},
                headers=self._headers(),
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise RuntimeError("登录响应格式无效")
            if self._payload_has_error(payload) or self._payload_is_logged_out(payload):
                raise RuntimeError(str(payload.get("msg") or payload.get("message") or "登录失败"))

            data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
            token = (
                data.get("token")
                or data.get("accessToken")
                or data.get("Token")
                or payload.get("token")
            )
            if token:
                self._client.headers["Authorization"] = f"Bearer {token}"
            self._session_generation += 1
            self._logged_in = True
            self._last_login_status_check = time.monotonic()
            return payload

    async def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        await self.login()
        if (
            self._last_login_status_check is None
            or time.monotonic() - self._last_login_status_check >= self.LOGIN_STATUS_CHECK_INTERVAL
        ):
            await self.get_login_status()
        generation = self._session_generation
        response = await self._client.request(method, url, headers=self._headers(), **kwargs)
        if self._response_requires_login(response):
            logger.warning("影像数据源 {} 会话失效，尝试自动重新登录", self.definition.key)
            await self.login(force=True, expected_generation=generation)
            generation = self._session_generation
            response = await self._client.request(method, url, headers=self._headers(), **kwargs)
            if self._response_requires_login(response):
                if generation == self._session_generation:
                    self._logged_in = False
                    self._last_login_status_check = None
                logger.warning("影像数据源 {} 自动重新登录后仍拒绝访问", self.definition.key)
                raise RuntimeError(
                    "上游登录已失效，自动重新登录后仍无法访问，请检查账号权限或数据源服务"
                )
        response.raise_for_status()
        return response

    async def get_login_status(self) -> dict[str, Any]:
        """验证当前登录状态；上游无该端点时仍以已成功登录为准。"""
        await self.login()
        for attempt in range(2):
            generation = self._session_generation
            response = await self._client.post(
                "/api/user/GetCurrentUserInfo",
                headers=self._headers(),
            )
            if response.status_code == 404:
                self._last_login_status_check = time.monotonic()
                return {"loggedIn": self._logged_in}
            if self._response_requires_login(response):
                if attempt == 0:
                    logger.warning(
                        "影像数据源 {} 登录状态失效，尝试自动重新登录", self.definition.key
                    )
                    await self.login(force=True, expected_generation=generation)
                    continue
                if generation == self._session_generation:
                    self._logged_in = False
                    self._last_login_status_check = None
                raise RuntimeError("上游登录状态刷新失败，请检查账号权限或数据源服务")
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise RuntimeError("上游登录状态响应格式无效")
            if self._payload_has_error(payload):
                raise RuntimeError(
                    str(payload.get("msg") or payload.get("message") or "上游登录状态检查失败")
                )
            self._last_login_status_check = time.monotonic()
            return payload
        raise RuntimeError("上游登录状态刷新失败")

    async def fetch_page(
        self,
        page: int,
        rows: int,
        sn: str = "",
        base: str = "",
        station: str = "",
    ) -> dict[str, Any]:
        wheres: list[dict[str, str]] = []
        if base:
            wheres.append(
                {
                    "name": self.definition.base_field,
                    "value": base,
                    "displayType": self.definition.base_display_type,
                }
            )
        if station:
            station_filter = {
                "name": self.definition.station_field,
                "value": station,
            }
            if self.definition.station_display_type:
                station_filter["displayType"] = self.definition.station_display_type
            wheres.append(station_filter)
        if sn:
            wheres.append(
                {
                    "name": self.definition.sn_field,
                    "value": sn,
                    "displayType": self.definition.sn_display_type,
                }
            )
        payload = {
            "page": page,
            "rows": rows,
            "sort": self.definition.sort_field,
            "order": "desc",
            "wheres": json.dumps(wheres, ensure_ascii=False),
        }
        response = await self._request("POST", self.definition.page_path, json=payload)
        data = response.json()
        if isinstance(data, dict) and self._payload_has_error(data):
            raise RuntimeError(str(data.get("msg") or data.get("message") or "上游查询失败"))
        if not isinstance(data, dict) or not isinstance(data.get("rows"), list):
            raise RuntimeError("上游查询响应缺少 rows")
        return data

    @staticmethod
    def validate_image_path(path: str) -> str:
        normalized = path.strip().replace("\\", "/").lstrip("/")
        parsed = PurePosixPath(normalized)
        if (
            not normalized.startswith("Upload/Tables/")
            or parsed.is_absolute()
            or ".." in parsed.parts
        ):
            raise ValueError("无效的图片路径")
        return normalized

    async def fetch_image(self, path: str) -> tuple[bytes, str]:
        normalized = self.validate_image_path(path)
        url = f"{self.definition.image_base_url}/{quote(normalized, safe='/')}"
        response = await self._request("GET", url)
        return response.content, response.headers.get("content-type", "image/jpeg")
