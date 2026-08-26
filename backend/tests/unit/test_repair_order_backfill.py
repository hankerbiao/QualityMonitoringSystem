"""Unit tests for the repair-order backfill decision rules."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parents[3] / "scripts" / "maintenance" / "backfill_repair_orders.py"
SPEC = importlib.util.spec_from_file_location("backfill_repair_orders", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_normalize_production_order_pads_numeric_sap_identifiers():
    assert MODULE.normalize_production_order("30223310") == "000030223310"
    assert MODULE.normalize_production_order("000030223310") == "000030223310"
    assert MODULE.normalize_production_order("0") == ""


def test_normalize_sales_order_unifies_numeric_padding_only():
    assert MODULE.normalize_sales_order("0100001704") == "100001704"
    assert MODULE.normalize_sales_order("XNC2607860--10") == "XNC2607860"


def test_resolve_candidate_prefers_the_first_unambiguous_source():
    result = MODULE.resolve_candidate(
        [
            ("station_record", {"40003908"}),
            ("sales_orders_sap", {"100001392"}),
        ]
    )

    assert result.value == "40003908"
    assert result.source == "station_record"
    assert result.conflicting_values == ("100001392",)


def test_resolve_candidate_skips_ambiguous_source_before_using_fallback():
    result = MODULE.resolve_candidate(
        [
            ("station_record", {"40003908", "40003909"}),
            ("sales_orders_sap", {"100001392"}),
        ]
    )

    assert result.value == "100001392"
    assert result.source == "sales_orders_sap"
    assert result.conflicting_values == ("40003908", "40003909")


def test_customer_backfill_normalizes_numeric_order_padding():
    customer_script = SCRIPT_PATH.with_name("backfill_repair_customers.py")
    spec = importlib.util.spec_from_file_location("backfill_repair_customers", customer_script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    assert module.normalize_production_order("000030220742") == "30220742"
    assert module.normalize_production_order("30220742") == "30220742"
    assert module.normalize_production_order("") == ""
