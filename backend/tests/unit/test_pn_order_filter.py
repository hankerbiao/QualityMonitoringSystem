from unittest.mock import AsyncMock

import pytest

from app.services import pn_order_filter
from app.services.async_ttl_cache import AsyncTTLCache


@pytest.mark.asyncio
async def test_reversed_orders_preserves_legacy_behavior_when_bulk_export_is_unavailable(monkeypatch):
    monkeypatch.setattr(pn_order_filter.data_gateway, "base_url", "http://gateway.test")
    monkeypatch.setattr(pn_order_filter, "_REVERSAL_CACHE", AsyncTTLCache(max_entries=32))
    monkeypatch.setattr(pn_order_filter.data_gateway, "export_rows", AsyncMock(return_value=None))

    result = await pn_order_filter.reversed_orders(["1", "2"])

    assert result == set()
