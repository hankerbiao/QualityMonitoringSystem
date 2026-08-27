import pytest
from fastapi import HTTPException

from app.api import rty
from tests.mock_motor import MockMotorClient


def test_production_date_range_is_inclusive_and_clamped_to_2026():
    assert rty._sales_date_match("2025-12-01", "2027-01-01") == {
        "$gte": "2026-01-01",
        "$lte": "2026-12-31",
    }
    assert rty._sales_date_match("2027-01-01", None) == {
        "$gte": "9999-12-31",
        "$lte": "0000-01-01",
    }


def test_invalid_date_is_rejected():
    with pytest.raises(HTTPException) as error:
        rty._validate_date("2026-02-30")
    assert error.value.status_code == 422


async def test_sales_filter_splits_orders_and_ignores_all_sentinels():
    db = MockMotorClient()["test"]
    result = await rty._sales_filter(
        db,
        sales_order=" SO-1, SO-2\nSO-1 ",
        production_order="PO-1",
        serial_number=None,
        base="all",
        product_model="all",
    )
    assert result["data.VBELN"] == {"$in": ["SO-1", "SO-2"]}
    assert result["aufnr"] == "PO-1"
    assert "data.LGORT" not in result
    assert "data.MAKTX_TH" not in result
    assert result["data.ZSTAT"] == {"$nin": ("DLID", "RELEASED")}
    assert result["data.AUART"] == {"$nin": ("C001",)}
    assert result["data.IF_L6"] == {"$nin": ["X"]}


def test_rty_order_scope_keeps_l6_separate_and_excludes_ineligible_orders():
    assert rty._rty_order_scope_match("l6")["data.IF_L6"] == "X"


async def test_sales_filter_supports_calculation_method_scope():
    db = MockMotorClient()["test"]
    composite = await rty._sales_filter(db, calculation_method="composite")
    assert composite["data.MAKTX_TH"] == {"$in": list(rty.COMPOSITE_MODEL_ITEMS)}
    normal = await rty._sales_filter(db, calculation_method="normal")
    assert normal["data.MAKTX_TH"] == {"$nin": list(rty.COMPOSITE_MODEL_ITEMS)}
    impossible = await rty._sales_filter(
        db, product_model="6210 C21 BOX", calculation_method="normal"
    )
    assert impossible["data.MAKTX_TH"] == {"$in": []}


def test_group_field_prefers_the_most_specific_filter():
    assert rty._group_field(None, "PO-1", None, None, None) == "aufnr"
    assert rty._group_field("SO-1", None, None, None, None) == "data.VBELN"
    assert rty._group_field(None, None, "9000", "M-1", None) == "data.MAKTX_TH"
    assert rty._group_field(None, None, None, None, "CUST-1") == "data.KID"


@pytest.mark.asyncio
async def test_repair_detail_limit_is_explicit(monkeypatch):
    db = MockMotorClient()["test"]
    await db.repair_records_sap.insert_many(
        [
            {"PCODE": "SN-1", "AUFNR": "PO-1", "ZDATE_WX": "20260101"},
            {"PCODE": "SN-2", "AUFNR": "PO-1", "ZDATE_WX": "20260102"},
        ]
    )
    monkeypatch.setattr(rty, "MAX_DETAIL_ROW_COUNT", 1)

    with pytest.raises(HTTPException) as error:
        await rty._repair_details_for_orders(db, {"PO-1"})
    assert error.value.status_code == 413


def test_duplicate_repair_events_from_sap_clients_are_collapsed():
    rows = [
        {
            "_id": "600-id",
            "_source_key": "600-source",
            "MANDT": "600",
            "PCODE": "SN-1",
            "AUFNR": "PO-1",
            "VBELN": "0100001524",
            "POSNR": "000020",
            "ZDATE_WX": "20260101",
            "ZTIME": "120000",
            "ZNGWD": "F01",
            "ZWXWD": "更换硬盘",
            "rty_backfill": {"run_id": "run-1"},
        },
        {
            "_id": "800-id",
            "_source_key": "800-source",
            "MANDT": "800",
            "PCODE": "SN-1",
            "AUFNR": "PO-1",
            "VBELN": "100001524",
            "POSNR": None,
            "ZDATE_WX": "20260101",
            "ZTIME": "120000",
            "ZNGWD": "F01",
            "ZWXWD": "更换硬盘",
            "rty_backfill": {"run_id": "run-2"},
        },
        {
            "_id": "different-event",
            "MANDT": "600",
            "PCODE": "SN-1",
            "AUFNR": "PO-1",
            "VBELN": "100001524",
            "ZDATE_WX": "20260101",
            "ZTIME": "120000",
            "ZNGWD": "F01",
            "ZWXWD": "重插硬盘",
        },
    ]

    unique = rty._deduplicate_repair_rows(rows)

    assert [row["_id"] for row in unique] == ["600-id", "different-event"]
    assert rty._repair_to_detail(unique[0]).sale_no == "100001524"
