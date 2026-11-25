"""Adapt test shipment records to the KK batch transport."""

import pytest

from app.services import doa_service


@pytest.fixture(autouse=True)
def mock_kk_batches(monkeypatch):
    async def shipments(*, date_from, date_to):
        orders = await doa_service._doa_gateway_orders()
        return [
            {
                "salesOrder": row["sales_order"],
                "customerId": row["customer_id"],
                "shipmentDate": raw["shipmentDate"],
                "quantity": raw["shipmentQuantity"],
                "deliveryNumber": f"delivery-{index}",
                "deliveryItem": "10",
                "model": row["model"],
            }
            for index, row in enumerate(orders)
            if (raw := row["raw"]).get("shipmentDate")
            and date_from <= raw["shipmentDate"] <= date_to
            and raw.get("shipmentQuantity", 0) > 0
        ]

    monkeypatch.setattr(doa_service.data_gateway, "kk_shipment_batches", shipments)
