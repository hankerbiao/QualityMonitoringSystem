from app.api.lrr import (
    _bom_query,
    _repair_query,
    aggregate_lrr,
    normalize_production_order,
    normalize_sales_order,
)


def test_order_normalization_matches_bom_and_fault_values():
    assert normalize_production_order("30223310") == "000030223310"
    assert normalize_sales_order("0100001704--10") == "100001704"


def test_sales_order_filter_matches_bom_values_with_leading_zeroes():
    assert _bom_query(None, "40003952", None) == {"VBELN_EX": {"$regex": r"^0*40003952(?:--\d+)?$"}}


def test_repair_query_matches_sales_order_line_items():
    query = _repair_query([], ["0100001971"])

    assert query["$or"][0]["$or"][1] == {"VBELN": {"$regex": r"^0*(?:100001971)(?:--\d+)?$"}}


def test_production_order_lrr_uses_all_bom_materials_and_order_faults():
    rows, _ = aggregate_lrr(
        [
            {"AUFNR_1": "1", "VBELN_EX": "9", "MATNR": "00000001", "MENGE_A": 10},
            {"AUFNR_1": "1", "VBELN_EX": "9", "MATNR": "00000002", "MENGE_A": 3},
            {"AUFNR_1": "1", "VBELN_EX": "9", "MATNR": "00000001", "MENGE_A": -2},
            {"AUFNR_1": "2", "VBELN_EX": "9", "MATNR": "00000003", "MENGE_A": 5},
        ],
        [
            {"_id": "fault-by-production", "mfg_order": "1", "sale_no": "", "sn": "SN1"},
            {"_id": "fault-by-sales", "mfg_order": "", "sale_no": "0009", "sn": "SN2"},
        ],
    )

    by_order = {row.orderNo: row for row in rows}
    assert by_order["000000000001"].productionOrder == "000000000001"
    assert by_order["000000000001"].salesOrder == "9"
    assert by_order["000000000001"].issuedQuantity == 11
    assert by_order["000000000001"].faultCount == 2
    assert by_order["000000000001"].lrrRate == 18.18


def test_sales_order_lrr_groups_all_related_production_orders_and_deduplicates_faults():
    rows, details = aggregate_lrr(
        [
            {"AUFNR_1": "1", "VBELN_EX": "9", "MATNR": "00000001", "MENGE_A": 2},
            {"AUFNR_1": "2", "VBELN_EX": "9", "MATNR": "00000002", "MENGE_A": 3},
            {"AUFNR_1": "3", "VBELN_EX": "8", "MATNR": "00000003", "MENGE_A": 4},
        ],
        [
            {"_id": "fault-1", "mfg_order": "1", "sale_no": "0009", "sn": "SN1"},
            {"_id": "fault-1", "mfg_order": "1", "sale_no": "0009", "sn": "SN1"},
            {"_id": "fault-2", "mfg_order": "2", "sale_no": "", "sn": "SN2"},
            {"_id": "fault-3", "mfg_order": "", "sale_no": "0009", "sn": "SN3"},
        ],
        group_by="salesOrder",
    )

    by_order = {row.orderNo: row for row in rows}
    assert by_order["9"].productionOrder == "000000000001,000000000002"
    assert by_order["9"].issuedQuantity == 5
    assert by_order["9"].faultCount == 3
    assert by_order["9"].lrrRate == 60
    assert {detail.orderNo for detail in details} == {"9"}
    assert len(details) == 3


def test_list_aggregation_skips_export_only_fault_details():
    rows, details = aggregate_lrr(
        [{"AUFNR_1": "1", "VBELN_EX": "9", "MATNR": "00000001", "MENGE_A": 2}],
        [{"_id": "fault-1", "mfg_order": "1", "sale_no": "9", "sn": "SN1"}],
        include_details=False,
    )

    assert rows[0].faultCount == 1
    assert details == []


def test_list_aggregation_accepts_compacted_repair_counts():
    rows, _ = aggregate_lrr(
        [{"AUFNR_1": "1", "VBELN_EX": "9", "MENGE_A": 10}],
        [{"_id": "repairs:1:9", "mfg_order": "1", "sale_no": "9", "_fault_count": 3}],
        include_details=False,
    )

    assert rows[0].faultCount == 3
    assert rows[0].lrrRate == 30
