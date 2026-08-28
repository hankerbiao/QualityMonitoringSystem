"""Tests for HANA sync safeguards."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parents[3] / "scripts" / "sync_views.py"
SPEC = importlib.util.spec_from_file_location("sync_views", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_normalize_production_order_matches_sales_order_key() -> None:
    assert MODULE.normalize_production_order("12345") == "000000012345"
    assert MODULE.normalize_production_order(12345) == "000000012345"
    assert MODULE.normalize_production_order("000000000000") == ""


def test_load_sales_order_vbelns_normalizes_dashboard_keys() -> None:
    class Collection:
        def find(self, query, projection):
            assert query == {}
            assert projection == {"data.VBELN": 1}
            return [
                {"data": {"VBELN": "0040003952"}},
                {"data": {"VBELN": "40003952"}},
                {"data": {"VBELN": ""}},
            ]

    database = {MODULE.SALES_ORDERS_COLLECTION: Collection()}

    assert MODULE.load_sales_order_vbelns(database) == {"40003952"}


def test_bom_filter_keeps_missing_aufnr_and_requires_known_vbeln() -> None:
    sales_orders = {"40003952"}

    assert MODULE.should_sync_bom_row({"AUFNR_1": "", "VBELN_EX": "unknown"}, sales_orders)
    assert MODULE.should_sync_bom_row(
        {"AUFNR_1": "000010346952", "VBELN_EX": "0040003952"}, sales_orders
    )
    assert not MODULE.should_sync_bom_row(
        {"AUFNR_1": "000010346952", "VBELN_EX": "9999999999"}, sales_orders
    )


def test_sync_stats_reports_filtered_records() -> None:
    stats = MODULE.SyncStats("view", "collection", "incremental", "run", filtered=3)

    assert stats.as_dict()["filtered"] == 3
