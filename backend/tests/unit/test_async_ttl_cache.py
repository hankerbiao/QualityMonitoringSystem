import asyncio
from types import SimpleNamespace

import pytest

from app.services import async_ttl_cache
from app.services.async_ttl_cache import AsyncTTLCache


@pytest.mark.asyncio
async def test_cache_expiry_does_not_extend_on_access_and_results_are_isolated(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(async_ttl_cache, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    cache = AsyncTTLCache(max_entries=2)
    generation = 0

    async def load():
        nonlocal generation
        generation += 1
        return {"generation": generation}

    first = await cache.get_or_set("export", load, ttl_seconds=60)
    first["generation"] = -1
    clock[0] = 150
    assert await cache.get_or_set("export", load, ttl_seconds=60) == {"generation": 1}
    clock[0] = 160
    assert await cache.get_or_set("export", load, ttl_seconds=60) == {"generation": 2}


@pytest.mark.asyncio
async def test_cache_reclaims_old_entries_when_capacity_is_reached():
    cache = AsyncTTLCache(max_entries=2)
    generation = 0

    async def load():
        nonlocal generation
        generation += 1
        return generation

    assert await cache.get_or_set("a", load, ttl_seconds=60) == 1
    assert await cache.get_or_set("b", load, ttl_seconds=60) == 2
    assert await cache.get_or_set("c", load, ttl_seconds=60) == 3
    assert await cache.get_or_set("b", load, ttl_seconds=60) == 2
    assert await cache.get_or_set("a", load, ttl_seconds=60) == 4


@pytest.mark.asyncio
async def test_concurrent_cache_misses_share_a_load_and_failures_are_not_cached():
    cache = AsyncTTLCache(max_entries=2)
    generation = 0

    async def load():
        nonlocal generation
        generation += 1
        await asyncio.sleep(0)
        if generation == 1:
            raise RuntimeError("source unavailable")
        return generation

    with pytest.raises(RuntimeError):
        await cache.get_or_set("export", load, ttl_seconds=60)
    results = await asyncio.gather(
        *[cache.get_or_set("export", load, ttl_seconds=60) for _ in range(4)]
    )
    assert results == [2, 2, 2, 2]
