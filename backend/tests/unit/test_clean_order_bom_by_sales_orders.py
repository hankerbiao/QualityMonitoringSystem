"""Tests for the BOM/sales-order cleanup script's identifier normalization."""

from __future__ import annotations

import importlib.util
from pathlib import Path

SCRIPT_PATH = (
    Path(__file__).resolve().parents[3]
    / "scripts"
    / "maintenance"
    / "clean_order_bom_by_sales_orders.py"
)
SPEC = importlib.util.spec_from_file_location("clean_order_bom_by_sales_orders", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_normalize_aufnr_handles_sap_numeric_formats() -> None:
    assert MODULE.normalize_aufnr("12345") == "000000012345"
    assert MODULE.normalize_aufnr(12345) == "000000012345"
    assert MODULE.normalize_aufnr("000000012345") == "000000012345"


def test_normalize_aufnr_rejects_empty_and_all_zero_values() -> None:
    assert MODULE.normalize_aufnr(None) == ""
    assert MODULE.normalize_aufnr("  ") == ""
    assert MODULE.normalize_aufnr("000000000000") == ""


def test_normalize_aufnr_keeps_non_numeric_identifiers() -> None:
    assert MODULE.normalize_aufnr("A-100") == "A-100"


def test_normalize_vbeln_removes_leading_zeros() -> None:
    assert MODULE.normalize_vbeln("0040003952") == "40003952"
    assert MODULE.normalize_vbeln("0000000000") == ""
