from app.api.lrr import aggregate_lrr, normalize_production_order, normalize_sales_order


def test_order_normalization_is_retained_for_internal_fault_linking():
    assert normalize_production_order("30223310") == "000030223310"
    assert normalize_sales_order("0100001704--10") == "100001704"


def test_lrr_groups_usage_by_material_and_month_and_matches_fault_description():
    rows, details = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260105",
                "BUDAT_MKPF": "20260115",
                "MENGE_A": 10,
            },
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260105",
                "BUDAT_MKPF": "20260120",
                "MENGE_A": 2,
            },
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260205",
                "BUDAT_MKPF": "20260201",
                "MENGE_A": 5,
            },
            {
                "AUFNR_1": "1",
                "MATNR": "PN-2",
                "MAKTX": "MEM B",
                "GSTRS": "20260105",
                "BUDAT_MKPF": "20260115",
                "MENGE_A": 3,
            },
        ],
        [
            {
                "_id": "f1",
                "mfg_order": "1",
                "ZJXMC": "CPU A",
                "PCODE": "SN-1",
                "ZDATE_WX": "20260125",
            },
            {"_id": "f2", "mfg_order": "1", "ZJXMC": "UNKNOWN", "PCODE": "SN-2"},
        ],
    )
    by_key = {(row.materialNumber, row.month): row for row in rows}
    assert by_key[("PN-1", "2026-01")].issuedQuantity == 12
    assert by_key[("PN-1", "2026-01")].faultCount == 1
    assert by_key[("PN-1", "2026-01")].lrrRate == 8.33
    assert by_key[("PN-1", "2026-01")].materialDescription == "CPU A"
    assert by_key[("PN-1", "2026-02")].faultCount == 0
    assert by_key[("PN-2", "2026-01")].faultCount == 0
    assert len(details) == 1
    assert details[0].materialNumber == "PN-1"
    assert details[0].ngTime == "20260125"


def test_lrr_does_not_match_known_production_order_through_shared_sales_order():
    rows, details = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "VBELN_EX": "0009",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260805",
                "MENGE_A": 10,
            }
        ],
        [
            {
                "_id": "fault-from-another-order",
                "AUFNR": "2",
                "VBELN": "9",
                "MATNR": "PN-1",
                "ZDATE_WX": "20260805",
            }
        ],
    )

    assert rows[0].faultCount == 0
    assert details == []


def test_lrr_matches_fault_to_planned_order_when_repair_is_in_a_later_month():
    rows, details = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260729",
                "MENGE_A": 10,
            }
        ],
        [
            {
                "_id": "fault-repaired-in-august",
                "AUFNR": "1",
                "MATNR": "PN-1",
                "ZDATE_WX": "20260802",
                "PCODE": "SN-1",
            }
        ],
    )

    assert rows[0].month == "2026-07"
    assert rows[0].faultCount == 1
    assert details[0].month == "2026-07"


def test_lrr_supports_compacted_fault_counts():
    rows, details = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260105",
                "BUDAT_MKPF": "20260101",
                "MENGE_A": 10,
            }
        ],
        [
            {
                "_id": "f1",
                "mfg_order": "1",
                "ZJXMC": "CPU A",
                "ZDATE_WX": "20260125",
                "_fault_count": 3,
            }
        ],
        include_details=False,
    )
    assert rows[0].faultCount == 3
    assert rows[0].lrrRate == 30
    assert details == []


def test_lrr_detail_uses_station_and_time_when_fault_code_is_absent():
    _, details = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260205",
                "BUDAT_MKPF": "20260201",
                "MENGE_A": 1,
            }
        ],
        [
            {
                "_id": "f1",
                "AUFNR": "1",
                "ZJXMC": "CPU A",
                "PCODE": "SN-1",
                "ZNGGZ": "OP205",
                "ZWXWD": "Power-on failure",
                "ZDATE_WX": "20260202",
                "ZTIME": "113419",
            }
        ],
    )

    assert details[0].faultType == "OP205"
    assert details[0].faultDesc == "Power-on failure"
    assert details[0].ngTime == "20260202 113419"


def test_lrr_does_not_assign_repairs_when_bom_material_description_is_missing():
    rows, details = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "",
                "GSTRS": "20260505",
                "BUDAT_MKPF": "20260501",
                "MENGE_A": 1,
            }
        ],
        [
            {
                "_id": "f1",
                "AUFNR": "1",
                "ZJXMC": "A source-provided component name",
                "PCODE": "SN-1",
                "ZDATE_WX": "20260502",
            }
        ],
    )

    assert rows[0].faultCount == 0
    assert details == []


def test_lrr_prefers_exact_fault_material_number_when_description_is_missing():
    rows, details = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "",
                "GSTRS": "20260205",
                "BUDAT_MKPF": "20260201",
                "MENGE_A": 1,
            },
            {
                "AUFNR_1": "1",
                "MATNR": "PN-2",
                "MAKTX": "",
                "GSTRS": "20260205",
                "BUDAT_MKPF": "20260201",
                "MENGE_A": 1,
            },
        ],
        [
            {
                "_id": "f1",
                "AUFNR": "1",
                "MATNR": "PN-1",
                "ZDATE_WX": "20260202",
                "PCODE": "SN-1",
            }
        ],
    )

    assert rows[0].faultCount == 1
    assert rows[1].faultCount == 0
    assert details[0].materialNumber == "PN-1"


def test_lrr_skips_ambiguous_description_matches_instead_of_counting_every_pn():
    rows, details = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260205",
                "BUDAT_MKPF": "20260201",
                "MENGE_A": 1,
            },
            {
                "AUFNR_1": "1",
                "MATNR": "PN-2",
                "MAKTX": "CPU A",
                "GSTRS": "20260205",
                "BUDAT_MKPF": "20260201",
                "MENGE_A": 1,
            },
        ],
        [{"_id": "f1", "AUFNR": "1", "ZJXMC": "CPU A", "ZDATE_WX": "20260202"}],
    )

    assert [row.faultCount for row in rows] == [0, 0]
    assert details == []


def test_lrr_counts_a_precisely_identified_pn_even_when_descriptions_are_shared():
    rows, details = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260205",
                "BUDAT_MKPF": "20260201",
                "MENGE_A": 1,
            },
            {
                "AUFNR_1": "1",
                "MATNR": "PN-2",
                "MAKTX": "CPU A",
                "GSTRS": "20260205",
                "BUDAT_MKPF": "20260201",
                "MENGE_A": 1,
            },
        ],
        [{"_id": "f1", "AUFNR": "1", "MATNR": "PN-2", "ZDATE_WX": "20260202"}],
    )

    by_material = {row.materialNumber: row for row in rows}
    assert by_material["PN-1"].faultCount == 0
    assert by_material["PN-2"].faultCount == 1
    assert details[0].materialNumber == "PN-2"


def test_lrr_deduplicates_mirrored_records_but_keeps_separate_repairs_for_one_sn():
    rows, _ = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260205",
                "BUDAT_MKPF": "20260201",
                "MENGE_A": 10,
            }
        ],
        [
            {"_id": "f1", "AUFNR": "1", "ZJXMC": "CPU A", "PCODE": "SN-1", "ZDATE_WX": "20260202"},
            {"_id": "f1", "AUFNR": "1", "ZJXMC": "CPU A", "PCODE": "SN-1", "ZDATE_WX": "20260202"},
            {"_id": "f2", "AUFNR": "1", "ZJXMC": "CPU A", "PCODE": "SN-1", "ZDATE_WX": "20260203"},
        ],
    )

    assert rows[0].faultCount == 2


def test_lrr_uses_gstrs_month_for_denominator_not_bom_posting_month():
    rows, _ = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260105",
                "BUDAT_MKPF": "20260110",
                "MENGE_A": 10,
            },
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260105",
                "BUDAT_MKPF": "20260210",
                "MENGE_A": 5,
            },
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260205",
                "BUDAT_MKPF": "20260120",
                "MENGE_A": 20,
            },
        ],
        [
            {
                "_id": "f1",
                "AUFNR": "1",
                "MATNR": "PN-1",
                "ZDATE_WX": "20260125",
            }
        ],
    )

    by_month = {row.month: row for row in rows}
    assert by_month["2026-01"].issuedQuantity == 15
    assert by_month["2026-01"].faultCount == 1
    assert by_month["2026-01"].lrrRate == 6.67
    assert by_month["2026-02"].issuedQuantity == 20
    assert by_month["2026-02"].faultCount == 0


def test_lrr_skips_bom_rows_without_gstrs_instead_of_falling_back_to_posting_month():
    rows, _ = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "BUDAT_MKPF": "20260110",
                "MENGE_A": 10,
            }
        ],
        [],
    )

    assert rows == []
