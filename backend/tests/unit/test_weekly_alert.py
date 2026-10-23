from app.models.documents import Collections
from app.services import weekly_alert


class FakeCollection:
    async def find_one(self, query: dict) -> dict:
        assert query == {"key": "model_targets"}
        return {"targets": {"Model A": 90, "Model B": 100}}


class FakeDatabase:
    def __getitem__(self, key: str) -> FakeCollection:
        assert key == Collections.CONFIGS
        return FakeCollection()


async def test_get_weekly_production_candidates_uses_gateway_orders_and_faults(monkeypatch):
    monkeypatch.setattr(weekly_alert, "get_database", lambda: FakeDatabase())
    monkeypatch.setattr(
        weekly_alert,
        "compute_last_friday_window",
        lambda: ("2026-06-05 00:00:00", "2026-06-08 17:00:00"),
    )
    orders = [
        {"aufnr": "0001", "data": {"MAKTX_TH": "Model A", "WMENG": 1}},
        {"aufnr": "0002", "data": {"MAKTX_TH": "Model A", "WMENG": 2}},
        {"aufnr": "0003", "data": {"MAKTX_TH": "Model B", "WMENG": 2}},
        {"aufnr": "0004", "data": {"MAKTX_TH": "", "WMENG": 100}},
    ]
    received_filters = {}

    async def load_orders(filters):
        received_filters.update(filters)
        return orders

    async def load_faults(order_numbers, *, model=None):
        if model == "Model A":
            return {"1": {"SN-1"}}
        return {}

    monkeypatch.setattr(weekly_alert, "_orders", load_orders)
    monkeypatch.setattr(weekly_alert, "_fault_sns_by_orders", load_faults)

    result = await weekly_alert.get_weekly_production_candidates(threshold=2)

    assert received_filters == {"dateFrom": "2026-06-05", "dateTo": "2026-06-08"}
    assert result["threshold"] == 2
    assert result["modelsChecked"] == 2
    assert result["details"] == [
        {
            "productModel": "Model A",
            "inputCount": 3,
            "defectCount": 1,
            "rtyRate": 66.67,
            "targetRate": 90.0,
        }
    ]
