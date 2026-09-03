"""HTTP client for the independent production-fault data gateway.

The gateway owns SAP/HANA synchronisation and exposes read-only Mongo-backed
query APIs.  This client deliberately contains no dashboard business logic;
callers can migrate one data flow at a time while retaining the existing BFF
contracts.
"""

from __future__ import annotations

import asyncio
import copy
import math
import time
from contextlib import suppress
from typing import Any

import httpx

from app.core.config import get_settings


class DataGatewayError(RuntimeError):
    """A gateway request failed or returned an invalid response."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class DataGatewayClient:
    """Small async client with bounded timeouts and consistent errors."""

    def __init__(self, base_url: str | None = None, timeout: float | None = None) -> None:
        settings = get_settings()
        configured = base_url if base_url is not None else settings.DATA_GATEWAY_URL
        self.base_url = configured.rstrip("/")
        self.timeout = timeout if timeout is not None else settings.DATA_GATEWAY_TIMEOUT_SECONDS
        self.cache_ttl = max(0.0, settings.DATA_GATEWAY_CACHE_TTL_SECONDS)
        self._client: httpx.AsyncClient | None = None
        self._orders_cache: dict[
            tuple[tuple[str, str], ...], tuple[float, list[dict[str, Any]]]
        ] = {}
        self._views_cache: dict[
            tuple[str, tuple[tuple[str, str], ...]], tuple[float, list[dict[str, Any]]]
        ] = {}
        self._text_cache: dict[tuple[str, tuple[tuple[str, str], ...]], tuple[float, Any]] = {}
        self._orders_cache_lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.base_url)

    async def _http(self) -> httpx.AsyncClient:
        loop = asyncio.get_running_loop()
        if self._loop is not None and self._loop is not loop:
            # Test clients and short-lived jobs may reuse this singleton from
            # another event loop. httpx pools are loop-bound, so discard the
            # stale pool instead of surfacing "Event loop is closed".
            if self._client is not None:
                with suppress(RuntimeError):
                    await self._client.aclose()
            self._client = None
            self._orders_cache.clear()
            self._views_cache.clear()
            self._text_cache.clear()
            self._orders_cache_lock = asyncio.Lock()
        self._loop = loop
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(self.timeout, connect=min(self.timeout, 5.0)),
                headers={"Accept": "application/json"},
                # The gateway is a local/private service. Avoid inheriting a
                # shell proxy and keep connections warm across RTY subqueries.
                trust_env=False,
                limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
        async with self._orders_cache_lock:
            self._orders_cache.clear()
            self._views_cache.clear()
            self._text_cache.clear()

    async def request_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
    ) -> Any:
        if not self.enabled:
            raise DataGatewayError("DATA_GATEWAY_URL 未配置")
        try:
            response = await (await self._http()).request(method, path, params=params, json=json)
        except httpx.TimeoutException as exc:
            raise DataGatewayError("数据网关请求超时") from exc
        except httpx.HTTPError as exc:
            raise DataGatewayError(f"数据网关连接失败: {exc}") from exc
        try:
            payload = response.json()
        except ValueError as exc:
            raise DataGatewayError(
                "数据网关返回了无效 JSON", status_code=response.status_code
            ) from exc
        if not response.is_success:
            detail = payload.get("error") if isinstance(payload, dict) else None
            raise DataGatewayError(
                detail or f"数据网关请求失败 ({response.status_code})",
                status_code=response.status_code,
            )
        return payload

    async def request_text(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> str:
        if not self.enabled:
            raise DataGatewayError("DATA_GATEWAY_URL 未配置")
        cache_key = (
            path,
            tuple(sorted((str(key), str(value)) for key, value in (params or {}).items() if value)),
        )
        now = time.monotonic()
        if self.cache_ttl > 0 and path.endswith("/stream"):
            async with self._orders_cache_lock:
                cached = self._text_cache.get(cache_key)
                if cached and cached[0] > now:
                    return cached[1]
                if cached:
                    self._text_cache.pop(cache_key, None)
        try:
            response = await (await self._http()).request(method, path, params=params)
        except httpx.TimeoutException as exc:
            raise DataGatewayError("数据网关请求超时") from exc
        except httpx.HTTPError as exc:
            raise DataGatewayError(f"数据网关连接失败: {exc}") from exc
        if not response.is_success:
            try:
                detail = response.json().get("error")
            except ValueError:
                detail = None
            raise DataGatewayError(
                detail or f"数据网关请求失败 ({response.status_code})",
                status_code=response.status_code,
            )
        text = response.text
        if self.cache_ttl > 0 and path.endswith("/stream"):
            async with self._orders_cache_lock:
                self._text_cache[cache_key] = (time.monotonic() + self.cache_ttl, text)
        return text

    async def health(self) -> dict[str, Any]:
        return await self.request_json("GET", "/api/health")

    async def faults(self, *, page: int = 1, page_size: int = 20, **filters: str) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "pageSize": page_size}
        params.update({key: value for key, value in filters.items() if value})
        return await self.request_json("GET", "/api/faults", params=params)

    async def fault_detail(self, record_id: str) -> dict[str, Any]:
        return await self.request_json("GET", "/api/faults/detail", params={"id": record_id})

    async def orders(self, *, page: int = 1, page_size: int = 20, **filters: str) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "pageSize": page_size}
        params.update({key: value for key, value in filters.items() if value})
        return await self.request_json("GET", "/api/orders", params=params)

    async def all_pages(
        self,
        method: str,
        path: str,
        *,
        filters: dict[str, Any] | None = None,
        max_rows: int = 250_000,
    ) -> list[dict[str, Any]]:
        """Read a bounded complete result set from a gateway list endpoint."""
        request_filters = {"pageSize": 100, **(filters or {})}

        async def fetch_page(page: int) -> tuple[list[dict[str, Any]], int]:
            payload = await self.request_json(
                method,
                path,
                params={"page": page, **request_filters},
            )
            if not isinstance(payload, dict):
                raise DataGatewayError("数据网关列表响应格式错误")
            items = payload.get("items") or []
            if not isinstance(items, list):
                raise DataGatewayError("数据网关列表响应格式错误")
            raw_total = payload.get("total")
            try:
                total = int(raw_total) if raw_total is not None else len(items)
            except (TypeError, ValueError) as exc:
                raise DataGatewayError("数据网关列表响应格式错误") from exc
            if total > max_rows:
                raise DataGatewayError(
                    f"数据网关结果共 {total} 条，超过本系统单次处理上限 {max_rows} 条；请缩小日期或筛选范围"
                )
            return [item for item in items if isinstance(item, dict)], total

        first_page, total = await fetch_page(1)
        if not first_page or total <= len(first_page):
            return first_page[:max_rows]
        page_count = min(math.ceil(total / 100), math.ceil(max_rows / 100))
        semaphore = asyncio.Semaphore(8)

        async def fetch_bounded(page: int) -> tuple[int, list[dict[str, Any]]]:
            async with semaphore:
                items, _ = await fetch_page(page)
            return page, items

        page_results = await asyncio.gather(
            *(fetch_bounded(page) for page in range(2, page_count + 1))
        )
        rows = first_page
        for _, items in sorted(page_results):
            rows.extend(items)
        if len(rows) < total and len(rows) < max_rows:
            raise DataGatewayError("数据网关分页响应不完整")
        return rows[:max_rows]

    async def order_detail(self, order_id: str) -> dict[str, Any]:
        return await self.request_json("GET", "/api/orders/detail", params={"id": order_id})

    async def order_stats(self, **filters: str) -> dict[str, Any]:
        return await self.request_json(
            "GET",
            "/api/orders/stats",
            params={key: value for key, value in filters.items() if value},
        )

    async def sync_status(self) -> dict[str, Any]:
        return await self.request_json("GET", "/api/sync/status")

    async def data_status(self) -> dict[str, Any]:
        return await self.request_json("GET", "/api/data-status")

    async def view(
        self,
        view_id: str,
        *,
        page: int = 1,
        page_size: int = 20,
        keyword: str = "",
        date_from: str = "",
        date_to: str = "",
        **filters: str,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "page": page,
            "pageSize": page_size,
            "keyword": keyword,
            "from": date_from,
            "to": date_to,
        }
        params.update({key: value for key, value in filters.items() if value != ""})
        return await self.request_json(
            "GET",
            f"/api/views/{view_id}",
            params={key: value for key, value in params.items() if value != ""},
        )

    async def all_orders(
        self, *, max_rows: int = 1_000_000, **filters: str
    ) -> list[dict[str, Any]]:
        # Several dashboards request the same order universe during one page
        # load. Reuse it briefly to avoid repeating a large Mongo query while
        # keeping freshness bounded and explicit.
        cache_key = tuple(sorted((str(key), str(value)) for key, value in filters.items() if value))
        now = time.monotonic()
        if self.cache_ttl > 0:
            async with self._orders_cache_lock:
                cached = self._orders_cache.get(cache_key)
                if cached and cached[0] > now:
                    return copy.deepcopy(cached[1][:max_rows])
                if cached:
                    self._orders_cache.pop(cache_key, None)
        payload = await self.request_json("GET", "/api/orders/all", params=filters)
        if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
            raise DataGatewayError("数据网关订单响应格式错误")
        items = [item for item in payload["items"] if isinstance(item, dict)]
        if len(items) > max_rows:
            raise DataGatewayError(
                f"数据网关结果共 {len(items)} 条，超过本系统单次处理上限 {max_rows} 条；请缩小日期或筛选范围"
            )
        if self.cache_ttl > 0:
            async with self._orders_cache_lock:
                self._orders_cache[cache_key] = (time.monotonic() + self.cache_ttl, items)
        return copy.deepcopy(items)

    async def fault_lookup(
        self,
        *,
        production_orders: list[str] | None = None,
        sales_orders: list[str] | None = None,
        date_from: str = "",
        date_to: str = "",
    ) -> list[dict[str, Any]]:
        payload = await self.request_json(
            "POST",
            "/api/faults/lookup",
            json={
                "productionOrders": production_orders or [],
                "salesOrders": sales_orders or [],
                "dateFrom": date_from,
                "dateTo": date_to,
            },
        )
        if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
            raise DataGatewayError("数据网关故障关联响应格式错误")
        return [item for item in payload["items"] if isinstance(item, dict)]

    async def fault_rows_by_sns(
        self,
        sns: list[str],
        *,
        date_from: str = "",
        date_to: str = "",
        station: str = "",
    ) -> list[dict[str, Any]]:
        payload = await self.request_json(
            "POST",
            "/api/faults/by-sns",
            json={"sns": sns, "dateFrom": date_from, "dateTo": date_to, "station": station},
        )
        if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
            raise DataGatewayError("数据网关 SN 故障响应格式错误")
        return [item for item in payload["items"] if isinstance(item, dict)]

    async def all_faults(
        self, *, max_rows: int = 1_000_000, **filters: str
    ) -> list[dict[str, Any]]:
        return await self.all_pages("GET", "/api/faults", filters=filters, max_rows=max_rows)

    async def all_view(
        self, view_id: str, *, max_rows: int = 1_000_000, **filters: str
    ) -> list[dict[str, Any]]:
        cache_key = (
            view_id,
            tuple(sorted((str(key), str(value)) for key, value in filters.items() if value)),
        )
        now = time.monotonic()
        if self.cache_ttl > 0:
            async with self._orders_cache_lock:
                cached = self._views_cache.get(cache_key)
                if cached and cached[0] > now:
                    return copy.deepcopy(cached[1][:max_rows])
                if cached:
                    self._views_cache.pop(cache_key, None)
        payload = await self.request_json("GET", f"/api/views/{view_id}/all", params=filters)
        if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
            raise DataGatewayError("数据网关视图响应格式错误")
        items = [item for item in payload["items"] if isinstance(item, dict)]
        if len(items) > max_rows:
            raise DataGatewayError("数据网关视图结果超过单次处理上限")
        if self.cache_ttl > 0:
            async with self._orders_cache_lock:
                self._views_cache[cache_key] = (time.monotonic() + self.cache_ttl, items)
        return copy.deepcopy(items)

    async def all_bom_rows(
        self, *, max_rows: int = 1_000_000, **filters: str
    ) -> list[dict[str, Any]]:
        """Read the BOM source projection through the low-overhead CSV stream."""
        cache_key = (
            "/api/views/ZSGV_ZSD124/stream",
            tuple(sorted((str(key), str(value)) for key, value in filters.items() if value)),
        )
        now = time.monotonic()
        if self.cache_ttl > 0:
            async with self._orders_cache_lock:
                cached = self._text_cache.get(cache_key)
                if cached and cached[0] > now and isinstance(cached[1], list):
                    return copy.deepcopy(cached[1][:max_rows])
        try:
            async with (await self._http()).stream(
                "GET", "/api/views/ZSGV_ZSD124/stream", params=filters
            ) as response:
                if not response.is_success:
                    raise DataGatewayError(
                        f"数据网关请求失败 ({response.status_code})",
                        status_code=response.status_code,
                    )
                fields: list[str] = []
                rows: list[dict[str, Any]] = []
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    values = line.split("\t")
                    if not fields:
                        fields = values
                        continue
                    rows.append(dict(zip(fields, values, strict=False)))
                    if len(rows) > max_rows:
                        raise DataGatewayError("数据网关 BOM 结果超过单次处理上限")
        except httpx.TimeoutException as exc:
            raise DataGatewayError("数据网关请求超时") from exc
        except httpx.HTTPError as exc:
            raise DataGatewayError(f"数据网关连接失败: {exc}") from exc
        if len(rows) > max_rows:
            raise DataGatewayError("数据网关 BOM 结果超过单次处理上限")
        if self.cache_ttl > 0:
            async with self._orders_cache_lock:
                self._text_cache[cache_key] = (time.monotonic() + self.cache_ttl, rows)
        return rows

    async def all_station_rows(
        self, *, max_rows: int = 1_000_000, **filters: str
    ) -> list[dict[str, Any]]:
        """Read the station source projection through the TSV stream."""
        cache_key = (
            "/api/views/Z_V_ZMES_T_001/stream",
            tuple(sorted((str(key), str(value)) for key, value in filters.items() if value)),
        )
        now = time.monotonic()
        if self.cache_ttl > 0:
            async with self._orders_cache_lock:
                cached = self._text_cache.get(cache_key)
                if cached and cached[0] > now and isinstance(cached[1], list):
                    return copy.deepcopy(cached[1][:max_rows])
                if cached:
                    self._text_cache.pop(cache_key, None)
        try:
            async with (await self._http()).stream(
                "GET", "/api/views/Z_V_ZMES_T_001/stream", params=filters
            ) as response:
                if not response.is_success:
                    raise DataGatewayError(
                        f"数据网关请求失败 ({response.status_code})",
                        status_code=response.status_code,
                    )
                fields: list[str] = []
                rows: list[dict[str, Any]] = []
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    values = line.split("\t")
                    if not fields:
                        fields = values
                        continue
                    rows.append(dict(zip(fields, values, strict=False)))
                    if len(rows) > max_rows:
                        raise DataGatewayError("数据网关工位结果超过单次处理上限")
        except httpx.TimeoutException as exc:
            raise DataGatewayError("数据网关请求超时") from exc
        except httpx.HTTPError as exc:
            raise DataGatewayError(f"数据网关连接失败: {exc}") from exc
        if self.cache_ttl > 0:
            async with self._orders_cache_lock:
                self._text_cache[cache_key] = (time.monotonic() + self.cache_ttl, rows)
        return rows

    async def view_stats(
        self, view_id: str, *, keyword: str = "", date_from: str = "", date_to: str = ""
    ) -> dict[str, Any]:
        params = {"keyword": keyword, "from": date_from, "to": date_to}
        return await self.request_json(
            "GET",
            f"/api/views/{view_id}/stats",
            params={key: value for key, value in params.items() if value != ""},
        )

    async def view_detail(self, view_id: str, record_id: str) -> dict[str, Any]:
        return await self.request_json(
            "GET", f"/api/views/{view_id}/detail", params={"id": record_id}
        )


data_gateway = DataGatewayClient()
