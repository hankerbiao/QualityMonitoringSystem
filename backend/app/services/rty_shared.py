"""Small, storage-independent RTY rules shared by gateway adapters."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException

YEAR_START = "2026-01-01"
YEAR_END = "2026-12-31"
REPAIR_YEAR_START = "20260101"
REPAIR_YEAR_END = "20261231"
MAX_DETAIL_ROW_COUNT = 50_000
MAX_BINDING_ROW_COUNT = 100_000
COMPOSITE_MODEL_ITEMS: dict[str, frozenset[str]] = {
    "6210 C21 BOX": frozenset({"6410 X21"}),
    "6215 C32": frozenset({"6615 X32"}),
}
EXCLUDED_ORDER_STATUSES = ("DLID", "RELEASED")
EXCLUDED_ORDER_TYPES = ("C001",)


def normalize_order(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text.lstrip("0") or "0" if text.isdigit() else text


def order_variants(values: list[str]) -> list[str]:
    variants: set[str] = set()
    for value in values:
        normalized = normalize_order(value)
        if not normalized:
            continue
        variants.update((value.strip(), normalized))
        if normalized.isdigit():
            variants.add(normalized.zfill(12))
    return sorted(variants)


def validate_date(value: str) -> str:
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="日期格式必须为 YYYY-MM-DD") from exc
