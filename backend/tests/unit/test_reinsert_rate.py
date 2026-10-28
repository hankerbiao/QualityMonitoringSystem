from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.auth_permissions import normalize_dashboard_permissions
from app.base_access import base_access_scope
from app.services import async_ttl_cache, reinsert_rate, repair_integration


def order(number, month, model="M1", base="B1", quantity="100"):
    return {
        "AUFNR": number,
        "GSTRS": f"2026{month}15",
        "MAKTX_TH": model,
        "LGORT": base,
        "GAMNG": quantity,
        "VBELN": "S1",
    }


def fault(number, sn="SN1", station="OP1", component="CPU", pn="PN1", action="重插"):
    return {
        "_order": number,
        "PCODE": sn,
        "ZNGGZ": station,
        "ZBJ": component,
        "ZCCLH": pn,
        "ZWXWD3": action,
    }


def usage(amount):
    return repair_integration.OrderUsage(
        quantities={"PN1": Decimal(amount)}, sales={"S1"}, row_count=1
    )


def test_monthly_distinct_events_and_range_wide_model_denominators():
    orders = [order("1", "01"), order("2", "02"), order("3", "01", "M2", quantity="50")]
    faults = [
        fault("1"),
        fault("1"),
        fault("1", component="内存", pn="PN2"),
        fault("3", sn="SN2"),
        fault("1", sn="SN3", action="更换"),
        fault("1", sn="", action="重插"),
    ]
    data = reinsert_rate.aggregate(
        orders,
        faults,
        {"1": usage("200"), "2": usage("120"), "3": usage("50")},
        "2026-01-10",
        "2026-02-20",
    )
    base = data["bases"][0]
    assert data["months"] == ["2026-01", "2026-02"]
    assert data["invalidCount"] == data["invalidReinsertCount"] == 1
    assert base["months"]["2026-01"]["reinsertCount"] == 2
    cpu = next(item for item in base["components"] if item["component"] == "CPU")
    memory = next(item for item in base["components"] if item["component"] == "内存")
    assert cpu["months"]["2026-01"]["reinsertCount"] == 2
    assert memory["months"]["2026-01"]["reinsertCount"] == 1
    assert cpu["months"]["2026-01"]["repairCount"] == 3
    pn = cpu["pns"][0]
    assert pn["months"]["2026-01"]["plannedQuantity"] == 150
    assert pn["months"]["2026-01"]["usageQuantity"] == 250
    assert pn["months"]["2026-01"]["usageRate"] == 0.8
    assert pn["months"]["2026-02"]["reinsertCount"] == 0
    assert pn["months"]["2026-02"]["plannedQuantity"] == 100
    assert pn["months"]["2026-02"]["usageQuantity"] == 120
    detail = reinsert_rate.details(
        orders, faults, {}, [], "B1", "2026-01", "CPU", "PN1", "reinsert", 1, 50
    )
    assert detail["total"] == 2
    assert detail["items"][0]["记录数"] == 2


def test_missing_and_zero_denominators_are_not_fabricated():
    orders = [order("1", "01", quantity=None)]
    faults = [fault("1")]
    data = reinsert_rate.aggregate(
        orders, faults, {"1": repair_integration.OrderUsage()}, "2026-01-01", "2026-01-31"
    )
    cell = data["bases"][0]["components"][0]["pns"][0]["months"]["2026-01"]
    assert cell["plannedQuantity"] is None and cell["plannedRate"] is None
    assert cell["usageQuantity"] is None and cell["usageReason"] == "发料记录不完整"
    zero = reinsert_rate.aggregate(
        [order("1", "01", quantity="0")], faults, {"1": usage("0")}, "2026-01-01", "2026-01-31"
    )
    cell = zero["bases"][0]["components"][0]["pns"][0]["months"]["2026-01"]
    assert cell["plannedRate"] is None and cell["usageRate"] is None


def test_model_base_groups_and_details_keep_their_own_orders_and_events():
    orders = [
        order("1", "01", "M1", "B1", "100"),
        order("2", "01", "M1", "B2", "200"),
        order("3", "01", "M2", "B1", "300"),
        order("4", "01", "", "B1", "400"),
    ]
    faults = [fault(str(i), sn=f"SN{i}") for i in range(1, 5)]
    amounts = {str(i): usage(str(i * 10)) for i in range(1, 5)}
    data = reinsert_rate.aggregate(orders, faults, amounts, "2026-01-01", "2026-01-31")
    groups = {item["model"]: {base["base"]: base for base in item["bases"]} for item in data["models"]}
    assert set(groups["M1"]) == {"B1", "B2"}
    assert groups["M1"]["B1"]["months"]["2026-01"]["plannedQuantity"] == 100
    assert groups["M1"]["B2"]["months"]["2026-01"]["plannedQuantity"] == 200
    assert groups["M2"]["B1"]["months"]["2026-01"]["plannedQuantity"] == 300
    assert groups[""]["B1"]["months"]["2026-01"]["plannedQuantity"] == 400
    for model, number in [("M1", "1"), ("M2", "3"), ("", "4")]:
        event_detail = reinsert_rate.details(
            orders, faults, amounts, [], "B1", "2026-01", "", "", "reinsert", 1, 50, model
        )
        order_detail = reinsert_rate.details(
            orders, faults, amounts, [], "B1", "2026-01", "", "", "orders", 1, 50, model
        )
        assert event_detail["total"] == 1
        assert event_detail["items"][0]["SN"] == f"SN{number}"
        assert [row["AUFNR"] for row in order_detail["items"]] == [number]
        pn_cell = groups[model]["B1"]["components"][0]["pns"][0]["months"]["2026-01"]
        assert pn_cell["usageQuantity"] == int(number) * 10


@pytest.mark.asyncio
async def test_sources_cache_expires_after_one_hour(monkeypatch):
    now = [10000.0]
    monkeypatch.setattr(async_ttl_cache, "time", SimpleNamespace(monotonic=lambda: now[0]))
    monkeypatch.setattr(reinsert_rate, "_CACHE", reinsert_rate.AsyncTTLCache())
    loader = AsyncMock(return_value=[])
    monkeypatch.setattr(reinsert_rate.rty_export, "_load_orders", loader)

    async def load():
        return await reinsert_rate.load_sources("2026-01-01", "2026-01-31", [], [], [])

    await load()
    now[0] += 3599
    await load()
    assert loader.await_count == 1
    now[0] += 1
    await load()
    assert loader.await_count == 2


@pytest.mark.asyncio
async def test_sources_filter_orders_validate_postings_and_keep_base_scope(monkeypatch):
    source_orders = [order("1", "01")]
    loader = AsyncMock(return_value=source_orders)
    monkeypatch.setattr(reinsert_rate.rty_export, "_load_orders", loader)

    async def faults(*args, **kwargs):
        yield [
            {
                "id": "f1",
                "raw": {
                    "AUFNR": "1",
                    "PCODE": "SN",
                    "ZNGGZ": "OP",
                    "ZWXWD3": "重插",
                    "ZCCLH": "PN1",
                },
            }
        ]

    monkeypatch.setattr(reinsert_rate.rty_export, "_source_batches", faults)
    monkeypatch.setattr(
        reinsert_rate.data_gateway,
        "export_rows",
        AsyncMock(
            return_value=[
                {
                    "id": "p1",
                    "raw": {"AUFNR_1": "1", "MATNR": "PN1", "BWART": "261", "MENGE_A": "10"},
                },
                {
                    "id": "p2",
                    "raw": {"AUFNR_1": "1", "MATNR": "PN1", "BWART": "262", "MENGE_A": "2"},
                },
            ]
        ),
    )
    monkeypatch.setattr(reinsert_rate, "_CACHE", reinsert_rate.AsyncTTLCache())
    with base_access_scope(["B1"]):
        orders, rows, amounts, postings = await reinsert_rate.load_sources(
            "2026-01-01", "2026-01-31", [], [], ["B1"]
        )
    assert loader.await_args.kwargs["bases"] == ["B1"]
    assert amounts["1"].quantities["PN1"] == 8
    assert len(rows) == 1 and len(postings) == 2
    detail = reinsert_rate.details(
        orders, rows, amounts, postings, "B1", "2026-01", "未填写部件", "PN1", "postings", 1, 50
    )
    assert detail["total"] == 2


def test_legacy_users_do_not_receive_new_permission():
    assert "reinsert-rate" not in normalize_dashboard_permissions(None)
    assert "reinsert-rate" in normalize_dashboard_permissions(["reinsert-rate"])
def test_single_month_daily_trends_use_planned_order_dates_and_daily_denominators():
    orders = [
        {"AUFNR": "1", "LGORT": "B1", "MAKTX_TH": "M1", "GSTRS": "2026-01-01", "GAMNG": 10},
        {"AUFNR": "2", "LGORT": "B1", "MAKTX_TH": "M1", "GSTRS": "20260103", "GAMNG": 20},
        {"AUFNR": "3", "LGORT": "B1", "MAKTX_TH": "M2", "GSTRS": "2026-01-01", "GAMNG": 100},
    ]
    faults = [
        {"_order": "1", "PCODE": "S1", "ZNGGZ": "OP1", "ZBJ": "CPU", "ZCCLH": "PN1", "ZWXWD3": "重插", "T_FIND": "2026-01-03"},
        {"_order": "1", "PCODE": "S1", "ZNGGZ": "OP1", "ZBJ": "CPU", "ZCCLH": "PN1", "ZWXWD3": "重插"},
        {"_order": "2", "PCODE": "S2", "ZNGGZ": "OP1", "ZBJ": "CPU", "ZCCLH": "PN1", "ZWXWD3": "重插"},
    ]
    result = reinsert_rate.aggregate(orders, faults, {}, "2026-01-01", "2026-01-03")
    base = result["models"][0]["bases"][0]
    assert list(base["days"]) == ["2026-01-01", "2026-01-02", "2026-01-03"]
    assert base["days"]["2026-01-01"]["reinsertCount"] == 1
    assert base["days"]["2026-01-01"]["plannedRate"] == 10
    assert base["days"]["2026-01-02"]["plannedRate"] is None
    assert base["days"]["2026-01-03"]["plannedRate"] == 5
    assert base["topPns"][0]["days"]["2026-01-01"]["plannedRate"] == 10
    assert base["months"]["2026-01"]["plannedRate"] == 6.67
    across_months = reinsert_rate.aggregate(orders, faults, {}, "2026-01-01", "2026-02-01")
    assert "days" not in across_months["models"][0]["bases"][0]
