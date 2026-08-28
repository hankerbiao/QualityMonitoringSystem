from app.api.lrr import aggregate_lrr, normalize_production_order, normalize_sales_order


def test_order_normalization_matches_bom_and_fault_values():
    assert normalize_production_order("30223310") == "000030223310"
    assert normalize_sales_order("0100001704--10") == "100001704"


def test_lrr_groups_pn_suffix_and_uses_signed_quantity():
    rows, _ = aggregate_lrr(
        [
            {"AUFNR_1": "30223310", "VBELN_EX": "0100001704", "MATNR": "MAT-ABC12345", "MAKTX": "Part", "MENGE_A": "10"},
            {"AUFNR_1": "000030223310", "VBELN_EX": "0100001704", "MATNR": "XYZ-ABC12345", "MAKTX": "Other", "MENGE_A": 3},
            {"AUFNR_1": "30223310", "VBELN_EX": "0100001704", "MATNR": "MAT-ABC12345", "MAKTX": "Part", "MENGE_A": -2},
            {"AUFNR_1": "30223310", "VBELN_EX": "0100001704", "MATNR": "ZERO0001", "MENGE_A": -4},
        ],
        [{"mfg_order": "30223310", "sale_no": "100001704", "fault_category": "E1"}],
    )

    by_pn = {row.materialNo: row for row in rows}
    assert set(by_pn) == {"ABC12345"}
    assert by_pn["ABC12345"].issuedQuantity == 11
    assert by_pn["ABC12345"].faultCount == 1
    assert by_pn["ABC12345"].lrrRate == 9.09


def test_sales_fallback_expands_fault_to_each_production_order_and_deduplicates_bom_rows():
    rows, details = aggregate_lrr(
        [
            {"AUFNR_1": "1", "VBELN_EX": "9", "MATNR": "00000001", "MENGE_A": 2},
            {"AUFNR_1": "2", "VBELN_EX": "9", "MATNR": "00000001", "MENGE_A": 3},
            {"AUFNR_1": "2", "VBELN_EX": "9", "MATNR": "00000002", "MENGE_A": 1},
        ],
        [
            {"_id": "fault-1", "mfg_order": "", "sale_no": "0009", "sn": "SN1"},
            {"_id": "fault-1", "mfg_order": "", "sale_no": "0009", "sn": "SN1"},
        ],
    )

    by_pn = {row.materialNo: row for row in rows}
    assert by_pn["00000001"].faultCount == 2
    assert by_pn["00000002"].faultCount == 1
    assert len(details) == 3
