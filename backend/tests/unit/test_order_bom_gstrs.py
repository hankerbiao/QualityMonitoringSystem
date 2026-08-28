"""Tests for deriving BOM GSTRS values from sales-order dashboard data."""

from app.services.order_bom_gstrs import build_order_bom_gstrs_lookup


def test_resolve_prefers_production_order_over_sales_order() -> None:
    lookup = build_order_bom_gstrs_lookup(
        [
            {"aufnr": "123", "data": {"VBELN": "500", "GSTRS": "2026-01-03"}},
            {"aufnr": "456", "data": {"VBELN": "500", "GSTRS": "2026-02-04"}},
        ]
    )

    match = lookup.resolve("000000000123", "500")

    assert match.value == "2026-01-03"
    assert match.source == "AUFNR_1"


def test_resolve_falls_back_to_sales_order_with_sap_zero_variance() -> None:
    lookup = build_order_bom_gstrs_lookup(
        [{"aufnr": "123", "data": {"VBELN": "0000000500", "GSTRS": "2026-01-03"}}]
    )

    match = lookup.resolve(None, "500")

    assert match.value == "2026-01-03"
    assert match.source == "VBELN_EX"


def test_resolve_skips_ambiguous_sales_order_match() -> None:
    lookup = build_order_bom_gstrs_lookup(
        [
            {"aufnr": "123", "data": {"VBELN": "500", "GSTRS": "2026-01-03"}},
            {"aufnr": "456", "data": {"VBELN": "500", "GSTRS": "2026-02-04"}},
        ]
    )

    match = lookup.resolve(None, "500")

    assert match.value is None
    assert match.ambiguous is True
