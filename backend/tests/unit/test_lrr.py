import pytest
from fastapi import HTTPException

from app.api import lrr as lrr_api
from app.api.lrr import (
    _has_filter_criteria,
    _require_bounded_bom_scope,
    _requires_full_fault_sort,
    _response,
    _usage_response,
    _validate_lrr_date_range,
    aggregate_lrr,
    normalize_production_order,
    normalize_sales_order,
)
from app.schemas.lrr import LRRData
from app.services.lrr_list_cache import LRRListQuery


def test_lrr_fault_details_include_station_repair_fields_and_order_model():
    bom = [{"MATNR": "PN1", "GSTRS": "20261001", "MENGE_A": 10,
            "AUFNR_1": "123", "VBELN_EX": "456", "_product_model": "M1"}]
    faults = [{"MATNR": "PN1", "GSTRS": "20261001", "AUFNR": "123", "VBELN": "456",
               "PCODE": "SN1", "ZNGWD3": "现象", "ZWXWD3": "措施", "ZNGGZ": "OP210",
               "U_FIX": "维修员", "ZWXDT": "20261029091214"}]
    rows, details = aggregate_lrr(bom, faults)
    assert rows[0].faultCount == 1
    detail = details[0]
    assert (detail.matchedModel, detail.sn, detail.salesOrder, detail.productionOrder) == ("M1", "SN1", "456", "123")
    assert (detail.faultPhenomenon, detail.repairAction, detail.station, detail.repairPerson, detail.repairTime) == (
        "现象", "措施", "OP210", "维修员", "20261029091214"
    )


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


def test_lrr_dashboard_uses_the_full_result_not_the_current_page():
    rows = [
        LRRData(id="A:2026-01", month="2026-01", materialNumber="PN-A", materialDescription="CPU", issuedQuantity=100, faultCount=10, lrrRate=10),
        LRRData(id="B:2026-01", month="2026-01", materialNumber="PN-B", materialDescription="MEM", issuedQuantity=50, faultCount=20, lrrRate=40),
        LRRData(id="A:2026-02", month="2026-02", materialNumber="PN-A", materialDescription="CPU", issuedQuantity=100, faultCount=5, lrrRate=5),
    ]

    response = _response(rows, LRRListQuery(page=1, limit=1))

    assert response.items[0].id == "A:2026-01"
    assert [(point.month, point.faultCount, point.issuedQuantity) for point in response.trend] == [
        ("2026-01", 30, 150),
        ("2026-02", 5, 100),
    ]
    assert [item.materialNumber for item in response.hotspots] == ["PN-B", "PN-A"]
    assert response.hotspots[0].faultCount == 20
    assert response.hotspots[1].faultCount == 15


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


@pytest.mark.asyncio
async def test_lrr_uses_planned_range_for_fault_lookup_without_ng_range(monkeypatch):
    captured: dict[str, object] = {}

    async def load_bom(**_kwargs):
        return [
            {
                "AUFNR_1": "000000000001",
                "VBELN_EX": "0000000001",
                "MATNR": "PN-1",
                "MAKTX": "CPU",
                "GSTRS": "2026-01-15",
                "MENGE_A": 1,
            }
        ]

    async def load_faults(**kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(lrr_api.lrr_gateway, "load_bom", load_bom)
    monkeypatch.setattr(lrr_api.lrr_gateway, "load_faults", load_faults)

    await lrr_api._load(
        LRRListQuery(
            planned_date_from="2026-01-01",
            planned_date_to="2026-10-13",
            product_model="6210 C21",
        )
    )

    assert captured["date_from"] == "2026-01-01"
    assert captured["date_to"] == "2026-10-13"
    assert captured["include_details"] is False


@pytest.mark.asyncio
async def test_lrr_fault_details_uses_planned_range_without_ng_range(monkeypatch):
    captured: dict[str, object] = {}

    async def load_bom(**_kwargs):
        return [{"AUFNR_1": "1", "VBELN_EX": "", "GSTRS": "2026-09-15"}]

    async def load_faults(**kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(lrr_api.lrr_gateway, "load_bom", load_bom)
    monkeypatch.setattr(lrr_api.lrr_gateway, "load_faults", load_faults)

    await lrr_api.get_lrr_fault_details(
        None,
        plannedDateFrom="2026-09-01",
        plannedDateTo="2026-09-30",
        materialNumber="B5000051",
        month="2026-09",
        limit=50000,
    )

    assert captured["date_from"] == "2026-09-01"
    assert captured["date_to"] == "2026-09-30"


def test_lrr_fault_sort_requires_full_fault_loading():
    assert not _requires_full_fault_sort(LRRListQuery(sort_by="month"))
    assert not _requires_full_fault_sort(LRRListQuery(sort_by="issuedQuantity"))
    assert _requires_full_fault_sort(LRRListQuery(sort_by="faultCount"))
    assert _requires_full_fault_sort(LRRListQuery(sort_by="lrrRate"))


def test_lrr_filtered_list_requires_fault_loading_even_with_month_sort():
    assert _has_filter_criteria(LRRListQuery(product_model="MODEL-1"))
    assert _has_filter_criteria(LRRListQuery(customer_ids=("C-1", "C-2")))
    assert _has_filter_criteria(LRRListQuery(planned_date_from="2026-01-01"))
    assert not _has_filter_criteria(LRRListQuery())


def test_lrr_rejects_unbounded_bom_scope():
    with pytest.raises(HTTPException) as error:
        _require_bounded_bom_scope(None, None, None)

    assert error.value.status_code == 422
    assert error.value.detail["code"] == "QUERY_TOO_LARGE"


def test_lrr_accepts_material_scope_without_date_range():
    _require_bounded_bom_scope("PN-1", None, None)


def test_lrr_accepts_a_full_year_date_range_when_scope_is_filtered():
    _validate_lrr_date_range(
        "2025-01-01",
        "2026-01-01",
        "计划日期",
        require_scope_filter=False,
    )


def test_lrr_rejects_more_than_two_calendar_months_without_scope_filter():
    with pytest.raises(HTTPException) as error:
        _validate_lrr_date_range(
            "2026-01-01",
            "2026-03-01",
            "计划日期",
            require_scope_filter=True,
        )

    assert error.value.status_code == 422
    assert error.value.detail["code"] == "QUERY_TOO_LARGE"
    assert "增加" in error.value.detail["message"]


def test_lrr_accepts_two_calendar_months_without_scope_filter():
    _validate_lrr_date_range(
        "2026-01-01",
        "2026-02-28",
        "计划日期",
        require_scope_filter=True,
    )


def test_lrr_rejects_reversed_date_range():
    with pytest.raises(HTTPException) as error:
        _validate_lrr_date_range("2026-02-01", "2026-01-31", "计划日期")

    assert error.value.status_code == 422
    assert error.value.detail["code"] == "INVALID_QUERY"


def test_lrr_rejects_date_range_over_one_year():
    with pytest.raises(HTTPException) as error:
        _validate_lrr_date_range("2025-01-01", "2026-01-02", "计划日期")

    assert error.value.status_code == 422
    assert error.value.detail["code"] == "QUERY_TOO_LARGE"


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
                "GSTRS": "20260125",
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
    assert details[0].ngTime == ""


def test_lrr_denominator_uses_261_minus_262_and_ignores_other_movement_types():
    rows, _ = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260105",
                "BWART": "261",
                "MENGE_A": 10,
            },
            {
                "AUFNR_1": "1",
                "MATNR": "PN-1",
                "MAKTX": "CPU A",
                "GSTRS": "20260105",
                "BWART": "262",
                "MENGE_A": 3,
            },
            *[
                {
                    "AUFNR_1": "1",
                    "MATNR": "PN-1",
                    "MAKTX": "CPU A",
                    "GSTRS": "20260105",
                    "BWART": movement_type,
                    "MENGE_A": 100,
                }
                for movement_type in ("601", "602", "Z35", "Z37", "101")
            ],
        ],
        [],
    )

    assert len(rows) == 1
    assert rows[0].issuedQuantity == 7


def test_lrr_matches_repair_material_to_zero_padded_bom_material():
    rows, details = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": "000000000057000766",
                "MAKTX": "C30-D324 机箱",
                "GSTRS": "20260905",
                "MENGE_A": 473,
            }
        ],
        [
            {
                "_id": "repair-6102114804622475",
                "AUFNR": "1",
                "RECORD01REPAIRM": "57000766",
                "PCODE": "6102114804622475",
                "GSTRS": "20260912",
                "ZDATE_WX": "20260912",
                "ZWXWD": "故障维修",
            }
        ],
    )

    assert rows[0].materialNumber == "000000000057000766"
    assert rows[0].faultCount == 1
    assert rows[0].lrrRate == 0.21
    assert details[0].materialNumber == "000000000057000766"
    assert details[0].sn == "6102114804622475"


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
                "GSTRS": "20260805",
                "ZDATE_WX": "20260805",
            }
        ],
    )

    assert rows[0].faultCount == 0
    assert details == []


def test_lrr_counts_fault_by_planned_production_month_not_actual_repair_month():
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
                "GSTRS": "20260729",
                "ZDATE_WX": "20260802",
                "PCODE": "SN-1",
            }
        ],
    )

    assert rows[0].month == "2026-07"
    assert rows[0].faultCount == 1
    assert details[0].ngTime == ""


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
                "GSTRS": "20260125",
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
                "GSTRS": "20260202",
                "ZDATE_WX": "20260202",
                "ZTIME": "113419",
            }
        ],
    )

    assert details[0].faultType == ""
    assert details[0].faultDesc == "Power-on failure"
    assert details[0].ngTime == ""


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
                "GSTRS": "20260502",
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
                "GSTRS": "20260202",
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
                "GSTRS": "20260202",
                "ZDATE_WX": "20260202",
                "PCODE": "SN-1",
            }
        ],
    )

    assert rows[0].faultCount == 1
    assert details[0].materialNumber == "PN-1"


@pytest.mark.parametrize("include_details", [False, True])
@pytest.mark.parametrize(
    ("primary", "secondary", "expected_counts"),
    [
        ("B5000051", "57000766", [1, 1]),
        ("UNLISTED-PN", "57000766", [0, 1]),
        ("000000000057000766", "57000766", [0, 1]),
        ("B5000051", "UNLISTED-PN", [1, 0]),
    ],
)
def test_lrr_counts_each_populated_repair_material_once_per_pn(
    primary, secondary, expected_counts, include_details
):
    rows, details = aggregate_lrr(
        [
            {
                "AUFNR_1": "1",
                "MATNR": material,
                "GSTRS": "20260905",
                "MENGE_A": 100,
            }
            for material in ("B5000051", "000000000057000766")
        ],
        [
            {
                "_id": "repair-1",
                "AUFNR": "1",
                "MATNR": primary,
                "RECORD01REPAIRM": secondary,
                "GSTRS": "20260912",
                "PCODE": "SN-1",
            }
        ],
        include_details=include_details,
    )

    assert [row.faultCount for row in rows] == expected_counts
    assert len(details) == (sum(expected_counts) if include_details else 0)
    assert len({item.materialNumber for item in details}) == len(details)


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
        [{"_id": "f1", "AUFNR": "1", "ZJXMC": "CPU A", "GSTRS": "20260202", "ZDATE_WX": "20260202"}],
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
        [{"_id": "f1", "AUFNR": "1", "MATNR": "PN-2", "GSTRS": "20260202", "ZDATE_WX": "20260202"}],
    )

    by_material = {row.materialNumber: row for row in rows}
    assert by_material["PN-1"].faultCount == 0
    assert by_material["PN-2"].faultCount == 1
    assert details[0].materialNumber == "PN-2"


def test_lrr_counts_every_matching_fault_record_including_mirrored_records():
    rows, details = aggregate_lrr(
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
            {"_id": "f1", "AUFNR": "1", "ZJXMC": "CPU A", "PCODE": "SN-1", "GSTRS": "20260202", "ZDATE_WX": "20260202"},
            {"_id": "f1", "AUFNR": "1", "ZJXMC": "CPU A", "PCODE": "SN-1", "GSTRS": "20260202", "ZDATE_WX": "20260202"},
            {"_id": "f2", "AUFNR": "1", "ZJXMC": "CPU A", "PCODE": "SN-1", "GSTRS": "20260203", "ZDATE_WX": "20260203"},
        ],
    )

    assert rows[0].faultCount == 3
    assert len(details) == 3


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
                "GSTRS": "20260125",
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
