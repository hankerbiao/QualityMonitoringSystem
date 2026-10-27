from app.api.doa import _filters
from app.schemas.doa import DoaFilters
from app.services import doa_service


def shipment(
    sales_order: str,
    quantity: int,
    date: str,
    *,
    company_5000: bool = True,
    customer: str = "客户A",
    model: str = "M1",
):
    return {
        "salesOrder": sales_order,
        "shipmentQuantity": quantity,
        "shipmentDate": date,
        "orderQuantity": quantity,
        "plannedStartDate": date,
        "is5000Company": company_5000,
        "finalUser": customer,
        "productionModel": model,
    }


def doa(
    record_id: str,
    sales_order: str,
    judgment: str,
    repair_count: int,
):
    return {
        "id": record_id,
        "sales_order": sales_order,
        "judgment": judgment,
        "repair_count": repair_count,
        "accepted_at": "2026-09-02",
        "service_order": record_id,
        "host_sn": f"SN-{record_id}",
        "part_sn": "",
        "raw": {},
    }


async def test_dashboard_filters_multiple_customers_and_models(monkeypatch):
    async def all_orders(**_filters):
        return [
            shipment("1", 10, "2026-09-01", customer="A", model="M1"),
            shipment("2", 20, "2026-09-01", customer="B", model="M2"),
            shipment("3", 30, "2026-09-01", customer="C", model="M1"),
            shipment("4", 40, "2026-09-01", customer="A", model="M3"),
        ]

    async def all_rows(view_id, **_filters):
        return [doa(str(i), str(i), "是", i) for i in range(1, 5)] if view_id == "SCS_DOA" else []

    monkeypatch.setattr(doa_service, "_DOA_ORDERS_CACHE", doa_service.AsyncTTLCache())
    monkeypatch.setattr(doa_service, "_DOA_SNAPSHOT_CACHE", doa_service.AsyncTTLCache())
    monkeypatch.setattr(doa_service.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", all_rows)
    filters = _filters(customers=["B", "A", "A"], models=["M2", "M1"])
    result = await doa_service._build_doa_dashboard(filters)
    repairs = await doa_service.get_doa_repairs(filters, 1, 50)

    assert filters.customers == ["A", "B"]
    assert result.summary.shippedCount == 30
    assert result.summary.repairCount == 3
    assert {item.salesOrder for item in repairs.items} == {"1", "2"}


async def test_unfilled_dimension_drilldown_matches_ranking(monkeypatch):
    async def all_orders(**_filters):
        return [
            shipment("1", 10, "2026-09-01", customer="", model=""),
            shipment("2", 20, "2026-09-01", customer="A", model="M1"),
        ]

    async def all_rows(view_id, **_filters):
        return [doa("one", "1", "是", 2), doa("two", "2", "是", 3)] if view_id == "SCS_DOA" else []

    monkeypatch.setattr(doa_service, "_DOA_ORDERS_CACHE", doa_service.AsyncTTLCache())
    monkeypatch.setattr(doa_service, "_DOA_SNAPSHOT_CACHE", doa_service.AsyncTTLCache())
    monkeypatch.setattr(doa_service.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", all_rows)
    dashboard = await doa_service._build_doa_dashboard(DoaFilters())
    for dimension in ("customers", "models"):
        filters = DoaFilters(**{dimension: ["未填写"]})
        repairs = await doa_service.get_doa_repairs(filters, 1, 50)
        ranking = dashboard.byCustomer if dimension == "customers" else dashboard.byModel
        unfilled = next(item for item in ranking if item.key == "未填写")
        assert repairs.totalRepairCount == unfilled.repairCount == 2
        assert [item.salesOrder for item in repairs.items] == ["1"]


async def test_doa_snapshot_is_keyed_by_filters_and_expires_after_five_minutes(monkeypatch):
    from app.services import async_ttl_cache

    now = [100.0]
    calls = []

    async def load(filters):
        calls.append(filters.customer)
        return [], [], [{"customer": filters.customer}], []

    monkeypatch.setattr(async_ttl_cache.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(doa_service, "_DOA_SNAPSHOT_CACHE", doa_service.AsyncTTLCache())
    monkeypatch.setattr(doa_service, "_load_doa_snapshot", load)
    assert (await doa_service._doa_snapshot(DoaFilters(customer="A")))[2][0]["customer"] == "A"
    assert (await doa_service._doa_snapshot(DoaFilters(customer="A")))[2][0]["customer"] == "A"
    assert (await doa_service._doa_snapshot(DoaFilters(customer="B")))[2][0]["customer"] == "B"
    now[0] += 300
    assert (await doa_service._doa_snapshot(DoaFilters(customer="A")))[2][0]["customer"] == "A"
    assert calls == ["A", "B", "A"]


async def test_dashboard_reuses_orders_across_filter_changes(monkeypatch):
    calls = 0

    async def all_orders(**_filters):
        nonlocal calls
        calls += 1
        return [shipment("1", 20, "2026-09-01", customer="A")]

    async def all_rows(view_id, **_filters):
        return [doa("one", "1", "是", 2)] if view_id == "SCS_DOA" else []

    monkeypatch.setattr(doa_service, "_DOA_ORDERS_CACHE", doa_service.AsyncTTLCache())
    monkeypatch.setattr(doa_service.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", all_rows)

    first = await doa_service._build_doa_dashboard(DoaFilters(customer="A"))
    second = await doa_service._build_doa_dashboard(DoaFilters(customer="B"))

    assert first.summary.shippedCount == 20
    assert second.summary.shippedCount == 0
    assert calls == 1


async def test_dashboard_and_repairs_share_one_doa_snapshot(monkeypatch):
    calls = {"orders": 0, "doa": 0, "changes": 0}

    async def all_orders(**_filters):
        calls["orders"] += 1
        return [shipment("1", 20, "2026-09-01", customer="A")]

    async def all_rows(view_id, **_filters):
        calls["doa" if view_id == "SCS_DOA" else "changes"] += 1
        return [doa("one", "1", "是", 2)] if view_id == "SCS_DOA" else []

    monkeypatch.setattr(doa_service, "_DOA_ORDERS_CACHE", doa_service.AsyncTTLCache())
    monkeypatch.setattr(doa_service, "_DOA_SNAPSHOT_CACHE", doa_service.AsyncTTLCache())
    monkeypatch.setattr(doa_service.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", all_rows)

    filters = DoaFilters()
    await doa_service._build_doa_dashboard(filters)
    await doa_service.get_doa_repairs(filters, 1, 50)

    assert calls == {"orders": 1, "doa": 1, "changes": 1}


async def test_dashboard_uses_matched_order_quantities_once_per_period(monkeypatch):
    async def all_orders(**_filters):
        return [
            {"salesOrder": "0001", "orderQuantity": 60, "productionModel": "M1", "finalUser": "A"},
            {"salesOrder": "0001", "orderQuantity": 40, "productionModel": "M1", "finalUser": "A"},
            {"salesOrder": "9999", "orderQuantity": 500, "productionModel": "M2"},
        ]

    async def all_rows(view_id, **_filters):
        if view_id != "SCS_DOA":
            return []
        first = doa("one", "1", "是", 2)
        second = doa("two", "0001", "是", 3)
        third = doa("three", "1", "是", 1)
        third["accepted_at"] = "2026-10-02"
        return [first, second, third, doa("missing", "404", "是", 7)]

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", all_rows)

    result = await doa_service._build_doa_dashboard(DoaFilters(timeGranularity="month"))
    assert result.summary.shippedCount == 100
    assert result.summary.repairCount == 6
    assert result.summary.repairRate == 6
    assert result.summary.excludedRepairRecords == 1
    assert [(row.period, row.shippedCount, row.repairCount) for row in result.trend] == [
        ("2026-09", 100, 5),
        ("2026-10", 100, 1),
    ]
    assert result.unmatchedOrders[0].salesOrder == "404"


async def test_audit_includes_unmatched_scs_and_matched_original_orders(monkeypatch):
    async def all_orders(**_filters):
        return [{"id": "order-1", "salesOrder": "1", "orderQuantity": 20, "aufnr": "P1"}]

    async def all_rows(view_id, **_filters):
        if view_id == "SCS_DOA":
            return [doa("matched", "1", "是", 2), doa("missing", "404", "是", 3)]
        return [{"service_order": "matched", "change_type": "换上", "is_revoked": False,
                 "raw": {"service_order": "matched", "change_type": "换上"}}]

    async def export_rows(_resource, _keys, **_kwargs):
        return [{"_id": "order-1", "data": {"SAP_FIELD": "original"}}]

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(doa_service.data_gateway, "export_rows", export_rows)
    monkeypatch.setattr(doa_service.scs_gateway, "all", all_rows)

    result = await doa_service.get_doa_audit(DoaFilters(dateFrom="2026-09-01"))
    assert [row["matchStatus"] for row in result["repairs"]] == ["已匹配", "未匹配"]
    assert result["orders"][0]["aufnr"] == "P1"
    assert result["orders"][0]["orderQuantity"] == 20
    assert result["repairs"][0]["raw"] == {}
    assert result["orders"][0]["sourceFields"]["data"]["SAP_FIELD"] == "original"
    assert result["changes"][0]["change_type"] == "换上"


async def test_drilldown_intersects_date_ranges_and_does_not_mark_filtered_orders_unmatched(monkeypatch):
    seen = {}

    async def all_orders(**_filters):
        return [
            {"salesOrder": "1", "orderQuantity": 20, "finalUser": "A"},
            {"salesOrder": "2", "orderQuantity": 30, "finalUser": "B"},
        ]

    async def all_rows(view_id, **filters):
        if view_id == "SCS_DOA":
            seen.update(filters)
            return [doa("one", "1", "是", 1), doa("two", "2", "是", 2), doa("missing", "3", "是", 3)]
        return []

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", all_rows)
    result = await doa_service._build_doa_dashboard(DoaFilters(
        dateFrom="2026-09-10", dateTo="2026-10-15", acceptedDateFrom="2026-09-01",
        acceptedDateTo="2026-09-30", customer="A",
    ))
    assert seen["acceptedDateFrom"] == "2026-09-10"
    assert seen["acceptedDateTo"] == "2026-09-30"
    assert result.summary.shippedCount == 20
    assert result.summary.matchedRepairRecords == 1
    assert result.summary.excludedRepairRecords == 1
    assert [row.salesOrder for row in result.unmatchedOrders] == ["3"]


async def test_dashboard_uses_scs_scope_and_judgment_yes(monkeypatch):
    order_filters = {}

    async def all_orders(**_filters):
        order_filters.update(_filters)
        return [
            shipment("0001", 100, "2026-09-01"),
            shipment("0002", 80, "2026-09-01", company_5000=False),
        ]

    async def all_rows(view_id, **_filters):
        if view_id == "SCS_DOA":
            assert _filters["company5000"] == "true"
            assert _filters["judgment"] == "是"
            return [
                doa("yes", "0001", "是", 2),
                doa("no", "0001", "否", 3),
                doa("outside", "0002", "是", 5),
            ]
        return []

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", all_rows)

    result = await doa_service.build_doa_dashboard(DoaFilters())

    assert result.summary.shippedCount == 180
    assert result.summary.repairCount == 7
    assert result.summary.repairRate == 3.89
    assert result.summary.matchedRepairRecords == 2
    assert order_filters == {}


async def test_dashboard_accepts_order_quantity_without_actual_shipment_fields(monkeypatch):
    async def all_orders(**_filters):
        return [{"salesOrder": "0001", "orderQuantity": 100, "plannedStartDate": "2026-09-01"}]

    async def no_rows(*_args, **_kwargs):
        return []

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", no_rows)

    result = await doa_service._build_doa_dashboard(DoaFilters())
    assert result.summary.shippedCount == 0
    assert result.summary.repairRate is None


async def test_empty_shipment_results_keep_unmatched_scs_records_visible(monkeypatch):
    async def all_orders(**_filters):
        return []

    async def orders(**_kwargs):
        return {"items": [{"salesOrder": "XNC1", "orderQuantity": 100}], "total": 1}

    async def all_rows(view_id, **_filters):
        return [doa("scs", "XNC1", "是", 2)] if view_id == "SCS_DOA" else []

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(doa_service.data_gateway, "orders", orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", all_rows)

    result = await doa_service._build_doa_dashboard(DoaFilters(dateFrom="2026-01-01"))
    assert result.summary.excludedRepairRecords == 1
    assert result.summary.repairRate is None
    assert result.summary.repairCount == 0


def test_sales_order_scope_does_not_depend_on_last_duplicate_order_row():
    scopes = doa_service._sales_order_scopes(
        [
            doa_service._gateway_order(shipment("0001", 20, "2026-09-01", model="M1")),
            doa_service._gateway_order(shipment("0001", 30, "2026-09-02", model="M2")),
        ]
    )

    assert scopes["1"]["shipped_count"] == 50
    assert scopes["1"]["model"] == ""
    assert scopes["1"]["shipped_date"] == ""
