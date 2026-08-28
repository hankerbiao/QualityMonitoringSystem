"""Resolve BOM GSTRS values from the sales-order dashboard documents."""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any


def _clean_identifier(value: Any) -> str:
    text = str(value or "").strip()
    if not text or (text.isdigit() and not text.lstrip("0")):
        return ""
    return text


def normalize_production_order(value: Any) -> str:
    """Return the canonical 12-digit production-order key."""
    text = _clean_identifier(value)
    return text.zfill(12) if text.isdigit() else text


def normalize_sales_order(value: Any) -> str:
    """Return the canonical sales-order key, without SAP leading zero variance."""
    text = re.sub(r"--\d+$", "", _clean_identifier(value))
    return text.lstrip("0") or "0" if text.isdigit() else text


def _gstrs_value(document: dict[str, Any]) -> Any | None:
    data = document.get("data")
    value = data.get("GSTRS") if isinstance(data, dict) else None
    return value if str(value or "").strip() else None


@dataclass(frozen=True)
class GstrsMatch:
    """A resolved GSTRS value and the identifier used to resolve it."""

    value: Any | None = None
    source: str | None = None
    ambiguous: bool = False


@dataclass
class OrderBomGstrsLookup:
    """Dashboard GSTRS lookup, preferring production order over sales order."""

    by_aufnr: dict[str, list[Any]] = field(default_factory=dict)
    by_vbeln: dict[str, list[Any]] = field(default_factory=dict)

    def add(self, document: dict[str, Any]) -> None:
        value = _gstrs_value(document)
        if value is None:
            return
        aufnr = normalize_production_order(document.get("aufnr"))
        data = document.get("data")
        vbeln = normalize_sales_order(data.get("VBELN")) if isinstance(data, dict) else ""
        if aufnr:
            self.by_aufnr.setdefault(aufnr, []).append(value)
        if vbeln:
            self.by_vbeln.setdefault(vbeln, []).append(value)

    @staticmethod
    def _unique_value(values: list[Any] | None) -> tuple[Any | None, bool]:
        if not values:
            return None, False
        unique: list[Any] = []
        for value in values:
            if value not in unique:
                unique.append(value)
        return (unique[0], False) if len(unique) == 1 else (None, True)

    def resolve(self, aufnr: Any, vbeln: Any) -> GstrsMatch:
        """Resolve GSTRS by AUFNR first, with VBELN as an unambiguous fallback."""
        production_value, production_ambiguous = self._unique_value(
            self.by_aufnr.get(normalize_production_order(aufnr))
        )
        if production_value is not None:
            return GstrsMatch(production_value, "AUFNR_1")

        sales_value, sales_ambiguous = self._unique_value(
            self.by_vbeln.get(normalize_sales_order(vbeln))
        )
        if sales_value is not None:
            return GstrsMatch(sales_value, "VBELN_EX")
        return GstrsMatch(ambiguous=production_ambiguous or sales_ambiguous)


def build_order_bom_gstrs_lookup(documents: Iterable[dict[str, Any]]) -> OrderBomGstrsLookup:
    """Build a lookup from ``sales_orders_sap`` dashboard documents."""
    lookup = OrderBomGstrsLookup()
    for document in documents:
        lookup.add(document)
    return lookup
