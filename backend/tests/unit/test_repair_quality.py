from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.base_access import base_access_scope
from app.services import repair_quality
from app.services.data_gateway_client import DataGatewayError
from app.services.repair_quality import aggregate_repairs


def test_aggregate_repairs_counts_lifecycle_rows_and_groups_by_repair_order():
    orders = {
        "1": {"KID": "CUSTOMER-A", "LGORT": "1000"},
        "2": {"KID": "CUSTOMER-B", "LGORT": "2000"},
    }
    faults = [
        {"_id": "a", "PCODE": "SN-1", "AUFNR": "1"},
        {"_id": "a", "PCODE": "SN-1", "AUFNR": "1"},
        {"_id": "b", "PCODE": "SN-1", "AUFNR": "2"},
        {"_id": "c", "PCODE": "SN-2", "AUFNR": "1"},
    ]

    result = aggregate_repairs(faults, orders)

    assert result["snCount"] == 2
    assert result["firstPassCount"] == 1
    assert result["repeatCount"] == 1
    assert result["firstPassRate"] == 50
    assert result["distribution"][0] == {"repairCount": "1", "snCount": 1, "percentage": 50}
    assert result["distribution"][1] == {"repairCount": "2", "snCount": 1, "percentage": 50}
    assert [(row["customer"], row["base"]) for row in result["groups"]] == [
        ("CUSTOMER-A", "1000"),
        ("CUSTOMER-B", "2000"),
    ]
    assert [row["snCount"] for row in result["groups"]] == [2, 1]


def test_aggregate_repairs_puts_ninth_and_later_records_in_long_tail_bucket():
    faults = [{"_id": f"r{index}", "PCODE": "SN-1", "AUFNR": "1"} for index in range(10)]

    result = aggregate_repairs(faults, {"1": {"KID": "C", "LGORT": "B"}})

    assert result["distribution"][-1] == {
        "repairCount": "9+",
        "snCount": 1,
        "percentage": 100,
    }


def test_aggregate_repairs_ignores_rows_without_serial_number():
    result = aggregate_repairs([{"_id": "missing-sn", "AUFNR": "1"}], {})

    assert result["snCount"] == 0
    assert result["firstPassRate"] == 0
    assert result["groups"] == []


@pytest.mark.asyncio
async def test_details_match_group_counts_and_keep_cross_group_lifecycle(monkeypatch):
    orders = {
        "1": {"KID": "A", "LGORT": "1000", "MAKTX_TH": "M1"},
        "2": {"KID": "B", "LGORT": "2000", "MAKTX_TH": "M2"},
    }
    faults = [
        {"_id": "a", "PCODE": "SN-1", "AUFNR": "1"},
        {"_id": "a", "PCODE": "SN-1", "AUFNR": "1"},
        {"_id": "b", "PCODE": "SN-1", "AUFNR": "2", "ZWXWD": "故障"},
        {"_id": "c", "PCODE": "SN-2", "AUFNR": "1"},
        *[{"_id": f"long-{i}", "PCODE": "SN-3", "AUFNR": "1"} for i in range(10)],
    ]
    loader = AsyncMock(return_value=([], faults, orders))
    monkeypatch.setattr(repair_quality, "_load_sources", loader)
    summary = aggregate_repairs(faults, orders)

    all_rows = await repair_quality.details(
        "2026-01-01", "2026-01-31", "A", "1000", "all", page_size=1
    )
    second = await repair_quality.details(
        "2026-01-01", "2026-01-31", "A", "1000", "all", page=2, page_size=1
    )
    repeats = await repair_quality.details("2026-01-01", "2026-01-31", "B", "2000", "2")
    long_tail = await repair_quality.details("2026-01-01", "2026-01-31", "A", "1000", "9+")
    export = await repair_quality.details(
        "2026-01-01", "2026-01-31", "A", "1000", "all", page_size=1, export_all=True
    )

    assert all_rows["total"] == summary["groups"][0]["snCount"] == 3
    assert all_rows["items"][0]["sn"] == "SN-1"
    assert second["items"][0]["sn"] == "SN-2"
    assert repeats["total"] == summary["groups"][1]["distribution"][1]["snCount"] == 1
    assert repeats["items"][0]["repairCount"] == 2
    assert repeats["items"][0]["models"] == ["M1", "M2"]
    assert repeats["items"][0]["repairs"][1]["description"] == "故障"
    assert long_tail["items"][0]["repairCount"] == 10
    assert len(export["items"]) == export["total"] == 3


@pytest.mark.asyncio
async def test_analyze_filters_by_actual_start_date_and_dimensions(monkeypatch):
    orders = [
        {"id": "in-range", "aufnr": "1"},
        {"id": "out-of-range", "aufnr": "2"},
    ]
    full_orders = [
        {"_id": "in-range", "data": {"AUFNR": "1", "ZDATE_STARTED": "20261010", "MAKTX_TH": "M1", "KID": "C1", "LGORT": "1000"}},
        {"_id": "out-of-range", "data": {"AUFNR": "2", "ZDATE_STARTED": "20261101", "MAKTX_TH": "M1", "KID": "C1", "LGORT": "1000"}},
    ]
    monkeypatch.setattr(repair_quality.data_gateway, "all_orders", AsyncMock(return_value=orders))
    monkeypatch.setattr(repair_quality.data_gateway, "export_rows", AsyncMock(return_value=full_orders))
    selected_faults = AsyncMock(return_value=[{"_id": "f1", "PCODE": "SN-1"}])
    lifecycle_faults = AsyncMock(return_value=[{"_id": "f1", "PCODE": "SN-1", "AUFNR": "1"}])
    monkeypatch.setattr(repair_quality.rty_gateway, "_faults_for_orders", selected_faults)
    monkeypatch.setattr(repair_quality.rty_gateway, "_faults_for_sns", lifecycle_faults)

    result = await repair_quality.analyze(
        "2026-10-01", "2026-10-31", product_models=["M1"], customers=["C1"], bases=["1000"]
    )

    selected_faults.assert_awaited_once_with({"1"})
    lifecycle_faults.assert_awaited_once_with({"SN-1"})
    assert result["snCount"] == 1


def mock_export_sources(monkeypatch):
    orders = [
        {"id": "selected", "aufnr": "1"},
        {"id": "historical", "aufnr": "2"},
        {"id": "other-base", "aufnr": "3"},
    ]
    full_orders = [
        {"_id": "selected", "data": {"AUFNR": "000000001", "VBELN": "0000123", "ZDATE_STARTED": "20261010", "GSTRS": "20250101", "MAKTX_TH": "M1", "KID": "C1", "LGORT": "1000", "POSNR": "000010"}},
        {"_id": "historical", "data": {"AUFNR": "2", "ZDATE_STARTED": "20250101", "MAKTX_TH": "M2", "KID": "C2", "LGORT": "1000"}},
        {"_id": "other-base", "data": {"AUFNR": "3", "ZDATE_STARTED": "20261010", "MAKTX_TH": "M1", "KID": "C1", "LGORT": "3000"}},
    ]
    faults = [
        {"_id": "first", "PCODE": "000001", "AUFNR": "1", "T_FIND": "20261010", "U_FIX": "甲", "ZUSER": "不替代", "ZWXDT": None},
        {"_id": "first", "PCODE": "000001", "AUFNR": "1", "T_FIND": "20261010"},
        {"_id": "second", "PCODE": "000001", "AUFNR": "2", "T_FIND": "20250101", "ERROR_MSG": "=literal"},
        {"_id": "third", "PCODE": "000001", "AUFNR": "3", "T_FIND": "20270101"},
        {"_id": "unrelated", "PCODE": "OTHER", "AUFNR": "1"},
    ]
    monkeypatch.setattr(repair_quality.data_gateway, "all_orders", AsyncMock(return_value=orders))
    monkeypatch.setattr(repair_quality.data_gateway, "export_rows", AsyncMock(return_value=full_orders))
    monkeypatch.setattr(repair_quality.rty_gateway, "_faults_for_orders", AsyncMock(return_value=faults[:1]))
    monkeypatch.setattr(repair_quality.rty_gateway, "_faults_for_sns", AsyncMock(return_value=faults))
    raw_faults = [
        {**row, "ZNGWD3": f"完整不良现象-{row['_id']}", "ZNGWD2": "完整维度2"}
        for row in faults
    ]
    monkeypatch.setattr(
        repair_quality.data_gateway,
        "fault_rows_by_host_barcodes",
        AsyncMock(return_value=raw_faults),
    )
    packaging = AsyncMock(return_value={"1": 0, "2": 0, "3": 0})
    monkeypatch.setattr(repair_quality.rty_export, "_packaging_counts_for_orders", packaging)
    return packaging


@pytest.mark.asyncio
async def test_export_shares_actual_date_filters_and_complete_deduplicated_lifecycle(monkeypatch):
    packaging = mock_export_sources(monkeypatch)
    result = await repair_quality.build_export(
        "2026-10-01", "2026-10-31", product_models=["M1"], customers=["C1"], bases=["1000"]
    )
    repair_quality.rty_gateway._faults_for_orders.assert_awaited_once_with({"1"})
    repair_quality.data_gateway.fault_rows_by_host_barcodes.assert_awaited_once_with(
        ["000001"], max_rows=250_000
    )
    repair_quality.rty_gateway._faults_for_sns.assert_not_awaited()
    packaging.assert_awaited_once_with(["1"])
    assert result["orders"][0]["AUFNR"] == "000000001"
    assert result["orders"][0]["VBELN"] == "0000123"
    assert result["orders"][0]["POSNR"] == "000010"
    assert result["orders"][0]["packagingQuantity"] == 0
    assert result["orders"][0]["GSTRS"] == "20250101"
    assert len(result["orders"]) == 1
    assert len(result["faults"]) == 3
    assert [row["T_FIND"] for row in result["faults"]] == ["20261010", "20250101", "20270101"]
    assert [row["ZNGWD3"] for row in result["faults"]] == [
        "完整不良现象-first", "完整不良现象-second", "完整不良现象-third"
    ]
    assert all(row["ZNGWD2"] == "完整维度2" for row in result["faults"])
    assert result["faults"][0]["U_FIX"] == "甲"
    assert result["faults"][0]["ZWXDT"] is None
    assert result["faults"][1]["ERROR_MSG"] == "=literal"
    assert result["summary"]["distribution"][2]["snCount"] == 1
    assert all(set(row) == set(repair_quality.rty_export.FAULT_FIELDS) for row in result["faults"])


@pytest.mark.asyncio
async def test_analysis_keeps_projection_path_while_export_reads_full_raw_fault_fields(monkeypatch):
    mock_export_sources(monkeypatch)
    await repair_quality.analyze("2026-10-01", "2026-10-31")
    repair_quality.rty_gateway._faults_for_sns.assert_awaited_once_with({"000001"})
    repair_quality.data_gateway.fault_rows_by_host_barcodes.assert_not_awaited()


@pytest.mark.asyncio
async def test_export_does_not_leak_unauthorized_lifecycle_rows(monkeypatch):
    mock_export_sources(monkeypatch)
    with base_access_scope(["1000"]):
        result = await repair_quality.build_export("2026-10-01", "2026-10-31")
        summary = await repair_quality.analyze("2026-10-01", "2026-10-31")
    assert [row["AUFNR"] for row in result["faults"]] == ["1", "2"]
    assert result["summary"] == summary
    assert result["summary"]["distribution"][1]["snCount"] == 1


@pytest.mark.asyncio
async def test_details_respect_base_permissions(monkeypatch):
    mock_export_sources(monkeypatch)
    with base_access_scope(["1000"]):
        result = await repair_quality.details("2026-10-01", "2026-10-31", "C1", "1000", "2")
        forbidden = await repair_quality.details("2026-10-01", "2026-10-31", "C1", "3000", "all")
    assert result["total"] == 1
    assert [row["productionOrder"] for row in result["items"][0]["repairs"]] == ["1", "2"]
    assert forbidden["total"] == 0


@pytest.mark.asyncio
async def test_export_empty_scope_does_not_query_sources(monkeypatch):
    mock_export_sources(monkeypatch)
    with base_access_scope([]):
        result = await repair_quality.build_export("2026-10-01", "2026-10-31")
    repair_quality.data_gateway.all_orders.assert_not_awaited()
    assert result["orders"] == result["faults"] == []
    assert result["summary"]["snCount"] == 0


@pytest.mark.asyncio
async def test_export_rejects_missing_full_orders_instead_of_partial_data(monkeypatch):
    mock_export_sources(monkeypatch)
    repair_quality.data_gateway.export_rows.return_value = []
    with pytest.raises(DataGatewayError, match="完整订单数据缺失"):
        await repair_quality.build_export("2026-10-01", "2026-10-31")


@pytest.mark.asyncio
async def test_export_propagates_lifecycle_failure(monkeypatch):
    mock_export_sources(monkeypatch)
    repair_quality.data_gateway.fault_rows_by_host_barcodes.side_effect = DataGatewayError("维修读取失败")
    with pytest.raises(DataGatewayError, match="维修读取失败"):
        await repair_quality.build_export("2026-10-01", "2026-10-31")


@pytest.mark.asyncio
async def test_export_rejects_reversed_date_range():
    with pytest.raises(HTTPException) as error:
        await repair_quality.build_export("2026-11-01", "2026-10-01")
    assert error.value.status_code == 422
