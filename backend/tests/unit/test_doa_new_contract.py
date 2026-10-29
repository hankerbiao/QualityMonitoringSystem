from app.schemas.doa import DoaFilters
from app.services import doa_service


def order(sales, qty, date, model="M1", customer="A"):
    return {
        "id": sales + model,
        "salesOrder": sales,
        "orderQuantity": qty,
        "plannedStartDate": date,
        "productionModel": model,
        "finalUser": customer,
    }


def repair(id, sales, product, qty, date="2026-09-10"):
    return {
        "id": id,
        "sales_order": sales,
        "judgment": "是",
        "repair_count": qty,
        "accepted_at": date,
        "planned_at": date,
        "gstrs_status": "matched",
        "service_order": id,
        "host_sn": id,
        "part_sn": "",
        "product": product,
        "customer": "",
        "raw": {},
    }


async def test_all_orders_and_unmatched_repairs_count_in_summary_and_trend(monkeypatch):
    async def orders(**kwargs):
        return [
            order("1", 100, "2026-09-01"),
            order("2", 100, "2026-09-02"),
            order("3", 500, "2026-10-01"),
        ]

    async def rows(view, **kwargs):
        return (
            [repair("a", "1", "M1_config", 1), repair("b", "404", "M1_config", 2)]
            if view == "SCS_DOA"
            else []
        )

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", rows)
    monkeypatch.setattr(doa_service, "_DOA_ORDERS_CACHE", doa_service.AsyncTTLCache())
    monkeypatch.setattr(doa_service, "_DOA_SNAPSHOT_CACHE", doa_service.AsyncTTLCache())
    filters = DoaFilters(dateFrom="2026-09-01", dateTo="2026-09-30")
    result = await doa_service.build_doa_dashboard(filters)
    assert result.summary.shippedCount == 200
    assert result.summary.repairCount == 3
    assert result.summary.repairRate == 1.5
    assert [(x.period, x.shippedCount, x.repairCount) for x in result.trend] == [
        ("2026-09", 200, 3)
    ]
    assert (await doa_service.get_doa_repairs(filters, 1, 50)).total == 2


async def test_multi_model_product_is_attributed_and_unknown_separately(monkeypatch):
    async def orders(**kwargs):
        return [order("1", 100, "2026-09-01", "M1"), order("1", 50, "2026-09-01", "M10")]

    async def rows(view, **kwargs):
        return (
            [repair("a", "1", "M10_config", 3), repair("b", "1", "unknown", 2)]
            if view == "SCS_DOA"
            else []
        )

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", rows)
    monkeypatch.setattr(doa_service, "_DOA_ORDERS_CACHE", doa_service.AsyncTTLCache())
    monkeypatch.setattr(doa_service, "_DOA_SNAPSHOT_CACHE", doa_service.AsyncTTLCache())
    all_data = await doa_service.build_doa_dashboard(DoaFilters())
    models = {x.key: x for x in all_data.byModel}
    assert models["M10"].repairCount == 3
    assert models["未匹配机型"].repairCount == 2
    selected = await doa_service.build_doa_dashboard(DoaFilters(models=["M10"]))
    assert selected.summary.shippedCount == 50
    assert selected.summary.repairCount == 3
    details = await doa_service.get_doa_repairs(DoaFilters(models=["未匹配机型"]), 1, 50)
    assert [x.id for x in details.items] == ["b"]


async def test_order_details_match_denominator_filters_and_paginate(monkeypatch):
    async def orders(**kwargs):
        return [
            order("1", 10, "2026-09-01", "M1"),
            order("2", 20, "2026-09-02", "M1"),
            order("3", 30, "2026-10-01", "M1"),
        ]

    async def rows(view, **kwargs):
        return []

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", rows)
    monkeypatch.setattr(doa_service, "_DOA_ORDERS_CACHE", doa_service.AsyncTTLCache())
    monkeypatch.setattr(doa_service, "_DOA_SNAPSHOT_CACHE", doa_service.AsyncTTLCache())
    filters = DoaFilters(dateFrom="2026-09-01", dateTo="2026-09-30")
    page = await doa_service.get_doa_orders(filters, 2, 1)
    assert page["total"] == 2
    assert page["totalQuantity"] == 30
    assert page["items"][0]["salesOrder"] == "2"


async def test_blank_quantity_is_excluded_but_zero_is_counted(monkeypatch):
    async def orders(**kwargs):
        return [order("1", 10, "2026-09-01")]

    async def rows(view, **kwargs):
        return (
            [
                {**repair("pending", "1", "M1", 4), "status": "待受理"},
                repair("missing", "1", "M1", ""),
                {**repair("blank", "1", "M1", "  "), "gstrs_status": ""},
                repair("zero", "1", "M1", 0),
                {**repair("unmatched_blank", "1", "M1", None), "gstrs_status": "unmatched"},
            ]
            if view == "SCS_DOA"
            else []
        )

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", rows)
    monkeypatch.setattr(doa_service, "_DOA_ORDERS_CACHE", doa_service.AsyncTTLCache())
    monkeypatch.setattr(doa_service, "_DOA_SNAPSHOT_CACHE", doa_service.AsyncTTLCache())
    dashboard = await doa_service.build_doa_dashboard(DoaFilters())
    details = await doa_service.get_doa_repairs(DoaFilters(), 1, 50)
    assert dashboard.summary.repairCount == 0
    assert dashboard.summary.matchedRepairRecords == 1
    assert dashboard.summary.unmatchedPlannedRecords == 0
    assert [r.id for r in details.items] == ["zero"]


async def test_repair_uses_planned_date_and_unmatched_are_listed_separately(monkeypatch):
    async def orders(**kwargs):
        return [order("1", 100, "2026-09-01")]

    async def rows(view, **kwargs):
        if view != "SCS_DOA":
            return []
        return [
            {
                **repair("in", "1", "M1", 2, "2026-10-10"),
                "planned_at": "2026-09-01",
                "gstrs_status": "matched",
            },
            {
                **repair("out", "1", "M1", 3, "2026-09-10"),
                "planned_at": "2026-10-01",
                "gstrs_status": "matched",
            },
            {
                **repair("unknown", "1", "M1", 7, "2026-09-10"),
                "planned_at": "",
                "gstrs_status": "unmatched",
            },
        ]

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", rows)
    monkeypatch.setattr(doa_service, "_DOA_ORDERS_CACHE", doa_service.AsyncTTLCache())
    monkeypatch.setattr(doa_service, "_DOA_SNAPSHOT_CACHE", doa_service.AsyncTTLCache())
    filters = DoaFilters(dateFrom="2026-09-01", dateTo="2026-09-30")
    result = await doa_service.build_doa_dashboard(filters)
    assert result.summary.repairCount == 2
    assert result.summary.unmatchedPlannedRecords == 1
    assert [(item.period, item.repairCount) for item in result.trend] == [("2026-09", 2)]
    normal = await doa_service.get_doa_repairs(filters, 1, 50)
    missing = await doa_service.get_doa_repairs(filters, 1, 50, unmatched_only=True)
    assert [item.id for item in normal.items] == ["in"]
    assert [item.id for item in missing.items] == ["unknown"]


async def test_dashboard_refuses_unbackfilled_gateway_data(monkeypatch):
    import pytest

    from app.services.data_gateway_client import DataGatewayError

    async def orders(**kwargs):
        return [order("1", 10, "2026-09-01")]

    async def rows(view, **kwargs):
        return (
            [
                {
                    key: value
                    for key, value in repair("a", "1", "M1", 1).items()
                    if key not in {"planned_at", "gstrs_status"}
                }
            ]
            if view == "SCS_DOA"
            else []
        )

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", rows)
    monkeypatch.setattr(doa_service, "_DOA_ORDERS_CACHE", doa_service.AsyncTTLCache())
    monkeypatch.setattr(doa_service, "_DOA_SNAPSHOT_CACHE", doa_service.AsyncTTLCache())
    with pytest.raises(DataGatewayError, match="计划日期"):
        await doa_service.build_doa_dashboard(DoaFilters())
