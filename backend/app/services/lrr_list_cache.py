"""Persistent, single-flight caching for expensive LRR list calculations."""

from __future__ import annotations

import asyncio
import hashlib
import json
from asyncio import sleep
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from pymongo.errors import DuplicateKeyError

from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.lrr import LRRListResponse

CACHE_TTL = timedelta(minutes=15)
LEASE_TTL = timedelta(minutes=5)
LEASE_POLL_SECONDS = 0.1


def _utc_now() -> datetime:
    """Return a naive UTC value compatible with the application's Mongo client."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


@dataclass(frozen=True)
class LRRListQuery:
    # Bump when the aggregation semantics change so Mongo never serves a
    # response calculated by an incompatible version of the code.
    cache_version: str = "gstrs-month-v21-material-number-zero-padding-match"
    page: int = 1
    limit: int = 50
    planned_date_from: str | None = None
    planned_date_to: str | None = None
    ng_date_from: str | None = None
    ng_date_to: str | None = None
    material_number: str | None = None
    product_model: str | None = None
    base: str | None = None
    customer_id: str | None = None
    sort_by: str = "month"
    sort_dir: str = "asc"

    @property
    def fingerprint(self) -> str:
        payload = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


LRRListLoader = Callable[[], Awaitable[LRRListResponse]]


class LRRListCache:
    def __init__(
        self,
        *,
        database: Callable[[], Any] = get_database,
        now: Callable[[], datetime] = _utc_now,
        ttl: timedelta = CACHE_TTL,
        lease_ttl: timedelta = LEASE_TTL,
    ) -> None:
        self._database = database
        self._now = now
        self._ttl = ttl
        self._lease_ttl = lease_ttl
        self._in_flight: dict[str, asyncio.Task[LRRListResponse]] = {}
        self._lock = asyncio.Lock()

    async def get_or_load(
        self,
        query: LRRListQuery,
        loader: LRRListLoader,
        *,
        refresh: bool = False,
    ) -> tuple[LRRListResponse, str]:
        key = query.fingerprint
        if not refresh:
            cached = await self._get_cached(key)
            if cached is not None:
                return cached, "hit"

        async with self._lock:
            task = self._in_flight.get(key)
            state = "coalesced" if task is not None else "miss"
            if task is None:
                task = asyncio.create_task(self._load_and_store(key, loader))
                self._in_flight[key] = task

        return await asyncio.shield(task), state

    async def _get_cached(self, key: str) -> LRRListResponse | None:
        document = await self._database()[Collections.LRR_LIST_CACHE].find_one({"_id": key})
        expires_at = document.get("expiresAt") if document else None
        if not isinstance(expires_at, datetime) or expires_at <= self._now():
            return None
        payload = document.get("payload")
        return LRRListResponse.model_validate(payload) if isinstance(payload, dict) else None

    async def _load_and_store(self, key: str, loader: LRRListLoader) -> LRRListResponse:
        try:
            owner = uuid4().hex
            while True:
                cached = await self._get_cached(key)
                if cached is not None:
                    return cached
                if await self._acquire_lease(key, owner):
                    renewal_task = asyncio.create_task(self._renew_lease(key, owner))
                    try:
                        # Another instance may have stored a fresh response between
                        # the read above and this lease acquisition.
                        cached = await self._get_cached(key)
                        if cached is not None:
                            return cached
                        response = await loader()
                        generated_at = self._now()
                        await self._database()[Collections.LRR_LIST_CACHE].update_one(
                            {"_id": key},
                            {
                                "$set": {
                                    "payload": response.model_dump(mode="json"),
                                    "generatedAt": generated_at,
                                    "expiresAt": generated_at + self._ttl,
                                }
                            },
                            upsert=True,
                        )
                        return response
                    finally:
                        renewal_task.cancel()
                        with suppress(asyncio.CancelledError):
                            await renewal_task
                        await self._database()[Collections.LRR_LIST_CACHE_LOCKS].delete_one(
                            {"_id": key, "owner": owner}
                        )
                await sleep(LEASE_POLL_SECONDS)
        finally:
            async with self._lock:
                self._in_flight.pop(key, None)

    async def _acquire_lease(self, key: str, owner: str) -> bool:
        now = self._now()
        try:
            result = await self._database()[Collections.LRR_LIST_CACHE_LOCKS].update_one(
                {"_id": key, "$or": [{"expiresAt": {"$lte": now}}, {"owner": owner}]},
                {"$set": {"owner": owner, "expiresAt": now + self._lease_ttl}},
                upsert=True,
            )
        except DuplicateKeyError:
            return False
        return bool(result.matched_count or result.upserted_id is not None)

    async def _renew_lease(self, key: str, owner: str) -> None:
        interval = max(self._lease_ttl.total_seconds() / 3, 0.01)
        while True:
            await sleep(interval)
            now = self._now()
            result = await self._database()[Collections.LRR_LIST_CACHE_LOCKS].update_one(
                {"_id": key, "owner": owner, "expiresAt": {"$gt": now}},
                {"$set": {"expiresAt": now + self._lease_ttl}},
            )
            if not result.matched_count:
                return


lrr_list_cache = LRRListCache()
