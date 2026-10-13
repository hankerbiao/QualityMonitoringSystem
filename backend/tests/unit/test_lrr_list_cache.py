from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

import pytest
from starlette.requests import Request

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
async def test_lrr_list_cache_cancels_loader_only_after_last_waiter_leaves(db_clean):
    cache = LRRListCache(database=lambda: db_clean)
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def loader() -> LRRListResponse:
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    first = asyncio.create_task(cache.get_or_load(LRRListQuery(), loader))
    await started.wait()
    second = asyncio.create_task(cache.get_or_load(LRRListQuery(), loader))
    while cache._waiters.get(LRRListQuery().fingerprint) != 2:
        await asyncio.sleep(0)

    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    assert not cancelled.is_set()

    second.cancel()
    with pytest.raises(asyncio.CancelledError):
        await second
    assert cancelled.is_set()


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
        limit=0,
        sort_by="month",
        sort_dir="asc",
    )
    assert captured["refresh"] is True


@pytest.mark.asyncio
async def test_lrr_list_pages_reuse_one_canonical_load(monkeypatch):
    calls = 0

    class Cache:
        def __init__(self):
            self.payload = None

        async def get_or_load(self, query, loader, *, refresh=False):
            nonlocal calls
            if self.payload is None or refresh:
                calls += 1
                self.payload = await loader()
            return self.payload, "miss"

    async def load(_query):
        return LRRListResponse(
            items=[
                {"id": "1", "month": "2026-01"},
                {"id": "2", "month": "2026-02"},
                {"id": "3", "month": "2026-03"},
            ],
            total=3,
            page=1,
            limit=0,
        )

    monkeypatch.setattr(lrr_api, "lrr_list_cache", Cache())
    monkeypatch.setattr(lrr_api, "_load", load)

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    request = Request(
        {"type": "http", "headers": [], "client": ("test", 1)},
        receive=receive,
    )
    first = await lrr_api.get_lrr_list(request=request, page=1, limit=2)
    second = await lrr_api.get_lrr_list(request=request, page=2, limit=2)

    assert [item.id for item in first.items] == ["1", "2"]
    assert [item.id for item in second.items] == ["3"]
    assert calls == 1


@pytest.mark.asyncio
async def test_lrr_request_disconnect_cancels_its_cache_waiter(monkeypatch):
    cancelled = asyncio.Event()

    class Cache:
        async def get_or_load(self, _query, _loader):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

    async def receive():
        return {"type": "http.disconnect"}

    monkeypatch.setattr(lrr_api, "lrr_list_cache", Cache())
    request = Request(
        {"type": "http", "headers": [], "client": ("test", 1)},
        receive=receive,
    )

    response, state = await lrr_api._load_lrr_list_for_request(request, LRRListQuery())

    assert (response, state) == (None, None)
    assert cancelled.is_set()
