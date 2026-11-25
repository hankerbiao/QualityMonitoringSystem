from datetime import date

from app.services.mfr_devices import select_devices


def device(key, **fields):
    return {
        "deviceKey": key,
        "identityBasis": "product_barcode",
        "factoryDate": {"status": "valid"},
        "warrantyEndDate": {"status": "valid"},
        "evidence": [{"doaCode": "D1", "doaSalesOrder": "XNC1", **fields}],
    }


def test_uses_scs_order_prefix_without_production_order_or_matching_device_order():
    first = device(
        "product:a", company5000=False, salesOrder="SO1", model="M1", shipmentDate="2026-10-01"
    )
    first["salesOrder"] = {"status": "conflict"}
    second = device("product:b", doaSalesOrder="", salesOrder=" XNC2 ")
    other = device("product:c", doaSalesOrder="SO2", company5000=True)
    selected, issues = select_devices([first, second, other], {"D1"}, set())
    assert [item["deviceKey"] for item in selected] == ["product:a", "product:b"]
    assert selected[0]["shipmentDate"] == date(2026, 10, 1)
    assert selected[0]["orderModel"] == "M1"
    assert not issues


def test_only_counts_valid_doa_and_reports_unresolved_status():
    selected, issues = select_devices(
        [
            device("product:a"),
            device("product:b", doaCode="no"),
            device("product:c", doaCode="missing"),
        ],
        {"D1"},
        {"missing"},
    )
    assert [item["deviceKey"] for item in selected] == ["product:a"]
    assert issues == {"doaStatusUnresolved": 1}


def test_does_not_double_count_cross_identity_evidence():
    one = device("product:a", contextId="C1")
    two = device("context:C1", contextId="C1")
    two["identityBasis"] = "product_context"
    third = device("material:c")
    third["identityBasis"] = "material_sn"
    selected, issues = select_devices([one, two, third], {"D1"}, set())
    assert not selected
    assert issues == {"identityConflict": 2, "identityUnverified": 1}
