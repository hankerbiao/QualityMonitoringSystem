from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

import pytest

from app.api import lrr as lrr_api
from app.schemas.lrr import LRRListResponse
from app.services.lrr_list_cache import LRRListCache, LRRListQuery


def _response(total: int = 1) -> LRRListResponse:
    return LRRListResponse(total=total, limit=50)


@pytest.mark.asyncio
async def test_lrr_list_cache_reuses_response_until_expiration(db_clean):
    now = datetime(2026, 9, 3, 12, 0, 0)
    clock = [now]
    cache = LRRListCache(database=lambda: db_clean, now=lambda: clock[0])
    calls = 0

    async def loader() -> LRRListResponse:
        nonlocal calls
        calls += 1
        return _response(calls)

    first, first_state = await cache.get_or_load(LRRListQuery(), loader)
    second, second_state = await cache.get_or_load(LRRListQuery(), loader)

    assert first.total == second.total == 1
    assert (first_state, second_state) == ("miss", "hit")
    assert calls == 1

    clock[0] += timedelta(minutes=16)
    expired, expired_state = await cache.get_or_load(LRRListQuery(), loader)

    assert expired.total == 2
    assert expired_state == "miss"
    assert calls == 2


@pytest.mark.asyncio
async def test_lrr_list_cache_does_not_store_failed_loader(db_clean):
    cache = LRRListCache(database=lambda: db_clean)
    query = LRRListQuery(page=2)

    async def loader() -> LRRListResponse:
        raise RuntimeError("gateway unavailable")

    with pytest.raises(RuntimeError, match="gateway unavailable"):
        await cache.get_or_load(query, loader)

    document = await db_clean.lrr_list_cache.find_one({"_id": query.fingerprint})
    assert document is None


@pytest.mark.asyncio
async def test_lrr_list_cache_coalesces_concurrent_misses(db_clean):
    cache = LRRListCache(database=lambda: db_clean)
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def loader() -> LRRListResponse:
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return _response()

    first_task = asyncio.create_task(cache.get_or_load(LRRListQuery(), loader))
    await started.wait()
    second_task = asyncio.create_task(cache.get_or_load(LRRListQuery(), loader))
    await asyncio.sleep(0)
    release.set()
    first, second = await asyncio.gather(first_task, second_task)

    assert calls == 1
    assert {first[1], second[1]} == {"miss", "coalesced"}
    assert first[0] == second[0]


@pytest.mark.asyncio
async def test_lrr_list_cache_coalesces_misses_across_cache_instances(db_clean):
    first_cache = LRRListCache(database=lambda: db_clean)
    second_cache = LRRListCache(database=lambda: db_clean)
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def loader() -> LRRListResponse:
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return _response()

    first_task = asyncio.create_task(first_cache.get_or_load(LRRListQuery(), loader))
    await started.wait()
    second_task = asyncio.create_task(second_cache.get_or_load(LRRListQuery(), loader))
    await asyncio.sleep(0)
    release.set()
    first, second = await asyncio.gather(first_task, second_task)

    assert calls == 1
    assert first[0] == second[0]


@pytest.mark.asyncio
async def test_lrr_list_cache_renews_lease_for_slow_cross_instance_loader(db_clean):
    lease_ttl = timedelta(milliseconds=30)
    first_cache = LRRListCache(database=lambda: db_clean, lease_ttl=lease_ttl)
    second_cache = LRRListCache(database=lambda: db_clean, lease_ttl=lease_ttl)
    started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def loader() -> LRRListResponse:
        nonlocal calls
        calls += 1
        started.set()
        await release.wait()
        return _response()

    first_task = asyncio.create_task(first_cache.get_or_load(LRRListQuery(), loader))
    await started.wait()
    await asyncio.sleep(lease_ttl.total_seconds() * 2)
    second_task = asyncio.create_task(second_cache.get_or_load(LRRListQuery(), loader))
    await asyncio.sleep(0)
    release.set()
    first, second = await asyncio.gather(first_task, second_task)

    assert calls == 1
    assert first[0] == second[0]


@pytest.mark.asyncio
async def test_lrr_default_prewarm_uses_canonical_query(monkeypatch):
    captured: dict[str, object] = {}

    class Cache:
        async def get_or_load(self, query, loader, *, refresh=False):
            captured["query"] = query
            captured["refresh"] = refresh
            return _response(), "miss"

    monkeypatch.setattr(lrr_api, "lrr_list_cache", Cache())

    await lrr_api.warm_default_lrr_list_cache()

    assert captured["query"] == LRRListQuery(
        page=1,
        limit=50,
        sort_by="lrrRate",
        sort_dir="desc",
    )
    assert captured["refresh"] is True
