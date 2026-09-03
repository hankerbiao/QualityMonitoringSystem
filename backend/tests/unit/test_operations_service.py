import pytest

from app.services import operations_service


@pytest.mark.asyncio
async def test_gateway_sync_status_uses_bom_timestamp_key(monkeypatch):
    monkeypatch.setattr(operations_service.data_gateway, "base_url", "http://gateway.test")

    async def data_status():
        return {
            "salesOrdersLastSyncedAt": "orders",
            "faultsLastSyncedAt": "faults",
            "stationRecordsLastSyncedAt": "stations",
            "serialBindingsLastSyncedAt": "bindings",
            "bomPostingsLastSyncedAt": "bom",
        }

    monkeypatch.setattr(operations_service.data_gateway, "data_status", data_status)
    rows = await operations_service._sync_data_sources(object())

    by_collection = {row["collection"]: row["lastSyncedAt"] for row in rows}
    assert by_collection["order_bom_postings_sap"] == "bom"
