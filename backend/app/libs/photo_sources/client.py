"""带独立登录会话的实时影像数据源客户端。"""

import asyncio
import json
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import quote

import httpx
from faker import Faker


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

    def __init__(self, definition: SourceDefinition, username: str, password: str):
        self.definition = definition
        self.username = username
        self.password = password
        self._faker = Faker()
        self._logged_in = False
        self._login_lock = asyncio.Lock()
        self._client = httpx.AsyncClient(
            base_url=definition.api_base_url,
            timeout=httpx.Timeout(20.0, connect=8.0),
            trust_env=False,
            follow_redirects=True,
        )

    def _headers(self) -> dict[str, str]:
        return {"User-Agent": self._faker.user_agent()}

    async def close(self) -> None:
        await self._client.aclose()

    async def login(self, force: bool = False) -> dict[str, Any]:
        async with self._login_lock:
            if self._logged_in and not force:
                return {}

            response = await self._client.post(
                "/api/user/login",
                json={"userName": self.username, "password": self.password},
                headers=self._headers(),
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise RuntimeError("登录响应格式无效")
            status_value = payload.get("status")
            if (
                status_value is False
                or status_value not in (None, 0, True)
                or payload.get("success") is False
            ):
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
            self._logged_in = True
            return payload

    async def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        await self.login()
        response = await self._client.request(method, url, headers=self._headers(), **kwargs)
        if response.status_code in (401, 403):
            self._logged_in = False
            await self.login(force=True)
            response = await self._client.request(method, url, headers=self._headers(), **kwargs)
        response.raise_for_status()
        return response

    async def get_login_status(self) -> dict[str, Any]:
        """验证当前登录状态；上游无该端点时仍以已成功登录为准。"""
        await self.login()
        response = await self._client.post(
            "/api/user/GetCurrentUserInfo",
            headers=self._headers(),
        )
        if response.status_code == 404:
            return {"loggedIn": self._logged_in}
        if response.status_code in (401, 403):
            self._logged_in = False
            await self.login(force=True)
            response = await self._client.post(
                "/api/user/GetCurrentUserInfo",
                headers=self._headers(),
            )
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, dict) else {"loggedIn": True}

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
        if not isinstance(data, dict) or not isinstance(data.get("rows"), list):
            raise RuntimeError("上游查询响应缺少 rows")
        if data.get("status") not in (None, 0, True):
            raise RuntimeError(str(data.get("msg") or "上游查询失败"))
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
