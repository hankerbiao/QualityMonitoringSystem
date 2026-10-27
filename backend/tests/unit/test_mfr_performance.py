import asyncio
from unittest.mock import AsyncMock

import pytest

from app.schemas.mfr import MFRFilters
from app.services import mfr_service
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.data_gateway_client import DataGatewayError


@pytest.fixture
def sources(monkeypatch):
    monkeypatch.setattr(mfr_service, "_MFR_ORDER_CACHE", AsyncTTLCache(max_entries=4), raising=False)
    version = {"orders": "v1", "faults": "f1", "bindings": "b1"}
    order_calls = []

    async def export_version():
        return dict(version)

    async def orders(**kwargs):
        order_calls.append(kwargs)
        quantity = 10 if version["orders"] == "v1" else 20
        return [{"orderQuantity": quantity, "raw": {"data": {"VBELN": "1", "MAKTX_TH": "M1"}}}]

    scs = AsyncMock(return_value=[])
    monkeypatch.setattr(mfr_service.data_gateway, "export_version", export_version)
    monkeypatch.setattr(mfr_service.data_gateway, "all_orders", orders)
    monkeypatch.setattr(mfr_service.scs_gateway, "all", scs)
    return version, order_calls, scs


async def test_mfr_reuses_order_snapshot_across_filters_and_refreshes_on_version_change(sources):
    version, order_calls, scs = sources
    doa_rows = [{
        "service_order": "S1", "sales_order": "1", "factory_date": "2026-01-01",
        "warranty_end_date": "2027-01-01",
    }]
    scs.side_effect = lambda view, **kwargs: list(doa_rows) if view == "SCS_DOA" else []
    first = await mfr_service._build_mfr_dashboard(
        MFRFilters(dateFrom="2026-01-01", dateTo="2026-01-31")
    )
    doa_rows.clear()
    second = await mfr_service._build_mfr_dashboard(
        MFRFilters(dateFrom="2026-02-01", dateTo="2026-02-28")
    )
    assert first.summary.fleetCount == 10
    assert second.summary.fleetCount == 0
    assert len(order_calls) == 1
    version["orders"] = "v2"
    doa_rows.append({
        "service_order": "S1", "sales_order": "1", "factory_date": "2026-01-01",
        "warranty_end_date": "2027-01-01",
    })
    third = await mfr_service._build_mfr_dashboard(
        MFRFilters(dateFrom="2026-03-01", dateTo="2026-03-31")
    )
    assert third.summary.fleetCount == 20
    assert len(order_calls) == 2


async def test_mfr_does_not_cache_snapshot_when_order_version_changes_during_load(sources, monkeypatch):
    version, order_calls, _ = sources
    original = mfr_service.data_gateway.all_orders

    async def changing_orders(**kwargs):
        result = await original(**kwargs)
        version["orders"] = "v2"
        return result

    monkeypatch.setattr(mfr_service.data_gateway, "all_orders", changing_orders)
    filters = MFRFilters(dateFrom="2026-01-01", dateTo="2026-01-31")
    with pytest.raises(DataGatewayError, match="版本发生变化"):
        await mfr_service._build_mfr_dashboard(filters)
    result = await mfr_service._build_mfr_dashboard(filters)
    assert result.summary.ordersMissingWarrantyDates == 1
    assert len(order_calls) == 2


async def test_mfr_version_unavailable_preserves_uncached_order_reads(sources, monkeypatch):
    _, order_calls, _ = sources
    monkeypatch.setattr(mfr_service.data_gateway, "export_version", AsyncMock(return_value=None))
    filters = MFRFilters(dateFrom="2026-01-01", dateTo="2026-01-31")
    await mfr_service._build_mfr_dashboard(filters)
    await mfr_service._build_mfr_dashboard(filters)
    assert len(order_calls) == 2


async def test_mfr_falls_back_to_original_read_when_version_request_fails(sources, monkeypatch):
    _, order_calls, _ = sources
    monkeypatch.setattr(
        mfr_service.data_gateway, "export_version", AsyncMock(side_effect=DataGatewayError("unavailable"))
    )
    result = await mfr_service._build_mfr_dashboard(
        MFRFilters(dateFrom="2026-01-01", dateTo="2026-01-31")
    )
    assert result.summary.ordersMissingWarrantyDates == 1
    assert len(order_calls) == 1


async def test_mfr_concurrent_queries_share_the_order_snapshot_load(sources, monkeypatch):
    _, order_calls, _ = sources
    original = mfr_service.data_gateway.all_orders

    async def slow_orders(**kwargs):
        await asyncio.sleep(0.01)
        return await original(**kwargs)

    monkeypatch.setattr(mfr_service.data_gateway, "all_orders", slow_orders)
    results = await asyncio.gather(*[
        mfr_service._build_mfr_dashboard(MFRFilters(dateFrom=f"2026-0{month}-01", dateTo=f"2026-0{month}-28"))
        for month in (1, 2, 3)
    ])
    assert [result.summary.ordersMissingWarrantyDates for result in results] == [1, 1, 1]
    assert len(order_calls) == 1


async def test_mfr_loads_orders_and_doa_concurrently(monkeypatch):
    doa_started = asyncio.Event()
    orders_started = asyncio.Event()

    async def orders():
        orders_started.set()
        await asyncio.wait_for(doa_started.wait(), timeout=0.5)
        return {}

    async def scs(view, **_kwargs):
        assert view == "SCS_DOA"
        doa_started.set()
        await asyncio.wait_for(orders_started.wait(), timeout=0.5)
        return []

    monkeypatch.setattr(mfr_service, "_mfr_orders", orders)
    monkeypatch.setattr(mfr_service.scs_gateway, "all", scs)
    result = await mfr_service._build_mfr_dashboard(
        MFRFilters(dateFrom="2026-01-01", dateTo="2026-01-31")
    )
    assert result.summary.faultCount == 0
