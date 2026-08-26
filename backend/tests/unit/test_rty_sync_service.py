from datetime import date

from app.services.rty_sync_service import RtySyncService
from app.services.sap_sales_order_service import SourceFetchResult
from app.services.sap_sn_info_service import SnInfoSourceFetchResult
from tests.mock_motor import MockMotorClient


class FakeSalesService:
    def __init__(self, results):
        self.results = results
        self.calls = []

    async def fetch_source(self, source, start_date, end_date, prodh_list):
        self.calls.append((source, start_date, end_date, prodh_list))
        result = self.results[source]
        return result if isinstance(result, SourceFetchResult) else SourceFetchResult(source, False, result)


class FakeSnService:
    async def fetch_all(self, sns):
        return {
            "SG": SnInfoSourceFetchResult("SG", records=[{"PCODE": sn, "AUFNR": "123"} for sn in sns]),
            "KK": SnInfoSourceFetchResult("KK", records=[]),
        }


async def test_bootstrap_requires_both_sources_before_checkpoints():
    db = MockMotorClient()["quality"]
    sales = FakeSalesService({
        "SG": SourceFetchResult("SG", records=[{"AUFNR": "1"}]),
        "KK": "KK unavailable",
    })
    service = RtySyncService(db, sales_service=sales)

    result = await service.run(mode="bootstrap", start_date=date(2026, 1, 1), end_date=date(2026, 1, 2), only="sales")

    assert result["success"] is False
    assert await db.rty_sync_checkpoints.count_documents({}) == 0
    assert await db.sales_orders_sap.count_documents({}) == 1


async def test_incremental_uses_independent_seven_day_watermarks():
    db = MockMotorClient()["quality"]
    await db.rty_sync_checkpoints.insert_many([
        {"_id": "sales_orders:SG", "last_success_date": "2026-08-20"},
        {"_id": "sales_orders:KK", "last_success_date": "2026-08-23"},
    ])
    sales = FakeSalesService({
        "SG": SourceFetchResult("SG", records=[]),
        "KK": SourceFetchResult("KK", records=[]),
    })
    service = RtySyncService(db, sales_service=sales)

    result = await service.run(mode="run", end_date=date(2026, 8, 26), only="sales")

    assert result["success"] is True
    assert sales.calls[0][1] == date(2026, 8, 13)
    assert sales.calls[1][1] == date(2026, 8, 16)
    assert all(call[2] == date(2026, 8, 26) for call in sales.calls)


async def test_repair_uses_local_order_and_customer_without_sap_call():
    db = MockMotorClient()["quality"]
    await db.repair_records_sap.insert_one({"_id": "r1", "PCODE": "SN1", "AUFNR": "", "VBELN": "", "customer": ""})
    await db.station_records_sap.insert_one({"PCODE": "SN1", "AUFNR": "123"})
    await db.sales_orders_sap.insert_one({"aufnr": "000000000123", "data": {"VBELN": "00077", "NAME1_ZU": "客户A"}})
    service = RtySyncService(db, sn_service=FakeSnService())

    result = await service.run(mode="run", only="repair")
    row = await db.repair_records_sap.find_one({"_id": "r1"})

    assert result["success"] is True
    assert result["stages"]["repair"]["api_calls"] == 0
    assert row["AUFNR"] == "000000000123"
    assert row["VBELN"] == "77"
    assert row["customer"] == "客户A"
    assert row["rty_backfill"]["AUFNR"]["source"] == "station"
