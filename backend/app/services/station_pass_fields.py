"""Normalized fields shared by SAP synchronization and station RTY reporting."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any


def normalize_station_code(value: Any) -> str:
    """Return the station code before a colon and after the final hyphen."""
    text = str(value or "").strip()
    if not text:
        return ""
    text = text.split(":", 1)[0].split("：", 1)[0].strip()
    return text.rsplit("-", 1)[-1].strip() if text else ""


def normalize_station_pass_date(*values: Any) -> str:
    """Return the first parseable YYYYMMDD prefix from station date values."""
    for value in values:
        digits = "".join(char for char in str(value or "") if char.isdigit())
        if len(digits) >= 8:
            candidate = digits[:8]
            try:
                datetime.strptime(candidate, "%Y%m%d")
            except ValueError:
                continue
            return candidate
    return ""


def station_pass_fields(row: Mapping[str, Any]) -> dict[str, str]:
    """Build normalized fields for one station-record SAP document."""
    return {
        "station_pass_date": normalize_station_pass_date(
            row.get("ACTUAL_START_TIME"), row.get("GSTRS")
        ),
        "station_code_norm": normalize_station_code(row.get("SPEC")),
        "station_name_norm": str(row.get("SPEC_DESC") or "").strip(),
    }


def repair_station_pass_fields(row: Mapping[str, Any]) -> dict[str, str]:
    """Build normalized fields for one repair-record SAP document."""
    return {
        "repair_station_code_norm": normalize_station_code(row.get("ZNGGZ") or row.get("ZNGSPEC"))
    }
