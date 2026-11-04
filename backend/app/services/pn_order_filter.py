"""Shared order eligibility rules for PN-based dashboard calculations."""

from __future__ import annotations

from typing import Any

from app.core.logger import log_warning
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.data_gateway_client import DataGatewayError, data_gateway
from app.services.rty_shared import (
    EXCLUDED_ORDER_STATUSES,
    EXCLUDED_ORDER_TYPES,
    normalize_order,
    order_variants,
)

_REVERSAL_CACHE = AsyncTTLCache(max_entries=32)


def is_excluded_order(status: Any = "", order_type: Any = "", reversal_flag: Any = "") -> bool:
    """Whether a production order is excluded from PN denominator calculations."""
    return (
        str(status or "").strip() in EXCLUDED_ORDER_STATUSES
        or str(order_type or "").strip() in EXCLUDED_ORDER_TYPES
        or str(reversal_flag or "").strip().upper() == "X"
    )


def source_data(item: dict[str, Any]) -> dict[str, Any]:
    raw = item.get("raw") if isinstance(item.get("raw"), dict) else item
    data = raw.get("data") if isinstance(raw.get("data"), dict) else raw
    return data if isinstance(data, dict) else {}


async def reversed_orders(order_numbers: list[str] | set[str]) -> set[str]:
    """Return selected orders with any BOM posting marked CXFLG=X."""
    values = sorted({normalize_order(value) for value in order_numbers if normalize_order(value)})
    if not values or not data_gateway.enabled:
        return set()
    key = (data_gateway.base_url, tuple(values))

    async def load() -> set[str]:
        rows = await data_gateway.export_rows(
            "bom",
            sorted({variant for value in values for variant in order_variants([value])}),
            max_rows=1_000_000,
        )
        if rows is None:
            log_warning(
                "生产数据源不支持 BOM 批量导出，跳过 CXFLG 冲销订单过滤；保留既有订单计算口径"
            )
            return set()
        reversed_values: set[str] = set()
        for item in rows:
            data = source_data(item)
            number = normalize_order(data.get("AUFNR_1") or data.get("AUFNR"))
            if not number or number not in values:
                raise DataGatewayError("BOM 过账查询返回了未选择或缺少生产订单的记录")
            if str(data.get("CXFLG") or "").strip().upper() == "X":
                reversed_values.add(number)
        return reversed_values

    return await _REVERSAL_CACHE.get_or_set(key, load, ttl_seconds=60)
