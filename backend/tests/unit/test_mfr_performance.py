import asyncio
from unittest.mock import AsyncMock

from app.schemas.mfr import MFRDashboardResponse, MFRFilters, MFRSummary
from app.services import mfr_service
from app.services.async_ttl_cache import AsyncTTLCache


async def test_dashboard_reuses_same_filter_cache_and_isolates_filters(monkeypatch):
    monkeypatch.setattr(mfr_service, "_MFR_DASHBOARD_CACHE", AsyncTTLCache())

    async def load(filters):
        await asyncio.sleep(0.01)
        return MFRDashboardResponse(filters=filters, summary=MFRSummary())

    loader = AsyncMock(side_effect=load)
    monkeypatch.setattr(mfr_service, "build_device_dashboard", loader)
    first = MFRFilters(dateFrom="2026-01-01", dateTo="2026-01-31")
    other = MFRFilters(dateFrom="2026-02-01", dateTo="2026-02-28")
    results = await asyncio.gather(*(mfr_service.build_mfr_dashboard(first) for _ in range(3)))
    await mfr_service.build_mfr_dashboard(other)
    assert [row.filters for row in results] == [first] * 3
    assert loader.await_count == 2
