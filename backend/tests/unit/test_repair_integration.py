import asyncio
import gzip
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
        "raw": {"AUFNR_1": order, "MATNR": material, "MENGE_A": amount, **extra},
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
    monkeypatch.setattr(repair, "_ORDER_CACHE", AsyncTTLCache(max_entries=2048))
    database = MockMotorClient()["repair_test"]
    monkeypatch.setattr(repair, "get_database", lambda: database)
    monkeypatch.setattr(
        repair.data_gateway,
        "data_status",
        AsyncMock(return_value={"bomPostingsLastSyncedAt": "v1"}),
    )
    monkeypatch.setattr(repair.data_gateway, "all_pages", AsyncMock(return_value=[]))
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
        "all_pages",
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
    assert groups["PN*2"]["problem"] == "first\nsecond"
    assert groups["PN*2"]["materialUsage"] == 15
    assert groups["PN*2"]["productionQuantity"] == 50
    assert groups["PN*2"]["componentFaultRate"] == 2 / 15
    assert groups["PN*2"]["machineFaultRate"] == 1 / 50
    assert groups["OTHER*1"]["materialDescription"] == "other part"
    assert "123*1" in groups
    assert by_model["no-repair"][0]["materialCount"] == 0
    assert by_model["no-repair"][0]["productionQuantity"] == 8
    assert by_model["no-repair"][0]["machineFaultRate"] == 0
    for call in repair.data_gateway.all_pages.await_args_list:
        assert set(call.kwargs["filters"]) == {"keyword"}


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
    repair.data_gateway.all_pages.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_postings_for_one_order_invalidates_model_material_denominator(monkeypatch):
    async def load(*args, filters, **kwargs):
        return [posting()] if filters["keyword"] == "1" else []

    monkeypatch.setattr(repair.data_gateway, "all_pages", AsyncMock(side_effect=load))
    sheets = await repair.build_model_sheets([order(), order("2")], [(fault(), {("M", "S1")})])
    assert sheets[0].rows[0]["materialUsage"] == "发料记录不完整"
    assert sheets[0].rows[0]["componentFaultRate"] is None


@pytest.mark.asyncio
async def test_composite_repairs_count_once_and_use_bound_head_sns(monkeypatch):
    monkeypatch.setattr(repair.data_gateway, "all_pages", AsyncMock(return_value=[posting()]))
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
async def test_shared_cache_survives_memory_reset_and_sync_invalidates_it(monkeypatch):
    version = {"bomPostingsLastSyncedAt": "v1"}
    monkeypatch.setattr(
        repair.data_gateway, "data_status", AsyncMock(side_effect=lambda: version.copy())
    )
    loader = AsyncMock(return_value=[posting()])
    monkeypatch.setattr(repair.data_gateway, "all_pages", loader)
    first, second = await asyncio.gather(
        repair.load_order_usage(["1"]), repair.load_order_usage(["1"])
    )
    assert first["1"].quantities == second["1"].quantities == {"PN": Decimal(10)}
    assert loader.await_count == 1
    first["1"].quantities["PN"] = Decimal(999)
    monkeypatch.setattr(repair, "_ORDER_CACHE", AsyncTTLCache(max_entries=2048))
    assert (await repair.load_order_usage(["1"]))["1"].quantities == {"PN": Decimal(10)}
    assert loader.await_count == 1
    version["bomPostingsLastSyncedAt"] = "v2"
    await repair.load_order_usage(["1"])
    assert loader.await_count == 2


@pytest.mark.asyncio
async def test_overlapping_exports_reuse_orders_and_keep_global_concurrency_bounded(monkeypatch):
    active = peak = 0
    counts = {}

    async def load(*args, filters, **kwargs):
        nonlocal active, peak
        value = filters["keyword"]
        counts[value] = counts.get(value, 0) + 1
        active += 1
        peak = max(peak, active)
        try:
            await asyncio.sleep(0.001)
            return [posting(order=value)]
        finally:
            active -= 1

    monkeypatch.setattr(repair.data_gateway, "all_pages", AsyncMock(side_effect=load))
    await asyncio.gather(
        repair.load_order_usage([str(i) for i in range(1, 25)]),
        repair.load_order_usage([str(i) for i in range(12, 35)]),
    )
    assert 1 < peak <= repair.MATERIAL_CONCURRENCY
    assert set(counts) == {str(i) for i in range(1, 35)}
    assert set(counts.values()) == {1}


@pytest.mark.asyncio
async def test_failure_is_not_cached_and_started_reads_finish_before_return(monkeypatch):
    active = 0
    fail = True

    async def load(*args, filters, **kwargs):
        nonlocal active
        active += 1
        try:
            await asyncio.sleep(0)
            if fail and filters["keyword"] == "1":
                raise DataGatewayError("failed")
            return [posting(order=filters["keyword"])]
        finally:
            active -= 1

    loader = AsyncMock(side_effect=load)
    monkeypatch.setattr(repair.data_gateway, "all_pages", loader)
    with pytest.raises(DataGatewayError, match="failed"):
        await repair.load_order_usage(["1", "2"])
    assert active == 0
    fail = False
    await repair.load_order_usage(["1", "2"])
    assert loader.await_count == 3


@pytest.mark.asyncio
async def test_sync_change_during_fetch_aborts_export(monkeypatch):
    monkeypatch.setattr(
        repair.data_gateway,
        "data_status",
        AsyncMock(
            side_effect=[
                {"bomPostingsLastSyncedAt": "v1"},
                {"bomPostingsLastSyncedAt": "v2"},
            ]
        ),
    )
    monkeypatch.setattr(repair.data_gateway, "all_pages", AsyncMock(return_value=[posting()]))
    with pytest.raises(DataGatewayError, match="版本发生变化"):
        await repair.load_order_usage(["1"])


@pytest.mark.asyncio
async def test_duplicate_orders_count_production_once_and_conflicts_abort(monkeypatch):
    monkeypatch.setattr(repair.data_gateway, "all_pages", AsyncMock(return_value=[posting()]))
    sheets = await repair.build_model_sheets([order(), order("00001")], [(fault(), {("M", "S")})])
    assert sheets[0].rows[0]["productionQuantity"] == 20
    with pytest.raises(DataGatewayError, match="冲突"):
        await repair.build_model_sheets([order(), order(amount="30")], [])


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status",
    [
        {},
        {"bomPostingsLastSyncedAt": "v1", "startedAt": "2026-10-16T02:00:00Z"},
        {
            "bomPostingsLastSyncedAt": "v1",
            "startedAt": "2026-10-16T02:00:00Z",
            "finishedAt": "2026-10-16T01:00:00Z",
        },
    ],
)
async def test_unversioned_reads_skip_persistent_cache(monkeypatch, status):
    monkeypatch.setattr(repair.data_gateway, "data_status", AsyncMock(return_value=status))
    monkeypatch.setattr(repair, "get_database", lambda: pytest.fail("unexpected persistent cache"))
    loader = AsyncMock(return_value=[posting()])
    monkeypatch.setattr(repair.data_gateway, "all_pages", loader)
    assert (await repair.load_order_usage(["1"]))["1"].quantities == {"PN": Decimal(10)}
    await repair.load_order_usage(["1"])
    loader.assert_awaited_once()


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
        {"_id": repair._cache_id("1", "v1")},
        {
            "$set": {
                "expiresAt": datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1),
                "payload": gzip.compress(json.dumps(payload).encode()),
            }
        },
        upsert=True,
    )
    loader = AsyncMock(return_value=[posting()])
    monkeypatch.setattr(repair.data_gateway, "all_pages", loader)
    assert (await repair.load_order_usage(["1"]))["1"].quantities == {"PN": Decimal(10)}
    loader.assert_awaited_once()


@pytest.mark.asyncio
async def test_persistent_cache_outage_does_not_prevent_export(monkeypatch):
    def unavailable():
        raise PyMongoError("cache unavailable")

    monkeypatch.setattr(repair, "get_database", unavailable)
    monkeypatch.setattr(repair.data_gateway, "all_pages", AsyncMock(return_value=[posting()]))
    assert (await repair.load_order_usage(["1"]))["1"].quantities == {"PN": Decimal(10)}


@pytest.mark.asyncio
async def test_truncated_compressed_cache_falls_back_to_gateway(monkeypatch, isolated_cache):
    await isolated_cache[repair.MATERIAL_CACHE_COLLECTION].update_one(
        {"_id": repair._cache_id("1", "v1")},
        {
            "$set": {
                "expiresAt": datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1),
                "payload": gzip.compress(b"{}")[:-4],
            }
        },
        upsert=True,
    )
    loader = AsyncMock(return_value=[posting()])
    monkeypatch.setattr(repair.data_gateway, "all_pages", loader)
    assert (await repair.load_order_usage(["1"]))["1"].quantities == {"PN": Decimal(10)}
    loader.assert_awaited_once()
