"""Small in-process TTL cache with concurrent-load coalescing."""

from __future__ import annotations

import asyncio
import copy
import time
from collections.abc import Awaitable, Callable, Hashable
from typing import Any


class AsyncTTLCache:
    """Cache stable dashboard calculations without caching failed loads."""

    def __init__(self, *, max_entries: int | None = None, copy_values: bool = True) -> None:
        self.max_entries = max_entries
        # Disable copying only when every cached value is immutable.
        self.copy_values = copy_values
        self._values: dict[Hashable, tuple[float, Any]] = {}
        self._inflight: dict[Hashable, asyncio.Task[Any]] = {}
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    async def get_or_set(
        self,
        key: Hashable,
        loader: Callable[[], Awaitable[Any]],
        *,
        ttl_seconds: float,
    ) -> Any:
        """Return a cached value, sharing one loader task for concurrent misses."""
        loop = asyncio.get_running_loop()
        if self._loop is not loop:
            self._loop = loop
            self._values.clear()
            self._inflight.clear()
            self._lock = asyncio.Lock()

        if ttl_seconds <= 0:
            return await loader()

        now = time.monotonic()
        async with self._lock:
            cached = self._values.get(key)
            if cached and cached[0] > now:
                return copy.deepcopy(cached[1]) if self.copy_values else cached[1]
            if cached:
                self._values.pop(key, None)
            task = self._inflight.get(key)
            if task is None:
                task = asyncio.create_task(loader())
                self._inflight[key] = task

        try:
            value = await task
        finally:
            async with self._lock:
                if self._inflight.get(key) is task:
                    self._inflight.pop(key, None)

        async with self._lock:
            now = time.monotonic()
            for expired in [key for key, (expires, _) in self._values.items() if expires <= now]:
                self._values.pop(expired, None)
            self._values[key] = (time.monotonic() + ttl_seconds, value)
            if self.max_entries is not None:
                while len(self._values) > self.max_entries:
                    self._values.pop(next(iter(self._values)))
        return copy.deepcopy(value) if self.copy_values else value
