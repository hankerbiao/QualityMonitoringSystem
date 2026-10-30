from datetime import date

from app.services.mfr_devices import select_devices


def order(number, planned="2026-10-01", model="M1", customer_id="C1"):
    return {
        "aufnr": number,
        "plannedStartDate": planned,
        "productionModel": model,
        "salesOrder": "SO1",
        "customerId": customer_id,
    }


def device(key, number, **overrides):
    row = {
        "deviceKey": key,
        "identityBasis": "product_barcode",
        "productionOrder": {"status": "valid", "value": number},
        "factoryDate": {"status": "valid"},
        "warrantyEndDate": {"status": "valid"},
        "evidence": [{"company5000": True, "doaCode": "D1", "shipmentDate": "2026-10-01"}],
    }
    row.update(overrides)
    return row


def test_selects_by_shipment_date_not_plan_and_excludes_conflicting_shipments():
    def evidence(code, shipment):
        return {"doaCode": code, "shipmentDate": shipment}

    good = device("product:a", "123", evidence=[evidence("D1", "2026-10-15")])
    outside = device("product:b", "123", evidence=[evidence("D1", "2026-09-30")])
    conflict = device("product:c", "123", evidence=[evidence("D1", "2026-10-15"), evidence("D2", "2026-10-16")])
    missing = device("product:d", "123", evidence=[evidence("D1", "")])
    selected, issues = select_devices(
        [good, outside, conflict, missing], [order("123", "2026-01-01")],
        date(2026, 10, 1), date(2026, 10, 31),
        {"D1": {"SO1"}, "D2": {"SO1"}}, {"D1", "D2"}, set(),
    )
    assert [(item["deviceKey"], item["shipmentDate"]) for item in selected] == [("product:a", date(2026, 10, 15))]
    assert issues == {"shipmentDateConflict": 1, "shipmentDateUnresolved": 1}


def test_shipment_filter_does_not_require_an_order_plan_date():
    item = device("product:a", "123", evidence=[{"doaCode": "D1", "shipmentDate": "2026-10-15"}])
    selected, issues = select_devices([item], [order("123", "")], date(2026, 10, 1),
        date(2026, 10, 31), {"D1": {"SO1"}}, {"D1"}, set())
    assert [row["deviceKey"] for row in selected] == ["product:a"]
    assert not issues


def test_customer_id_filter_uses_the_unique_order_match():
    item = device("product:a", "123")
    selected, issues = select_devices(
        [item], [order("123", customer_id="C1")], date(2026, 10, 1), date(2026, 10, 31),
        {"D1": {"SO1"}}, {"D1"}, set(), customer_ids={"C1"},
    )
    assert selected[0]["customerId"] == "C1"
    assert not issues

    selected, issues = select_devices(
        [item], [order("123", customer_id="C2")], date(2026, 10, 1), date(2026, 10, 31),
        {"D1": {"SO1"}}, {"D1"}, set(), customer_ids={"C1"},
    )
    assert selected == []
    assert not issues


def test_selects_distinct_devices_by_production_order_plan_and_model():
    selected, issues = select_devices(
        [
            device("product:a", "000010349985"),
            device("product:b", "10349986", evidence=[{"doaCode": "D1", "shipmentDate": "2026-09-01"}]),
            device("product:c", "10349987", warrantyEndDate={"status": "conflict"}),
        ],
        [order("10349985"), order("10349986", "2026-09-01"), order("10349987")],
        date(2026, 10, 1),
        date(2026, 10, 31),
        {"D1": {"SO1"}},
        {"D1"},
        set(),
        "M1",
    )
    assert [item["deviceKey"] for item in selected] == ["product:a", "product:c"]
    assert issues["lifecycleDateIncomplete"] == 1  # Lifecycle does not exclude a device.


def test_does_not_guess_on_missing_orders_conflicts_or_unidentified_items():
    selected, issues = select_devices(
        [
            device("product:a", "123"),
            device("product:b", "456"),
            device("material:c", "789", identityBasis="material_sn"),
            device("product:d", "000", productionOrder={"status": "conflict"}),
        ],
        [order("123"), order("123", "2026-10-02", "OTHER"), order("789")],
        date(2026, 10, 1),
        date(2026, 10, 31),
        {"D1": {"SO1"}},
        {"D1"},
        set(),
    )
    assert selected == []
    assert issues == {
        "planOrModelConflict": 1,
        "planDateUnresolved": 1,
        "identityUnverified": 1,
        "productionOrderUnresolved": 1,
    }


def test_does_not_double_count_cross_identity_evidence():
    one = device(
        "product:a", "123", evidence=[{"company5000": True, "contextId": "C1", "doaCode": "D1", "shipmentDate": "2026-10-01"}]
    )
    two = device(
        "context:C1",
        "123",
        identityBasis="product_context",
        evidence=[{"company5000": True, "contextId": "C1", "doaCode": "D1", "shipmentDate": "2026-10-01"}],
    )
    selected, issues = select_devices(
        [one, two],
        [order("123")],
        date(2026, 10, 1),
        date(2026, 10, 31),
        {"D1": {"SO1"}},
        {"D1"},
        set(),
    )
    assert selected == []
    assert issues == {"identityConflict": 2}


def test_only_selects_devices_with_confirmed_valid_doa_and_reports_unknown_codes():
    def with_code(key, code):
        return device(key, "123", evidence=[{"company5000": True, "doaCode": code, "shipmentDate": "2026-10-01"}])

    selected, issues = select_devices(
        [
            with_code("product:a", "yes"),
            with_code("product:b", "no"),
            with_code("product:c", "missing"),
        ],
        [order("123")],
        date(2026, 10, 1),
        date(2026, 10, 31),
        {"yes": {"SO1"}, "no": {"SO1"}},
        {"yes"},
        set(),
    )
    assert [item["deviceKey"] for item in selected] == ["product:a"]
    assert issues == {"doaStatusUnresolved": 1}


def test_uses_sales_order_membership_not_product_line_or_stale_company_flag():
    first = device("product:a", "123", evidence=[{"company5000": False, "doaCode": "yes", "shipmentDate": "2026-10-01"}])
    outside = device("product:b", "123", evidence=[{"company5000": True, "doaCode": "outside", "shipmentDate": "2026-10-01"}])
    mismatch = device(
        "product:c",
        "123",
        salesOrder={"status": "valid", "value": "SO2"},
        evidence=[{"doaCode": "yes"}],
    )
    selected, issues = select_devices(
        [first, outside, mismatch],
        [order("123")],
        date(2026, 10, 1),
        date(2026, 10, 31),
        {"yes": {"SO1"}, "outside": {"SO9"}},
        {"yes", "outside"},
        set(),
    )
    assert [item["deviceKey"] for item in selected] == ["product:a"]
    assert issues == {"salesOrderMismatch": 1}
