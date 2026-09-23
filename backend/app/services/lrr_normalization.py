"""Normalization rules shared by the LRR gateway and aggregation layers."""

from __future__ import annotations

import calendar
import re
from typing import Any


def source_data(item: dict[str, Any]) -> dict[str, Any]:
    """Return the SAP payload from either a raw row or a wrapped gateway row."""
    raw = item.get("raw")
    if not isinstance(raw, dict):
        return item
    data = raw.get("data")
    return data if isinstance(data, dict) else raw


def normalize_production_order(value: Any) -> str:
    text = str(value or "").strip()
    return text.zfill(12) if text.isdigit() else text


def normalize_sales_order(value: Any) -> str:
    text = str(value or "").strip().rsplit("--", 1)[0]
    return text.lstrip("0") or "0" if text.isdigit() else text


def normalize_material_number(value: Any) -> str:
    text = str(value or "").strip()
    return text.lstrip("0") or "0" if text.isdigit() else text


def month_from_date(value: Any) -> str:
    compact = re.sub(r"\D", "", str(value or ""))
    if len(compact) < 6:
        return ""
    month = int(compact[4:6])
    return f"{compact[:4]}-{month:02d}" if 1 <= month <= 12 else ""


def compact_date(value: Any) -> str:
    compact = re.sub(r"\D", "", str(value or ""))
    return compact[:8] if len(compact) >= 8 else ""


def month_bounds(month: str | None) -> tuple[str, str]:
    value = str(month or "").replace("-", "")
    if len(value) != 6 or not value.isdigit():
        return "", ""
    year, month_number = int(value[:4]), int(value[4:])
    if not 1 <= month_number <= 12:
        return "", ""
    return (
        f"{year:04d}-{month_number:02d}-01",
        f"{year:04d}-{month_number:02d}-{calendar.monthrange(year, month_number)[1]:02d}",
    )
