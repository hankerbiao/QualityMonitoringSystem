"""Cached entry point for the MFR DOA-device dashboard."""

from app.schemas.mfr import MFRDashboardResponse, MFRFilters
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.mfr_device_dashboard import build_device_dashboard

MFR_CACHE_TTL_SECONDS = 60.0
_MFR_DASHBOARD_CACHE = AsyncTTLCache()


async def build_mfr_dashboard(filters: MFRFilters) -> MFRDashboardResponse:
    return await _MFR_DASHBOARD_CACHE.get_or_set(
        filters.model_dump_json(),
        lambda: build_device_dashboard(filters),
        ttl_seconds=MFR_CACHE_TTL_SECONDS,
    )
