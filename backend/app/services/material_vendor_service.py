"""HANA-backed material vendor lookup."""

from typing import Any

import httpx

from app.core.config import get_settings


def _extract_vendor(payload: Any) -> str | None:
    if not isinstance(payload, dict) or not isinstance(payload.get("vendors"), list):
        raise ValueError("Invalid HANA material vendor response")

    vendors = list(
        dict.fromkeys(
            value.strip()
            for value in payload["vendors"]
            if isinstance(value, str) and value.strip()
        )
    )
    return "、".join(vendors) or None


async def lookup_vendor(material_number: str) -> str | None:
    """Query vendors for a material number through the HANA API."""
    settings = get_settings()
    timeout = httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0)
    async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
        response = await client.get(
            settings.MATERIAL_VENDOR_API_URL,
            params={"materialNumber": material_number.strip()},
        )
        response.raise_for_status()
        payload = response.json()

    return _extract_vendor(payload)
