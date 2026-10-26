import asyncio
import gzip
import hashlib
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from pymongo.errors import PyMongoError

from app.services import repair_integration as repair
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.data_gateway_client import DataGatewayError
from tests.mock_motor import MockMotorClient


def posting(order="1", material="PN", amount="10", identity="P1", **extra):
    return {
        "id": identity,
        "raw": {"AUFNR_1": order, "MATNR": material, "MENGE_A": amount, "BWART": "261", **extra},
    }


def order(number="1", model="M", amount="20"):
    return {"AUFNR": number, "MAKTX_TH": model, "GAMNG": amount, "VBELN": "SO"}


def fault(**extra):
    return {
        "ZNGWD3": "first",
        "ZWXWD3": "replace",
        "MATNR": "PN",
        "MAKTX": "part",
        **extra,
    }


@pytest.fixture(autouse=True)
def isolated_cache(monkeypatch):
    monkeypatch.setattr(repair, "_ORDER_CACHE", AsyncTTLCache(max_entries=8))
    database = MockMotorClient()["repair_test"]
    monkeypatch.setattr(repair, "get_database", lambda: database)
    monkeypatch.setattr(
        repair.data_gateway,
        "data_status",
        AsyncMock(return_value={"bomPostingsLastSyncedAt": "v1"}),
    )
    monkeypatch.setattr(repair.data_gateway, "export_rows", AsyncMock(return_value=[]))
    return database


def test_postings_use_exact_order_decimal_signed_quantities_and_unique_source_ids():
    first = posting(material="0000123", amount="1.2", VBELN_EX="SO", MAKTX="part")
    result = repair.aggregate_postings(
        "1",
        [
            first,
            first,
            posting(material="123", amount="-0.2", identity="P2"),
            posting(order="11", amount="999", identity="unrelated"),
        ],
    )
    assert result.row_count == 2
    assert result.quantities == {"123": Decimal("1.0")}
    assert result.sales == {"SO"}
    assert result.descriptions == {"123": {"part": None}}


@pytest.mark.parametrize(
    "row",
    [
        posting(amount="NaN"),
        posting(amount="wrong"),
        posting(identity=""),
        posting(material=""),
    ],
)
def test_invalid_source_values_abort_instead_of_becoming_zero(row):
    with pytest.raises(DataGatewayError):
        repair.aggregate_postings("1", [row])


def test_conflicting_duplicate_posting_aborts():
    with pytest.raises(DataGatewayError, match="内容冲突"):
        repair.aggregate_postings("1", [posting(), posting(amount="20")])


@pytest.mark.parametrize(
    "issued,returned,expected",
    [("607", "400", "207"), ("10.5", "0.3", "10.2"), ("10", "10", "0"), ("1", "3", "-2")],
)
def test_postings_subtract_returns_and_ignore_other_movements(issued, returned, expected):
    issue = posting(amount=issued)
    rows = [
        issue,
        issue,
        posting(amount=returned, identity="return", BWART=" 262 "),
        *[
            posting(amount="800", identity=movement, BWART=movement)
            for movement in ("101", "601", "602", "Z35", "Z37")
        ],
        posting(order="2", amount="999", identity="another-order"),
    ]
    usage = repair.aggregate_postings("1", rows)
    assert usage.quantities == {"PN": Decimal(expected)}


@pytest.mark.parametrize("movement", [None, ""])
def test_postings_reject_missing_movement_type(movement):
    row = posting(BWART=movement)
    if movement is None:
        del row["raw"]["BWART"]
    with pytest.raises(DataGatewayError, match="移动类型"):
        repair.aggregate_postings("1", [row])


def test_duplicate_posting_with_conflicting_movement_type_aborts():
    with pytest.raises(DataGatewayError, match="内容冲突"):
        repair.aggregate_postings("1", [posting(), posting(BWART="262")])


@pytest.mark.asyncio
async def test_model_material_usage_subtracts_returns_for_all_selected_orders(monkeypatch):
    monkeypatch.setattr(
        repair.data_gateway,
        "export_rows",
        AsyncMock(return_value=[
            *[posting(material="000000000024002317", amount="200", identity=f"issue-{i}") for i in range(3)],
            *[posting(material="24002317", amount="200", identity=f"return-{i}", BWART="262") for i in range(2)],
            posting(order="2", material="24002317", amount="7", identity="issue-2nd-order"),
        ]),
    )
    sheets = await repair.build_model_sheets(
        [order(model="6210 C1"), order("2", model="6210 C1")],
        [(fault(MATNR="24002317"), {("6210 C1", f"SN-{i}")}) for i in range(6)],
    )
    row = sheets[0].rows[0]
    assert row["materialUsage"] == 207
    assert row["materialCount"] == 6
    assert row["componentFaultRate"] == pytest.approx(6 / 207)
    assert row["productionQuantity"] == 40


@pytest.mark.asyncio
async def test_order_usage_ignores_cache_from_before_movement_type_fix(monkeypatch, isolated_cache):
    old_key = hashlib.sha256(json.dumps(["v2", repair.data_gateway.base_url, "1"]).encode()).hexdigest()
    await isolated_cache[repair.MATERIAL_CACHE_COLLECTION].insert_one({
        "_id": old_key,
        "expiresAt": datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=24),
        "payload": gzip.compress(json.dumps({
            "quantities": {"PN": "1007"}, "descriptions": {}, "sales": [], "row_count": 2,
        }).encode()),
    })
    monkeypatch.setattr(repair.data_gateway, "export_rows", AsyncMock(return_value=[
        posting(amount="607"),
        posting(amount="400", identity="return", BWART="262"),
    ]))
    assert (await repair.load_order_usage(["1"]))["1"].quantities == {"PN": Decimal(207)}


@pytest.mark.asyncio
async def test_order_usage_fetches_all_bom_orders_in_one_batch(monkeypatch):
    loader = AsyncMock(
        return_value=[
            posting(order="1"),
            posting(order="2", material="PN-2", identity="P2"),
        ]
    )
    monkeypatch.setattr(repair.data_gateway, "export_rows", loader)

    usages = await repair.load_order_usage(["2", "1", "1"])

    assert usages["1"].quantities == {"PN": Decimal(10)}
    assert usages["2"].quantities == {"PN-2": Decimal(10)}
    loader.assert_awaited_once_with("bom", ["1", "2"], max_rows=repair.MAX_EXPORT_POSTINGS)


@pytest.mark.asyncio
async def test_order_usage_rejects_rows_for_unrequested_orders(monkeypatch):
    monkeypatch.setattr(
        repair.data_gateway, "export_rows", AsyncMock(return_value=[posting(order="3")])
    )
    with pytest.raises(DataGatewayError, match="未请求"):
        await repair.load_order_usage(["1"])


@pytest.mark.asyncio
async def test_grouping_counts_repairs_not_sns_and_never_uses_repair_dates(monkeypatch):
    rows = [
        (fault(ZNGWD3="first", ZDATE_WX="20200101"), {("M", "S1")}),
        (fault(ZNGWD3="second", ZWXDT="2099-01-01"), {("M", "S1")}),
        (fault(ZCCLH="OTHER", MATNR="PN", MAKTX="must not attach"), {("M", "S2")}),
        (fault(ZWXWD3="nonkey", MATNR="", RECORD01REPAIRM="0000123"), {("M", "S3")}),
    ]
    monkeypatch.setattr(
        repair.data_gateway,
        "export_rows",
        AsyncMock(
            return_value=[
                posting(VBELN_EX="SO"),
                posting(order="2", amount="5", identity="P2", VBELN_EX="SO"),
                posting(material="OTHER", identity="P3", VBELN_EX="SO", MAKTX="other part"),
                posting(material="123", identity="P4", VBELN_EX="SO"),
            ]
        ),
    )
    sheets = await repair.build_model_sheets(
        [order(), order("2", amount="30"), order("3", model="no-repair", amount="8")], rows
    )
    by_model = {sheet.model: sheet.rows for sheet in sheets}
    groups = {row["material"]: row for row in by_model["M"]}
    assert groups["PN*2"]["materialCount"] == 2
    assert groups["PN*2"]["serialCount"] == 1
    assert groups["PN*2"]["problem"] == "first * 1\nsecond * 1"
    assert groups["OTHER*1"]["problem"] == "first * 1"
    assert groups["PN*2"]["materialUsage"] == 15
    assert groups["PN*2"]["productionQuantity"] == 50
    assert groups["PN*2"]["componentFaultRate"] == 2 / 15
    assert groups["PN*2"]["machineFaultRate"] == 1 / 50
    assert groups["OTHER*1"]["materialDescription"] == "other part"
    assert "123*1" in groups
    assert by_model["no-repair"][0]["materialCount"] == 0
    assert by_model["no-repair"][0]["productionQuantity"] == 8
    assert by_model["no-repair"][0]["machineFaultRate"] == 0
    repair.data_gateway.export_rows.assert_awaited_once_with(
        "bom", ["1", "2"], max_rows=repair.MAX_EXPORT_POSTINGS
    )


@pytest.mark.asyncio
async def test_missing_material_sn_and_quantities_remain_explicit():
    sheets = await repair.build_model_sheets(
        [order(amount="invalid")],
        [(fault(MATNR="", MAKTX=""), {("M", "")})],
    )
    row = sheets[0].rows[0]
    assert row["material"] == "未填写物料号*1"
    assert row["materialUsage"] == "未填写物料号"
    assert row["serialCount"] == "缺少SN（1条）"
    assert row["productionQuantity"] == "缺少整机数量"
    assert row["componentFaultRate"] is None
    assert row["machineFaultRate"] is None
    repair.data_gateway.export_rows.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_postings_for_one_order_invalidates_model_material_denominator(monkeypatch):
    async def load(resource, keys, **kwargs):
        return [posting()] if "1" in keys else []

    monkeypatch.setattr(repair.data_gateway, "export_rows", AsyncMock(side_effect=load))
    sheets = await repair.build_model_sheets([order(), order("2")], [(fault(), {("M", "S1")})])
    assert sheets[0].rows[0]["materialUsage"] == "发料记录不完整"
    assert sheets[0].rows[0]["componentFaultRate"] is None


@pytest.mark.asyncio
async def test_composite_repairs_count_once_and_use_bound_head_sns(monkeypatch):
    monkeypatch.setattr(repair.data_gateway, "export_rows", AsyncMock(return_value=[posting()]))
    sheets = await repair.build_model_sheets(
        [order()],
        [
            (fault(), {("M", "HEAD"), ("M", "HEAD2")}),
            (fault(), {("M", "HEAD")}),
        ],
    )
    assert sheets[0].rows[0]["materialCount"] == 2
    assert sheets[0].rows[0]["serialCount"] == 2


@pytest.mark.asyncio
async def test_model_sheet_problem_marks_single_and_repeated_symptom_counts(monkeypatch):
    monkeypatch.setattr(repair.data_gateway, "export_rows", AsyncMock(return_value=[posting()]))
    faults = [
        (fault(ZNGWD3="single", MATNR="PN2"), {("M", "S1")}),
        (fault(ZNGWD3="repeated"), {("M", "S2")}),
        (fault(ZNGWD3="unique"), {("M", "S3")}),
        *[
            (fault(ZNGWD3="repeated"), {("M", f"S{index + 4}")})
            for index in range(11)
        ],
        (fault(ZNGWD3="repeated", MATNR="PN3"), {("M", "S15")}),
    ]
    sheets = await repair.build_model_sheets(
        [order()],
        faults,
    )

    rows = {row["material"]: row for row in sheets[0].rows}
    assert rows["PN2*1"]["problem"] == "single * 1"
    assert rows["PN*13"]["problem"] == "repeated * 12\nunique * 1"
    assert rows["PN3*1"]["problem"] == "repeated * 1"


@pytest.mark.asyncio
async def test_shared_cache_survives_memory_reset_without_sync_status(monkeypatch):
    monkeypatch.setattr(
        repair.data_gateway,
        "data_status",
        AsyncMock(side_effect=AssertionError("material cache must not read sync status")),
    )
    loader = AsyncMock(return_value=[posting()])
    monkeypatch.setattr(repair.data_gateway, "export_rows", loader)
    first, second = await asyncio.gather(
        repair.load_order_usage(["1"]), repair.load_order_usage(["1"])
    )
    assert first["1"].quantities == second["1"].quantities == {"PN": Decimal(10)}
    assert loader.await_count == 1
    first["1"].quantities["PN"] = Decimal(999)
    monkeypatch.setattr(repair, "_ORDER_CACHE", AsyncTTLCache(max_entries=8))
    assert (await repair.load_order_usage(["1"]))["1"].quantities == {"PN": Decimal(10)}
    assert loader.await_count == 1


@pytest.mark.asyncio
async def test_concurrent_identical_exports_share_one_bom_query(monkeypatch):
    async def load(resource, keys, **kwargs):
        await asyncio.sleep(0.001)
        return [posting(order=value, identity=f"P{value}") for value in keys]

    loader = AsyncMock(side_effect=load)
    monkeypatch.setattr(repair.data_gateway, "export_rows", loader)
    orders = [str(i) for i in range(1, 25)]
    await asyncio.gather(
        repair.load_order_usage(orders),
        repair.load_order_usage(orders),
    )
    loader.assert_awaited_once_with("bom", sorted(orders), max_rows=repair.MAX_EXPORT_POSTINGS)


@pytest.mark.asyncio
async def test_failure_is_not_cached_and_started_reads_finish_before_return(monkeypatch):
    loader = AsyncMock(side_effect=[DataGatewayError("failed"), [posting(), posting(order="2")]])
    monkeypatch.setattr(repair.data_gateway, "export_rows", loader)
    with pytest.raises(DataGatewayError, match="failed"):
        await repair.load_order_usage(["1", "2"])
    await repair.load_order_usage(["1", "2"])
    assert loader.await_count == 2


@pytest.mark.asyncio
async def test_material_export_does_not_check_sync_status(monkeypatch):
    monkeypatch.setattr(
        repair.data_gateway,
        "data_status",
        AsyncMock(side_effect=AssertionError("material export must not read sync status")),
    )
    monkeypatch.setattr(repair.data_gateway, "export_rows", AsyncMock(return_value=[posting()]))
    assert (await repair.load_order_usage(["1"]))["1"].quantities == {"PN": Decimal(10)}


@pytest.mark.asyncio
async def test_duplicate_orders_count_production_once_and_conflicts_abort(monkeypatch):
    monkeypatch.setattr(repair.data_gateway, "export_rows", AsyncMock(return_value=[posting()]))
    sheets = await repair.build_model_sheets([order(), order("00001")], [(fault(), {("M", "S")})])
    assert sheets[0].rows[0]["productionQuantity"] == 20
    with pytest.raises(DataGatewayError, match="冲突"):
        await repair.build_model_sheets([order(), order(amount="30")], [])


@pytest.mark.asyncio
async def test_material_cache_is_persisted_without_sync_version(monkeypatch, isolated_cache):
    monkeypatch.setattr(
        repair.data_gateway,
        "data_status",
        AsyncMock(side_effect=AssertionError("material cache must not read sync status")),
    )
    loader = AsyncMock(return_value=[posting()])
    monkeypatch.setattr(repair.data_gateway, "export_rows", loader)
    assert (await repair.load_order_usage(["1"]))["1"].quantities == {"PN": Decimal(10)}
    monkeypatch.setattr(repair, "_ORDER_CACHE", AsyncTTLCache(max_entries=8))
    await repair.load_order_usage(["1"])
    loader.assert_awaited_once()
    assert await isolated_cache[repair.MATERIAL_CACHE_COLLECTION].count_documents({}) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"quantities": [], "descriptions": {}, "sales": [], "row_count": 1},
        {"quantities": {"PN": "NaN"}, "descriptions": {}, "sales": [], "row_count": 1},
        {"quantities": {"PN": "10"}, "descriptions": [], "sales": [], "row_count": -1},
    ],
)
async def test_corrupt_persistent_cache_falls_back_to_gateway(monkeypatch, isolated_cache, payload):
    await isolated_cache[repair.MATERIAL_CACHE_COLLECTION].update_one(
        {"_id": repair._cache_id("1")},
        {
            "$set": {
                "expiresAt": datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1),
                "payload": gzip.compress(json.dumps(payload).encode()),
            }
        },
        upsert=True,
    )
    loader = AsyncMock(return_value=[posting()])
    monkeypatch.setattr(repair.data_gateway, "export_rows", loader)
    assert (await repair.load_order_usage(["1"]))["1"].quantities == {"PN": Decimal(10)}
    loader.assert_awaited_once()


@pytest.mark.asyncio
async def test_persistent_cache_outage_does_not_prevent_export(monkeypatch):
    def unavailable():
        raise PyMongoError("cache unavailable")

    monkeypatch.setattr(repair, "get_database", unavailable)
    monkeypatch.setattr(repair.data_gateway, "export_rows", AsyncMock(return_value=[posting()]))
    assert (await repair.load_order_usage(["1"]))["1"].quantities == {"PN": Decimal(10)}


@pytest.mark.asyncio
async def test_truncated_compressed_cache_falls_back_to_gateway(monkeypatch, isolated_cache):
    await isolated_cache[repair.MATERIAL_CACHE_COLLECTION].update_one(
        {"_id": repair._cache_id("1")},
        {
            "$set": {
                "expiresAt": datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1),
                "payload": gzip.compress(b"{}")[:-4],
            }
        },
        upsert=True,
    )
    loader = AsyncMock(return_value=[posting()])
    monkeypatch.setattr(repair.data_gateway, "export_rows", loader)
    assert (await repair.load_order_usage(["1"]))["1"].quantities == {"PN": Decimal(10)}
    loader.assert_awaited_once()
