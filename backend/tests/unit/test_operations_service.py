import pytest

from app.services import operations_service


@pytest.mark.asyncio
async def test_gateway_data_status_uses_gateway_data_source_keys(monkeypatch):
    monkeypatch.setattr(operations_service.data_gateway, "base_url", "http://gateway.test")

    async def data_status():
        return {
            "salesOrdersLastSyncedAt": "orders",
            "faultsLastSyncedAt": "faults",
            "stationRecordsLastSyncedAt": "stations",
            "serialBindingsLastSyncedAt": "bindings",
            "bomPostingsLastSyncedAt": "bom",
            "scsDoaLastSyncedAt": "scs-doa",
            "scsChangeLastSyncedAt": "scs-change",
        }

    monkeypatch.setattr(operations_service.data_gateway, "data_status", data_status)
    rows = await operations_service._sync_data_sources(object())

    by_key = {row["key"]: row for row in rows}
    assert by_key["hana-bom"]["lastSyncedAt"] == "bom"
    assert by_key["scs-doa"]["lastSyncedAt"] == "scs-doa"
    assert by_key["scs-change"]["lastSyncedAt"] == "scs-change"
    assert all(row["collection"] == "" for row in rows)
