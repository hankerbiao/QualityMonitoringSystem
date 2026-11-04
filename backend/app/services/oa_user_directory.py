"""Cached search over the OA employee directory."""

import asyncio
import time
from typing import Any

import httpx

from app.core.config import get_settings

_PAGE_SIZE = 200
_MAX_PAGES = 500
_MAX_RESULTS = 20
_cache: list[dict[str, str]] | None = None
_cache_expires_at = 0.0
_cache_lock = asyncio.Lock()


def _normalize_employee(item: dict[str, Any]) -> dict[str, str] | None:
    email = str(item.get("email") or "").strip()
    if not email or "@" not in email:
        return None
    return {
        "itcode": str(item.get("itcode") or "").strip(),
        "realname": str(item.get("realname") or "").strip(),
        "internalName": str(item.get("internal_name") or "").strip(),
        "email": email,
        "department": str(item.get("department_full_name") or item.get("department_short_name") or "").strip(),
        "position": str(item.get("position") or "").strip(),
        "company": str(item.get("company") or "").strip(),
        "directBoss": str(item.get("directboss") or "").strip(),
    }


async def _load_employees() -> list[dict[str, str]]:
    global _cache, _cache_expires_at
    settings = get_settings()
    if not settings.OA_USER_API_KEY.strip():
        raise RuntimeError("OA employee directory is not configured")

    employees: list[dict[str, str]] = []
    timeout = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)
    # The OA directory is reachable directly in this environment, while the
    # configured desktop HTTPS proxy cannot complete its TLS handshake.
    async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
        for page in range(1, _MAX_PAGES + 1):
            response = await client.get(
                settings.OA_USER_API_URL,
                params={"page": page, "page_size": _PAGE_SIZE},
                headers={"X-API-Key": settings.OA_USER_API_KEY},
            )
            response.raise_for_status()
            payload = response.json()
            items = payload.get("items") if isinstance(payload, dict) else None
            if not isinstance(items, list):
                raise ValueError("Invalid OA employee directory response")
            if (
                payload.get("page") != page
                or payload.get("page_size") != _PAGE_SIZE
                or not isinstance(payload.get("has_more"), bool)
            ):
                raise ValueError("Incomplete OA employee directory pagination metadata")
            if payload["has_more"] and not items:
                raise ValueError("OA employee directory returned an empty page with more results")
            for item in items:
                if isinstance(item, dict):
                    normalized = _normalize_employee(item)
                    if normalized:
                        employees.append(normalized)
            if payload["has_more"] is False:
                break
        else:
            raise ValueError("OA employee directory exceeded the pagination limit")

    _cache = employees
    _cache_expires_at = time.monotonic() + max(0, settings.OA_USER_CACHE_TTL_SECONDS)
    return employees


async def search_employees(keyword: str) -> list[dict[str, str]]:
    """Find employees by name, ITCode, department, internal name, or email."""
    global _cache
    query = keyword.strip().casefold()
    if len(query) < 2:
        return []
    async with _cache_lock:
        if _cache is None or time.monotonic() >= _cache_expires_at:
            await _load_employees()
        employees = _cache or []

    matches = []
    for employee in employees:
        searchable = " ".join(employee.values()).casefold()
        if query in searchable:
            matches.append(employee)
            if len(matches) >= _MAX_RESULTS:
                break
    return matches


async def list_employees() -> list[dict[str, str]]:
    """Load the cached employee directory for client-side autocomplete."""
    global _cache
    async with _cache_lock:
        if _cache is None or time.monotonic() >= _cache_expires_at:
            await _load_employees()
        return list(_cache or [])


def clear_employee_cache() -> None:
    """Clear cached employees; exposed for deterministic tests and operations."""
    global _cache, _cache_expires_at
    _cache = None
    _cache_expires_at = 0.0
