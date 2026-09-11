"""Normalized fields shared by SAP synchronization and station RTY reporting."""

from __future__ import annotations

from typing import Any


def normalize_station_code(value: Any) -> str:
    """Return the station code before a colon and after the final hyphen."""
    text = str(value or "").strip()
    if not text:
        return ""
    text = text.split(":", 1)[0].split("：", 1)[0].strip()
    return text.rsplit("-", 1)[-1].strip() if text else ""
