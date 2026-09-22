from app.api.lrr import (
    _has_filter_criteria,
    _requires_full_fault_sort,
    _response,
    _usage_response,
    aggregate_lrr,
    normalize_production_order,
    normalize_sales_order,
)
from app.schemas.lrr import LRRData
from app.services.lrr_list_cache import LRRListQuery


def test_lrr_default_list_order_is_ascending_by_month():
    rows = [
        LRRData(
            id=f"PN-1:{month}",
            month=month,
            materialNumber="PN-1",
            materialDescription="CPU A",
            issuedQuantity=100,
            faultCount=faults,
            lrrRate=faults,
        )
        for month, faults in (("2026-09", 9), ("2026-01", 8), ("2026-03", 4))
    ]

    response = _response(rows, LRRListQuery())

    assert [row.month for row in response.items] == ["2026-01", "2026-03", "2026-09"]


def test_lrr_ng_date_filter_limits_rows_to_overlapping_months():
    rows = [
        LRRData(id=month, month=month, issuedQuantity=10, faultCount=1, lrrRate=10)
        for month in ("2026-07", "2026-08", "2026-09")
    ]

    response = _response(
        rows,
        LRRListQuery(ng_date_from="2026-08-15", ng_date_to="2026-08-20"),
    )

    assert [row.month for row in response.items] == ["2026-08"]
    assert response.total == 1
    assert response.summary.totalFaults == 1


def test_lrr_usage_response_does_not_load_faults():
    usage_rows = [
        LRRData(
            id="PN-1:2026-01",
            month="2026-01",
            materialNumber="PN-1",
            issuedQuantity=10,
        ),
        LRRData(
            id="PN-2:2026-01",
            month="2026-01",
            materialNumber="PN-2",
            issuedQuantity=20,
        ),
    ]
    response = _usage_response(usage_rows, LRRListQuery(page=2, limit=1))

    assert response.total == 2
    assert response.items[0].id == "PN-2:2026-01"
    assert response.items[0].faultCount is None
    assert response.items[0].lrrRate is None
    assert response.summary.scope == "usage"
    assert response.summary.materialCount == 1
    assert response.summary.totalFaults is None


def test_lrr_fault_sort_requires_full_fault_loading():
    assert not _requires_full_fault_sort(LRRListQuery(sort_by="month"))
    assert not _requires_full_fault_sort(LRRListQuery(sort_by="issuedQuantity"))
    assert _requires_full_fault_sort(LRRListQuery(sort_by="faultCount"))
    assert _requires_full_fault_sort(LRRListQuery(sort_by="lrrRate"))


def test_lrr_filtered_list_requires_fault_loading_even_with_month_sort():
    assert _has_filter_criteria(LRRListQuery(product_model="MODEL-1"))
    assert _has_filter_criteria(LRRListQuery(planned_date_from="2026-01-01"))
    assert not _has_filter_criteria(LRRListQuery())


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
                "AUFNR": "1",
                "ZJXMC": "CPU A",
                "PCODE": "SN-1",
                "ZDATE_WX": "20260125",
            },
            {"_id": "f2", "AUFNR": "1", "ZJXMC": "UNKNOWN", "PCODE": "SN-2"},
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


def test_lrr_does_not_count_fault_when_repair_month_differs_from_planned_month():
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
    assert rows[0].faultCount == 0
    assert details == []


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
                "AUFNR": "1",
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


def test_lrr_detail_does_not_treat_station_as_fault_code():
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

    assert details[0].faultType == ""
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


def test_lrr_uses_record01repairm_when_fault_matnr_is_missing():
    rows, details = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "",
                "GSTRS": "20260205",
                "MENGE_A": 1,
            }
        ],
        [
            {
                "_id": "f1",
                "AUFNR": "1",
                "RECORD01REPAIRM": "PN-1",
                "ZDATE_WX": "20260202",
                "PCODE": "SN-1",
            }
        ],
    )

    assert rows[0].faultCount == 1
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
