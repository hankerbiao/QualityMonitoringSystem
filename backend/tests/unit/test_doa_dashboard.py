import pytest

from app.schemas.doa import DoaFilters
from app.services import doa_service
from app.services.data_gateway_client import DataGatewayError


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


async def test_dashboard_uses_only_5000_actual_shipments_and_judgment_yes(monkeypatch):
    async def all_orders(**_filters):
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

    assert result.summary.shippedCount == 100
    assert result.summary.repairCount == 2
    assert result.summary.repairRate == 2
    assert result.summary.matchedRepairRecords == 1


async def test_dashboard_rejects_orders_without_actual_shipment_contract(monkeypatch):
    async def all_orders(**_filters):
        return [{"salesOrder": "0001", "orderQuantity": 100, "plannedStartDate": "2026-09-01"}]

    async def no_rows(*_args, **_kwargs):
        return []

    monkeypatch.setattr(doa_service.data_gateway, "all_orders", all_orders)
    monkeypatch.setattr(doa_service.scs_gateway, "all", no_rows)

    with pytest.raises(DataGatewayError, match="shipmentDate.*shipmentQuantity.*is5000Company"):
        await doa_service.build_doa_dashboard(DoaFilters())


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
