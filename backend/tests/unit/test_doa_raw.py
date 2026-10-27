from app.schemas.doa import DoaFilters, DoaRawFilters
from app.services import doa_service
from app.services.doa_service import _gateway_latest_accepted_at


def test_gateway_latest_accepted_at_uses_the_newest_valid_timestamp():
    latest = _gateway_latest_accepted_at(
        [
            {"accepted_at": "2026-09-08 18:47"},
            {"accepted_at": "invalid"},
            {"accepted_at": "2026-09-09 10:13:05"},
        ]
    )

    assert latest is not None
    assert latest.isoformat() == "2026-09-09T10:13:05"


async def test_gateway_doa_raw_filters_and_summarizes_rows(monkeypatch):
    calls = 0

    async def all_rows(view_id, **_filters):
        nonlocal calls
        calls += 1
        assert view_id == "SCS_DOA"
        return [
            {
                "id": "DOA-1",
                "service_order": "SVC-1",
                "sales_order": "SO-1",
                "host_sn": "SN-1",
                "part_sn": "",
                "customer": "客户A",
                "product": "服务器A",
                "doa_type": "开箱损坏",
                "judgment": "是",
                "status": "已关闭",
                "repair_count": "2",
                "accepted_at": "2026-09-10",
                "is_5000_company": True,
                "raw": {},
            },
            {
                "id": "DOA-2",
                "service_order": "SVC-2",
                "sales_order": "SO-2",
                "host_sn": "SN-2",
                "part_sn": "",
                "customer": "客户B",
                "product": "服务器B",
                "doa_type": "其他",
                "judgment": "否",
                "status": "处理中",
                "repair_count": "1",
                "accepted_at": "2026-09-11",
                "is_5000_company": True,
                "raw": {},
            },
        ]

    monkeypatch.setattr(doa_service.scs_gateway, "all", all_rows)
    result = await doa_service.get_doa_raw(
        1,
        50,
        DoaRawFilters(customer="客户A", acceptedDateFrom="2026-09-01", acceptedDateTo="2026-09-30"),
    )

    assert result["summary"]["total"] == 1
    assert result["summary"]["judgmentYes"] == 1
    assert result["items"][0]["data"]["服务单号"] == "SVC-1"

    second_page = await doa_service.get_doa_raw(
        2,
        1,
        DoaRawFilters(customer="客户A", acceptedDateFrom="2026-09-01", acceptedDateTo="2026-09-30"),
    )

    assert second_page["items"] == []
    assert calls == 1


async def test_gateway_doa_uses_linked_sales_order_when_product_name_differs(monkeypatch):
    async def all_orders(**_filters):
        return [
            {
                "salesOrder": "0001",
                "shipmentQuantity": 10,
                "shipmentDate": "2026-09-01",
                "is5000Company": True,
                "productionModel": "6210 C21",
            }
        ]

    async def all_rows(view_id, **_filters):
        if view_id == "SCS_DOA":
            return [
                {
                    "id": "DOA-1",
                    "service_order": "SVC-1",
                    "sales_order": "0001",
                    "product": "服务器整机描述",
                    "host_sn": "SN-1",
                    "part_sn": "",
                    "accepted_at": "2026-09-02",
                    "judgment": "是",
                    "repair_count": 1,
                    "raw": {},
                }
            ]
        return [{"service_order": "SVC-1"}]

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", all_rows)

    rows = await doa_service._doa_gateway_repairs(DoaFilters())

    assert len(rows) == 1
    assert rows[0]["model"] == "6210 C21"


async def test_doa_replacement_rate_counts_only_valid_replacement_defect_quantity(monkeypatch):
    async def all_orders(**_filters):
        return [
            {
                "salesOrder": "0001",
                "shipmentQuantity": 100,
                "orderQuantity": 100,
                "shipmentDate": "2026-09-01",
                "is5000Company": True,
                "finalUser": "客户A",
                "productionModel": "M1",
            }
        ]

    doa_rows = [
        {
            "id": "DOA-1",
            "service_order": "SVC-1",
            "sales_order": "0001",
            "host_sn": "SN-1",
            "part_sn": "",
            "accepted_at": "2026-09-02",
            "judgment": "是",
            "repair_count": 2,
            "raw": {},
        },
        {
            "id": "DOA-2",
            "service_order": "SVC-2",
            "sales_order": "0001",
            "host_sn": "SN-2",
            "part_sn": "",
            "accepted_at": "2026-09-02",
            "judgment": "是",
            "repair_count": 3,
            "raw": {},
        },
        {
            "id": "DOA-3",
            "service_order": "SVC-3",
            "sales_order": "0001",
            "host_sn": "SN-3",
            "part_sn": "",
            "accepted_at": "2026-09-02",
            "judgment": "是",
            "repair_count": 4,
            "raw": {},
        },
        {
            "id": "DOA-4",
            "service_order": "SVC-4",
            "sales_order": "0001",
            "host_sn": "SN-4",
            "part_sn": "",
            "accepted_at": "2026-09-02",
            "judgment": "否",
            "repair_count": 5,
            "raw": {},
        },
    ]

    async def all_rows(view_id, **_filters):
        if view_id == "SCS_DOA":
            return doa_rows
        return [
            {"service_order": "SVC-1", "change_type": "换上", "is_revoked": False},
            {"service_order": "SVC-2", "change_type": "换下", "is_revoked": False},
            {"service_order": "SVC-3", "change_type": "换上-up", "is_revoked": True},
            {"service_order": "SVC-4", "change_type": "换上", "is_revoked": False},
        ]

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", all_rows)

    dashboard = await doa_service.build_doa_dashboard(DoaFilters())
    replacement_repairs = await doa_service.get_doa_repairs(
        DoaFilters(), page=1, limit=50, replacement_only=True
    )

    assert dashboard.summary.shippedCount == 100
    assert dashboard.summary.repairCount == 9
    assert dashboard.summary.replacementCount == 2
    assert dashboard.summary.replacementRecordCount == 1
    assert dashboard.summary.replacementRate == 2
    assert dashboard.trend[0].replacementCount == 2
    assert dashboard.byCustomer[0].replacementCount == 2
    assert replacement_repairs.total == 1
    assert replacement_repairs.totalRepairCount == 2
    assert replacement_repairs.items[0].id == "DOA-1"
