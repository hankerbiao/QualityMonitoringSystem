from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException

from app.services import rty_export
from app.services.data_gateway_client import DataGatewayClient, DataGatewayError

FILTERS = {
    "dateFrom": "2026-09-01",
    "dateTo": "2026-09-30",
    "orderScope": "normal",
}


def order(number="1", **fields):
    return {
        "aufnr": number,
        "plannedStartDate": "2026-09-01",
        "raw": {
            "data": {
                "AUFNR": number,
                "VBELN": "SO-1",
                "MAKTX_TH": "M",
                "GAMNG": "12",
                "WMENG": "10",
                "GSTRS": "2026-09-01",
                **fields,
            }
        },
    }


def fault(identity="F1", **fields):
    return {
        "id": identity,
        "raw": {
            "AUFNR": "000000000001",
            "PCODE": "SN-1",
            "ZNGWD3": "故障现象",
            "ZWXWD3": "更换部件",
            "MATNR": "PN-1",
            "MAKTX": "部件",
            "U_FIX": "repairer",
            **fields,
        },
    }


def source(monkeypatch, orders, faults=(), bindings=()):
    async def all_pages(method, path, **kwargs):
        if path == "/api/orders":
            return orders
        if path == "/api/faults":
            return faults
        if path == "/api/views/ZSGV_ZPP_SERNOLIST":
            return bindings
        raise AssertionError(path)

    loader = AsyncMock(side_effect=all_pages)
    monkeypatch.setattr(rty_export.data_gateway, "all_pages", loader)
    return loader


@pytest.mark.asyncio
async def test_template_retains_raw_repairs_but_deduplicates_machine_counts(monkeypatch):
    loader = source(
        monkeypatch,
        [order(), order("2", GAMNG="8", WMENG="10")],
        [
            fault(),
            fault("F2", ERROR_MSG="second repair of same SN"),
            fault("F3", PCODE="SN-2", ZCCLH="PN-2", RECORD01REPAIRM="serial-only"),
            fault("unrelated", AUFNR="999", PCODE="UNRELATED"),
        ],
    )
    result = await rty_export.build_template_export(FILTERS)

    assert len(result.orders) == 2
    assert len(result.faults) == 3
    assert result.faults[0]["U_FIX"] == "repairer"
    assert result.faults[0]["ZWXDT"] is None
    assert result.faults[0]["FACTORY"] is None
    assert result.summary == [
        {
            "model": "M",
            "plannedQuantity": 20,
            "completedQuantity": 20,
            "defectCount": 2,
            "completionRate": 0.9,
        }
    ]
    assert len(result.topProblems) == 2
    assert sum(row["serialCount"] for row in result.topProblems) == 2
    assert {row["material"] for row in result.topProblems} == {"PN-1", ""}
    assert all("materialUsage" not in row for row in result.topProblems)
    assert all("finalRate" not in row for row in result.summary)
    assert loader.await_args_list[0].kwargs["filters"] == {
        "dateFrom": FILTERS["dateFrom"],
        "dateTo": FILTERS["dateTo"],
    }


@pytest.mark.asyncio
async def test_export_applies_order_exclusions_scope_and_date_bounds(monkeypatch):
    loader = source(
        monkeypatch,
        [
            order("1"),
            order("2", ZSTAT="DLID"),
            order("3", ZSTAT="RELEASED"),
            order("4", AUART="C001"),
            order("5", IF_L6="X"),
            order("6", GSTRS="2026-08-31"),
        ],
    )
    result = await rty_export.build_template_export(FILTERS)
    assert [row["AUFNR"] for row in result.orders] == ["1"]
    assert result.summary[0]["defectCount"] == 0
    assert result.summary[0]["completionRate"] == 1

    result = await rty_export.build_template_export({**FILTERS, "orderScope": "l6"})
    assert [row["AUFNR"] for row in result.orders] == ["5"]
    assert all("orderScope" not in call.kwargs["filters"] for call in loader.await_args_list)


@pytest.mark.asyncio
async def test_composite_children_count_against_the_bound_head_and_keep_original_repair_sn(
    monkeypatch,
):
    source(
        monkeypatch,
        [order(MAKTX_TH="6210 C21 BOX")],
        [
            fault("head", PCODE="HEAD-SN"),
            fault("child", AUFNR="2", PCODE="CHILD-SN"),
            fault("unbound-child", AUFNR="2", PCODE="OTHER-SN"),
        ],
        [
            {
                "AUFNR_HEAD": "000000000001",
                "AUFNR_ITEM": "000000000002",
                "ZCODE_HEAD": "HEAD-SN",
                "ZCODE_ITEM": "CHILD-SN",
            }
        ],
    )
    result = await rty_export.build_template_export(FILTERS)
    assert result.summary[0]["defectCount"] == 1
    assert [row["PCODE"] for row in result.faults] == ["HEAD-SN", "CHILD-SN"]
    assert result.topProblems[0]["serialCount"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("quantity", [None, "", "invalid", "NaN", 0, False])
async def test_unavailable_or_zero_denominator_never_becomes_a_fabricated_rate(
    monkeypatch,
    quantity,
):
    source(monkeypatch, [order(WMENG=quantity)], [fault()])
    result = await rty_export.build_template_export(FILTERS)
    assert result.summary[0]["completionRate"] is None
    assert result.topProblems[0]["machineFaultRate"] is None


@pytest.mark.asyncio
async def test_repairs_missing_sn_are_retained_and_counts_remain_unavailable(monkeypatch):
    source(monkeypatch, [order()], [fault(PCODE="")])
    result = await rty_export.build_template_export(FILTERS)
    assert len(result.faults) == 1
    assert result.summary[0]["defectCount"] is None
    assert result.summary[0]["completionRate"] is None
    assert result.topProblems[0]["serialCount"] is None


@pytest.mark.asyncio
async def test_empty_export_does_not_query_faults(monkeypatch):
    loader = source(monkeypatch, [])
    result = await rty_export.build_template_export(FILTERS)
    assert result.model_dump() == {"summary": [], "orders": [], "faults": [], "topProblems": []}
    assert loader.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("raw_order", ["", "   "])
async def test_empty_raw_order_uses_the_explicit_gateway_order_key(monkeypatch, raw_order):
    loader = source(monkeypatch, [order("1", AUFNR=raw_order)], [fault()])
    result = await rty_export.build_template_export(FILTERS)

    assert result.orders[0]["AUFNR"] == "1"
    assert result.summary[0]["defectCount"] == 1
    assert set(loader.await_args.kwargs["filters"]["productionOrders"].split(",")) == {
        "1",
        "000000000001",
    }


@pytest.mark.asyncio
async def test_invalid_range_fails_before_reading_sources(monkeypatch):
    loader = source(monkeypatch, [])
    with pytest.raises(HTTPException) as error:
        await rty_export.build_template_export({**FILTERS, "dateTo": "2026-08-31"})
    assert error.value.status_code == 422
    loader.assert_not_awaited()


@pytest.mark.asyncio
async def test_fault_failure_aborts_export_instead_of_returning_partial_sheets(monkeypatch):
    loader = source(monkeypatch, [order()])
    loader.side_effect = [[order()], DataGatewayError("source failed")]
    with pytest.raises(DataGatewayError, match="source failed"):
        await rty_export.build_template_export(FILTERS)


@pytest.mark.asyncio
async def test_order_export_reads_past_the_gateway_all_endpoint_cap(monkeypatch):
    requests = []

    def handler(request):
        requests.append(request.url)
        assert request.url.path == "/api/orders"
        page = int(request.url.params["page"])
        first = (page - 1) * 100
        items = [order(str(index + 1)) for index in range(first, min(first + 100, 10_001))]
        return httpx.Response(200, json={"items": items, "total": 10_001})

    client = DataGatewayClient("http://gateway.test")
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=client.base_url
    )
    monkeypatch.setattr(rty_export, "data_gateway", client)
    try:
        rows = await rty_export._load_orders(FILTERS)
    finally:
        await client.close()
    assert len(rows) == 10_001
    assert len(requests) == 101
    assert rows[-1]["AUFNR"] == "10001"
