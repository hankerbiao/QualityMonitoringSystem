"""Meilisearch-backed OA employee suggestions."""

from typing import Any

import httpx

from app.core.config import get_settings

_MAX_SUGGESTIONS = 10


def _normalize_employee(item: dict[str, Any]) -> dict[str, str] | None:
    email = str(item.get("email") or "").strip()
    if not email or "@" not in email:
        return None
    return {
        "itcode": str(item.get("itcode") or "").strip(),
        "realname": str(item.get("realname") or "").strip(),
        "internalName": str(item.get("internal_name") or item.get("internalName") or "").strip(),
        "email": email,
        "department": str(item.get("department") or "").strip(),
        "position": str(item.get("position") or "").strip(),
        "company": str(item.get("company") or "").strip(),
        "directBoss": str(item.get("directboss") or item.get("directBoss") or "").strip(),
    }


def _extract_hits(payload: Any) -> list[dict[str, Any]]:
    """取出命中列表，兼容两种响应形态。

    - Meilisearch 原生：``{"hits": [...]}``
    - 1oa 网关包装：``{"data": {"hits": [...]}, "meta": {...}, "error": null}``
    """
    if not isinstance(payload, dict):
        raise ValueError("Invalid OA employee search response")
    error = payload.get("error")
    if error:
        raise RuntimeError(f"OA employee search failed: {error}")
    body = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    hits = body.get("hits")
    if not isinstance(hits, list):
        raise ValueError("Invalid OA employee search response")
    return hits


async def search_employee_suggestions(keyword: str) -> list[dict[str, str]]:
    """Search the OA employee index without loading the full directory."""
    query = keyword.strip()
    if not query:
        return []

    settings = get_settings()
    if not settings.OA_EMPLOYEE_SEARCH_API_KEY.strip():
        raise RuntimeError("OA employee search is not configured")

    timeout = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)
    async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
        response = await client.post(
            settings.OA_EMPLOYEE_SEARCH_URL,
            json={
                "q": query,
                "limit": _MAX_SUGGESTIONS,
                "matchingStrategy": "last",
                "attributesToRetrieve": ["email", "realname", "department", "position", "itcode"],
                "attributesToHighlight": ["email", "realname"],
            },
            headers={"Authorization": f"Bearer {settings.OA_EMPLOYEE_SEARCH_API_KEY}"},
        )
        response.raise_for_status()
        payload = response.json()

    employees = []
    for item in _extract_hits(payload):
        if isinstance(item, dict):
            employee = _normalize_employee(item)
            if employee:
                employees.append(employee)
    return employees[:_MAX_SUGGESTIONS]
