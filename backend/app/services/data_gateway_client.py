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
from datetime import date, timedelta
from typing import Any

import httpx

from app.core.config import get_settings


class DataGatewayError(RuntimeError):
    """A gateway request failed or returned an invalid response."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        code: str = "DATA_GATEWAY_ERROR",
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.retryable = retryable


def _repair_row_has_planned_field(row: dict[str, Any]) -> bool:
    if "GSTRS" in row or "plannedStartDate" in row:
        return True
    raw = row.get("raw")
    return isinstance(raw, dict) and ("GSTRS" in raw or "plannedStartDate" in raw)


# A full year of station passes is already above one million rows (about 1.67
# million in 2026). Keep a hard ceiling so an unbounded stream cannot exhaust
# the API process, but leave room for the rest of this year.
STATION_STREAM_MAX_ROWS = 500_000
# shortcut: 10,000 rows, update if the gateway stream cap changes.
BOM_STREAM_MAX_ROWS = 10_000
BOM_UNBOUNDED_QUERY_MESSAGE = "BOM 查询必须包含日期、物料号或订单筛选条件，未限定范围的查询已禁用"


def _has_bom_filter(filters: dict[str, Any]) -> bool:
    return any(
        str(filters.get(key) or "").strip()
        for key in (
            "dateFrom",
            "dateTo",
            "from",
            "to",
            "keyword",
            "materialCode",
            "productionOrder",
            "salesOrder",
            "base",
        )
    )


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
        self._list_inflight: dict[object, asyncio.Task[list[dict[str, Any]]]] = {}
        self._text_inflight: dict[object, asyncio.Task[str]] = {}
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
            self._list_inflight.clear()
            self._text_inflight.clear()
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
            self._list_inflight.clear()
            self._text_inflight.clear()

    async def _cached_list(
        self,
        cache: dict[Any, tuple[float, list[dict[str, Any]]]],
        cache_key: Any,
        loader: Any,
        max_rows: int,
    ) -> list[dict[str, Any]]:
        """Reuse a short-lived list response and coalesce concurrent loads."""
        now = time.monotonic()
        async with self._orders_cache_lock:
            cached = cache.get(cache_key)
            if self.cache_ttl > 0 and cached and cached[0] > now:
                items = cached[1]
                task = None
            else:
                if cached:
                    cache.pop(cache_key, None)
                task = self._list_inflight.get(cache_key)
                if task is None:
                    task = asyncio.create_task(loader())
                    self._list_inflight[cache_key] = task
        if task is not None:
            try:
                items = await task
            finally:
                async with self._orders_cache_lock:
                    if self._list_inflight.get(cache_key) is task:
                        self._list_inflight.pop(cache_key, None)
        if len(items) > max_rows:
            raise DataGatewayError(
                f"数据网关结果共 {len(items)} 条，超过本系统单次处理上限 {max_rows} 条；请缩小日期或筛选范围",
                code="QUERY_TOO_LARGE",
            )
        if task is not None and self.cache_ttl > 0:
            async with self._orders_cache_lock:
                now = time.monotonic()
                for expired in [key for key, (expires, _) in cache.items() if expires <= now]:
                    cache.pop(expired, None)
                cache[cache_key] = (now + self.cache_ttl, items)
                while len(cache) > 64:
                    cache.pop(next(iter(cache)))
        return copy.deepcopy(items)

    async def request_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
    ) -> Any:
        if not self.enabled:
            raise DataGatewayError(
                "DATA_GATEWAY_URL 未配置",
                code="DATA_GATEWAY_UNAVAILABLE",
                retryable=False,
            )
        try:
            response = await (await self._http()).request(method, path, params=params, json=json)
        except httpx.TimeoutException as exc:
            raise DataGatewayError(
                "生产数据源响应超时，请缩小查询范围后重试",
                code="DATA_GATEWAY_TIMEOUT",
                retryable=True,
            ) from exc
        except httpx.HTTPError as exc:
            raise DataGatewayError(
                "生产数据源暂时不可用，请稍后重试",
                code="DATA_GATEWAY_UNAVAILABLE",
                retryable=True,
            ) from exc
        try:
            payload = response.json()
        except ValueError as exc:
            raise DataGatewayError(
                "生产数据源返回了无效数据，请联系管理员",
                status_code=response.status_code,
                code="DATA_GATEWAY_BAD_RESPONSE",
            ) from exc
        if not response.is_success:
            detail = payload.get("error") if isinstance(payload, dict) else None
            retryable = response.status_code >= 500 or response.status_code == 429
            raise DataGatewayError(
                detail or "生产数据源拒绝了本次查询",
                status_code=response.status_code,
                code="DATA_GATEWAY_UNAVAILABLE" if retryable else "DATA_GATEWAY_REJECTED",
                retryable=retryable,
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
            raise DataGatewayError(
                "DATA_GATEWAY_URL 未配置",
                code="DATA_GATEWAY_UNAVAILABLE",
                retryable=False,
            )
        if not path.endswith("/stream"):
            return await self._request_text_network(method, path, params=params)

        cache_key = (
            path,
            tuple(sorted((str(key), str(value)) for key, value in (params or {}).items() if value)),
        )
        now = time.monotonic()
        async with self._orders_cache_lock:
            cached = self._text_cache.get(cache_key)
            if self.cache_ttl > 0 and cached and cached[0] > now:
                return cached[1]
            if cached:
                self._text_cache.pop(cache_key, None)
            task = self._text_inflight.get(cache_key)
            if task is None:
                task = asyncio.create_task(self._request_text_network(method, path, params=params))
                self._text_inflight[cache_key] = task
        try:
            text = await task
        finally:
            async with self._orders_cache_lock:
                if self._text_inflight.get(cache_key) is task:
                    self._text_inflight.pop(cache_key, None)
        if self.cache_ttl > 0:
            async with self._orders_cache_lock:
                self._text_cache[cache_key] = (time.monotonic() + self.cache_ttl, text)
        return text

    async def _request_text_network(
        self, method: str, path: str, *, params: dict[str, Any] | None = None
    ) -> str:
        try:
            response = await (await self._http()).request(method, path, params=params)
        except httpx.TimeoutException as exc:
            raise DataGatewayError(
                "生产数据源响应超时，请缩小查询范围后重试",
                code="DATA_GATEWAY_TIMEOUT",
                retryable=True,
            ) from exc
        except httpx.HTTPError as exc:
            raise DataGatewayError(
                "生产数据源暂时不可用，请稍后重试",
                code="DATA_GATEWAY_UNAVAILABLE",
                retryable=True,
            ) from exc
        if not response.is_success:
            try:
                detail = response.json().get("error")
            except ValueError:
                detail = None
            raise DataGatewayError(
                detail or "生产数据源拒绝了本次查询",
                status_code=response.status_code,
                code=(
                    "DATA_GATEWAY_UNAVAILABLE"
                    if response.status_code >= 500 or response.status_code == 429
                    else "DATA_GATEWAY_REJECTED"
                ),
                retryable=response.status_code >= 500 or response.status_code == 429,
            )
        return response.text

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

        async def fetch_page(page: int) -> tuple[list[dict[str, Any]], int]:
            payload = await self.request_json(
                method,
                path,
                params={**(filters or {}), "page": page, "pageSize": 100},
            )
            if not isinstance(payload, dict):
                raise DataGatewayError(
                    "生产数据源返回了无效列表数据，请联系管理员",
                    code="DATA_GATEWAY_BAD_RESPONSE",
                )
            total = payload.get("total")
            items = payload.get("items")
            if items is None and total == 0 and "items" in payload:
                items = []
            if (
                type(total) is not int
                or total < 0
                or not isinstance(items, list)
                or any(not isinstance(item, dict) for item in items)
            ):
                raise DataGatewayError(
                    "生产数据源返回了无效列表数据，请联系管理员",
                    code="DATA_GATEWAY_BAD_RESPONSE",
                )
            if total > max_rows:
                raise DataGatewayError(
                    f"当前查询结果约 {total} 条，超过本系统单次处理上限 {max_rows} 条；请缩小日期或增加筛选条件",
                    code="QUERY_TOO_LARGE",
                )
            if len(items) != min(100, max(0, total - (page - 1) * 100)):
                raise DataGatewayError(
                    "生产数据源分页结果不完整，请稍后重试",
                    code="DATA_GATEWAY_BAD_RESPONSE",
                    retryable=True,
                )
            return items, total

        first_page, total = await fetch_page(1)
        page_count = math.ceil(total / 100)
        semaphore = asyncio.Semaphore(8)

        async def fetch_bounded(page: int) -> list[dict[str, Any]]:
            async with semaphore:
                items, page_total = await fetch_page(page)
            if page_total != total:
                raise DataGatewayError(
                    "生产数据源分页期间记录总数发生变化，请重新查询",
                    code="DATA_GATEWAY_BAD_RESPONSE",
                    retryable=True,
                )
            return items

        page_results = await asyncio.gather(
            *(fetch_bounded(page) for page in range(2, page_count + 1))
        )
        rows = first_page
        for items in page_results:
            rows.extend(items)
        return rows

    async def order_detail(self, order_id: str) -> dict[str, Any]:
        return await self.request_json("GET", "/api/orders/detail", params={"id": order_id})

    async def export_version(self) -> dict[str, str] | None:
        if not self.enabled:
            return None
        try:
            payload = await self.request_json("GET", "/api/exports/version")
        except DataGatewayError as exc:
            if exc.status_code in {404, 405}:
                return None
            raise
        if not isinstance(payload, dict) or any(
            not isinstance(payload.get(key), str) or not payload[key]
            for key in ("orders", "faults", "bindings")
        ):
            raise DataGatewayError("生产数据源导出版本格式错误")
        return {key: payload[key] for key in ("orders", "faults", "bindings")}

    async def export_rows(
        self, resource: str, keys: list[str], *, max_rows: int = 250_000
    ) -> list[dict[str, Any]] | None:
        """Read complete export fields; None means the gateway predates this API."""
        if not self.enabled:
            return None
        if resource not in {"orders", "faults", "bindings", "bom"}:
            raise ValueError("Unknown export resource")
        values = list(dict.fromkeys(keys))
        rows = []
        for index in range(0, len(values), 1000):
            chunk = values[index : index + 1000]
            try:
                payload = await self.request_json(
                    "POST", "/api/exports/rows", json={"resource": resource, "keys": chunk}
                )
            except DataGatewayError as exc:
                if exc.status_code in {404, 405}:
                    return None
                if exc.status_code != 413:
                    raise
                if len(chunk) > 1:
                    middle = len(chunk) // 2
                    left = await self.export_rows(resource, chunk[:middle], max_rows=max_rows)
                    right = await self.export_rows(resource, chunk[middle:], max_rows=max_rows)
                    if left is None or right is None:
                        return None
                    items = left + right
                elif resource in {"faults", "bindings"}:
                    path, field = (
                        ("/api/faults", "productionOrders")
                        if resource == "faults"
                        else ("/api/views/ZSGV_ZPP_SERNOLIST", "headOrder")
                    )
                    filters = {field: chunk[0]}
                    if resource == "faults":
                        filters["timeField"] = "planned"
                    items = await self.all_pages("GET", path, filters=filters, max_rows=max_rows)
                else:
                    raise
            else:
                if (
                    not isinstance(payload, dict)
                    or payload.get("complete") is not True
                    or type(payload.get("total")) is not int
                    or not isinstance(payload.get("items"), list)
                    or payload["total"] != len(payload["items"])
                    or any(not isinstance(item, dict) for item in payload["items"])
                ):
                    raise DataGatewayError("生产数据源导出结果不完整，请重新导出")
                items = payload["items"]
            rows.extend(items)
            if len(rows) > max_rows:
                raise DataGatewayError(
                    "原始导出数据超过处理上限，请缩小筛选范围", code="QUERY_TOO_LARGE"
                )
        return rows

    async def order_stats(self, **filters: str) -> dict[str, Any]:
        return await self.request_json(
            "GET",
            "/api/orders/stats",
            params={key: value for key, value in filters.items() if value},
        )

    async def order_models(self) -> list[str]:
        """Read all distinct source models without paginating production orders."""
        payload = await self.request_json("GET", "/api/orders/models")
        if (
            not isinstance(payload, dict)
            or not isinstance(payload.get("items"), list)
            or any(not isinstance(item, str) for item in payload["items"])
        ):
            raise DataGatewayError(
                "生产数据源返回了无效机型列表，请联系管理员",
                code="DATA_GATEWAY_BAD_RESPONSE",
            )
        return sorted({item.strip() for item in payload["items"] if item.strip()})

    async def order_options(self, *, base: str = "") -> dict[str, list[str]]:
        payload = await self.request_json(
            "GET",
            "/api/orders/options",
            params={"base": base} if base else None,
        )
        fields = (
            "productionOrders",
            "salesOrders",
            "materialNumbers",
            "productModels",
            "bases",
            "customerIds",
        )
        if not isinstance(payload, dict) or any(
            not isinstance(payload.get(field), list)
            or any(not isinstance(item, str) for item in payload[field])
            for field in fields
        ):
            raise DataGatewayError(
                "生产数据源返回了无效订单筛选选项，请联系管理员",
                code="DATA_GATEWAY_BAD_RESPONSE",
            )
        return {
            field: sorted({item.strip() for item in payload[field] if item.strip()})
            for field in fields
        }

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
        self, *, max_rows: int = 1_000_000, source_version: str | None = None, **filters: str
    ) -> list[dict[str, Any]]:
        # Several dashboards request the same order universe during one page
        # load. Reuse it briefly to avoid repeating a large Mongo query while
        # keeping freshness bounded and explicit.
        cache_key = tuple(sorted((str(key), str(value)) for key, value in filters.items() if value))

        async def load() -> list[dict[str, Any]]:
            rows = await self.all_pages("GET", "/api/orders", filters=filters, max_rows=max_rows)
            ids = [row.get("id") for row in rows]
            if any(not isinstance(value, str) or not value for value in ids) or len(
                set(ids)
            ) != len(rows):
                raise DataGatewayError(
                    "生产数据源订单分页存在重复或缺失标识，请重新查询",
                    code="DATA_GATEWAY_BAD_RESPONSE",
                    retryable=True,
                )
            return rows

        return await self._cached_list(
            self._orders_cache, ("orders", source_version, max_rows, cache_key), load, max_rows
        )

    async def fault_lookup(
        self,
        *,
        production_orders: list[str] | None = None,
        sales_orders: list[str] | None = None,
        date_from: str = "",
        date_to: str = "",
        time_field: str = "",
    ) -> list[dict[str, Any]]:
        body: dict[str, Any] = {
            "productionOrders": production_orders or [],
            "salesOrders": sales_orders or [],
            "dateFrom": date_from,
            "dateTo": date_to,
        }
        if time_field:
            body["timeField"] = time_field
        payload = await self.request_json(
            "POST",
            "/api/faults/lookup",
            json=body,
        )
        if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
            raise DataGatewayError(
                "生产数据源返回了无效故障关联数据，请联系管理员",
                code="DATA_GATEWAY_BAD_RESPONSE",
            )
        return [item for item in payload["items"] if isinstance(item, dict)]

    async def fault_rows_by_sns(
        self,
        sns: list[str],
        *,
        date_from: str = "",
        date_to: str = "",
        station: str = "",
        time_field: str = "",
    ) -> list[dict[str, Any]]:
        # The gateway bulk cap is 10,000 SNs. POST stays on the PCODE index and
        # avoids the paginated GET, which counts, sorts, and overflows the URL
        # once a station month contains a few thousand serial numbers.
        values = list(dict.fromkeys(value.strip() for value in sns if value and value.strip()))
        if not values:
            return []
        rows: list[dict[str, Any]] = []
        for index in range(0, len(values), 5_000):
            body: dict[str, Any] = {
                "sns": values[index : index + 5_000],
                "dateFrom": date_from,
                "dateTo": date_to,
                "station": station,
            }
            if time_field:
                body["timeField"] = time_field
            payload = await self.request_json("POST", "/api/faults/by-sns", json=body)
            if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
                raise DataGatewayError(
                    "生产数据源返回了无效 SN 故障数据，请联系管理员",
                    code="DATA_GATEWAY_BAD_RESPONSE",
                )
            rows.extend(item for item in payload["items"] if isinstance(item, dict))
        # Older gateways ignore timeField and omit GSTRS, so a planned-date
        # request would otherwise drop every repair in the local date check.
        if (
            time_field == "planned"
            and (date_from or date_to)
            and rows
            and not _repair_row_has_planned_field(rows[0])
        ):
            return await self._fault_rows_by_sns_paged(
                values,
                date_from=date_from,
                date_to=date_to,
                station=station,
                time_field=time_field,
            )
        return rows

    async def _fault_rows_by_sns_paged(
        self,
        sns: list[str],
        *,
        date_from: str,
        date_to: str,
        station: str,
        time_field: str,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        # Keep each hostBarcode query under common reverse-proxy URL limits.
        for index in range(0, len(sns), 200):
            chunk = sns[index : index + 200]
            rows.extend(
                await self.all_pages(
                    "GET",
                    "/api/faults/by-sns",
                    filters={
                        "hostBarcode": ",".join(chunk),
                        "dateFrom": date_from,
                        "dateTo": date_to,
                        "station": station,
                        "timeField": time_field,
                    },
                    max_rows=250_000,
                )
            )
        return rows

    async def fault_rows_by_host_barcodes(
        self,
        host_barcodes: list[str],
        *,
        date_from: str = "",
        date_to: str = "",
        time_field: str = "",
        max_rows: int = 250_000,
    ) -> list[dict[str, Any]]:
        """Read full fault documents for a bounded set of host barcodes."""
        values = list(dict.fromkeys(value.strip() for value in host_barcodes if value.strip()))
        if not values:
            return []
        filters = {
            "hostBarcode": ",".join(values),
            "dateFrom": date_from,
            "dateTo": date_to,
        }
        if time_field:
            filters["timeField"] = time_field
        return await self.all_pages(
            "GET",
            "/api/faults",
            filters=filters,
            max_rows=max_rows,
        )

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

        async def load() -> list[dict[str, Any]]:
            payload = await self.request_json("GET", f"/api/views/{view_id}/all", params=filters)
            if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
                raise DataGatewayError("数据网关视图响应格式错误")
            return [item for item in payload["items"] if isinstance(item, dict)]

        return await self._cached_list(self._views_cache, ("view", cache_key), load, max_rows)

    async def all_bom_rows(
        self, *, max_rows: int = 1_000_000, **filters: str
    ) -> list[dict[str, Any]]:
        """Read the BOM source projection through the low-overhead CSV stream."""
        if not _has_bom_filter(filters):
            raise DataGatewayError(
                BOM_UNBOUNDED_QUERY_MESSAGE,
                code="QUERY_TOO_LARGE",
            )
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
                        "生产数据源拒绝了本次 BOM 查询",
                        status_code=response.status_code,
                        code=(
                            "DATA_GATEWAY_UNAVAILABLE"
                            if response.status_code >= 500 or response.status_code == 429
                            else "DATA_GATEWAY_REJECTED"
                        ),
                        retryable=response.status_code >= 500 or response.status_code == 429,
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
                    raise DataGatewayError(
                        "BOM 查询结果超过本系统单次处理上限，请缩小日期或增加筛选条件",
                        code="QUERY_TOO_LARGE",
                    )
        except httpx.TimeoutException as exc:
            raise DataGatewayError(
                "生产数据源响应超时，请缩小查询范围后重试",
                code="DATA_GATEWAY_TIMEOUT",
                retryable=True,
            ) from exc
        except httpx.HTTPError as exc:
            raise DataGatewayError(
                "生产数据源暂时不可用，请稍后重试",
                code="DATA_GATEWAY_UNAVAILABLE",
                retryable=True,
            ) from exc
        # Older gateway deployments expose GSTRS in the paginated BOM view
        # but not in the low-overhead stream. LRR cannot calculate its month
        # denominator without that field, so transparently use the complete
        # view until the stream deployment is upgraded. Keep the date meaning
        # explicit because the paginated view has more than one date column.
        if "GSTRS" not in fields:
            return await self.all_pages(
                "GET",
                "/api/views/ZSGV_ZSD124",
                filters={**filters, "timeField": "planned"},
                max_rows=max_rows,
            )
        if len(rows) == BOM_STREAM_MAX_ROWS:
            try:
                start = date.fromisoformat(filters.get("dateFrom", ""))
                end = date.fromisoformat(filters.get("dateTo", ""))
            except ValueError:
                start = end = None
            if start and end and start < end:
                # The stream truncates silently at 10,000 rows. Split a broad
                # range into indexed daily streams instead of the slow view.
                days = [start + timedelta(days=index) for index in range((end - start).days + 1)]
                semaphore = asyncio.Semaphore(16)

                async def read_day(day: date) -> list[dict[str, Any]]:
                    async with semaphore:
                        return await self.all_bom_rows(
                            max_rows=max_rows,
                            **{
                                **filters,
                                "dateFrom": day.isoformat(),
                                "dateTo": day.isoformat(),
                            },
                        )

                batches = await asyncio.gather(*(read_day(day) for day in days))
                rows = [row for batch in batches for row in batch]
                if len(rows) > max_rows:
                    raise DataGatewayError(
                        "BOM 查询结果超过本系统单次处理上限，请缩小日期或增加筛选条件",
                        code="QUERY_TOO_LARGE",
                    )
            else:
                raise DataGatewayError(
                    "BOM 查询结果达到网关单次上限，请缩小日期或增加筛选条件",
                    code="QUERY_TOO_LARGE",
                )
        if len(rows) > max_rows:
            raise DataGatewayError(
                "BOM 查询结果超过本系统单次处理上限，请缩小日期或增加筛选条件",
                code="QUERY_TOO_LARGE",
            )
        if self.cache_ttl > 0:
            async with self._orders_cache_lock:
                self._text_cache[cache_key] = (time.monotonic() + self.cache_ttl, rows)
        return rows

    async def all_station_rows(
        self, *, max_rows: int = STATION_STREAM_MAX_ROWS, **filters: str
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
                        "生产数据源拒绝了本次工位查询",
                        status_code=response.status_code,
                        code=(
                            "DATA_GATEWAY_UNAVAILABLE"
                            if response.status_code >= 500 or response.status_code == 429
                            else "DATA_GATEWAY_REJECTED"
                        ),
                        retryable=response.status_code >= 500 or response.status_code == 429,
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
                        raise DataGatewayError(
                            f"工位查询结果超过本系统单次处理上限 {max_rows} 条，请缩小日期或增加筛选条件",
                            code="QUERY_TOO_LARGE",
                        )
        except httpx.TimeoutException as exc:
            raise DataGatewayError(
                "生产数据源响应超时，请缩小查询范围后重试",
                code="DATA_GATEWAY_TIMEOUT",
                retryable=True,
            ) from exc
        except httpx.HTTPError as exc:
            raise DataGatewayError(
                "生产数据源暂时不可用，请稍后重试",
                code="DATA_GATEWAY_UNAVAILABLE",
                retryable=True,
            ) from exc
        if filters.get("timeField") == "planned" and "GSTRS" not in fields:
            # Older gateway deployments omit the planned start date from the
            # station stream projection. Use the paginated view so the RTY
            # service can enforce its GSTRS date contract locally.
            return await self.all_pages(
                "GET",
                "/api/views/Z_V_ZMES_T_001",
                filters={**filters, "timeField": "planned"},
                max_rows=max_rows,
            )
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

    async def scs_doa_page(
        self, *, page: int = 1, page_size: int = 20, **filters: str
    ) -> dict[str, Any]:
        return await self.view("SCS_DOA", page=page, page_size=page_size, **filters)

    async def scs_change_page(
        self, *, page: int = 1, page_size: int = 20, **filters: str
    ) -> dict[str, Any]:
        return await self.view("SCS_CHANGE", page=page, page_size=page_size, **filters)

    async def view_detail(self, view_id: str, record_id: str) -> dict[str, Any]:
        return await self.request_json(
            "GET", f"/api/views/{view_id}/detail", params={"id": record_id}
        )


data_gateway = DataGatewayClient()
