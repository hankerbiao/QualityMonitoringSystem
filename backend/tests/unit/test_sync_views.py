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


def test_station_pass_normalizers_use_actual_date_and_repair_station_fallback() -> None:
    assert MODULE.station_pass_fields(
        {
            "ACTUAL_START_TIME": "2026-04-02 08:30:00",
            "GSTRS": "20260101",
            "SPEC": "M-OP205:装配",
            "SPEC_DESC": " 装配 ",
        }
    ) == {
        "station_pass_date": "20260402",
        "station_code_norm": "OP205",
        "station_name_norm": "装配",
    }
    assert (
        MODULE.station_pass_fields({"ACTUAL_START_TIME": "2026-99-99", "GSTRS": "20260403"})[
            "station_pass_date"
        ]
        == "20260403"
    )
    assert MODULE.repair_station_pass_fields({"ZNGGZ": "", "ZNGSPEC": "M-OP205：备用"}) == {
        "repair_station_code_norm": "OP205"
    }
    assert MODULE.repair_station_pass_fields(
        {"ZNGGZ": "M-OP205:主工位", "ZNGSPEC": "M-OP210:备用"}
    ) == {"repair_station_code_norm": "OP205"}


def test_sync_row_normalization_selects_fields_for_station_and_repair_views() -> None:
    assert MODULE.normalized_sap_fields(
        MODULE.VIEW_SPECS["Z_V_ZMES_T_001"],
        {"ACTUAL_START_TIME": "2026-05-01", "SPEC": "M-OP100", "SPEC_DESC": "测试"},
    ) == {
        "station_pass_date": "20260501",
        "station_code_norm": "OP100",
        "station_name_norm": "测试",
    }
    assert MODULE.normalized_sap_fields(
        MODULE.VIEW_SPECS["ZSGV_ZZT_WLJL"],
        {"ZNGGZ": "M-OP100:测试"},
    ) == {"repair_station_code_norm": "OP100"}


def test_future_watermark_is_ignored_for_recovery_scan() -> None:
    spec = MODULE.ViewSpec(
        view_id="bom",
        qualified_name="schema.view",
        columns=("BUDAT_MKPF",),
        collection="bom",
        key_fields=("BUDAT_MKPF",),
        order_by=("BUDAT_MKPF",),
        watermark_fields=("BUDAT_MKPF",),
        start_date_field="BUDAT_MKPF",
    )

    sql, params = MODULE.build_query(
        spec,
        mode="incremental",
        checkpoint={"watermark": "21000108"},
        start_date=None,
    )

    assert " WHERE " not in sql
    assert params == []
