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

    current_targets = await weekly_alert.get_weekly_production_candidates(
        threshold=2,
        targets={"Model A": 60, "Model B": 100},
    )
    assert current_targets["modelsChecked"] == 2
    assert current_targets["details"] == []


async def test_manual_check_uses_current_config_for_candidates_and_mail(monkeypatch):
    calls = {}
    candidates = {
        "window": {"from": "2026-10-23 00:00:00", "to": "2026-10-26 17:00:00"},
        "threshold": 12,
        "modelsChecked": 1,
        "details": [
            {
                "productModel": "Model A",
                "inputCount": 12,
                "defectCount": 2,
                "rtyRate": 83.33,
                "targetRate": 90,
            }
        ],
    }

    async def load_candidates(threshold, *, targets=None):
        calls["candidate_config"] = {"threshold": threshold, "targets": targets}
        return candidates

    async def send_email(context, *, config_override=None):
        calls["mail_config"] = config_override
        calls["model"] = context.productModel
        return {"sent": True}

    monkeypatch.setattr(weekly_alert, "get_database", lambda: object())
    monkeypatch.setattr(weekly_alert, "get_weekly_production_candidates", load_candidates)
    monkeypatch.setattr(weekly_alert, "send_rty_alert_email", send_email)
    config = {
        "enabled": True,
        "emails": "current@example.com",
        "weeklyProductionThreshold": 12,
        "modelTargets": {"Model A": 90},
    }

    result = await weekly_alert.run_weekly_production_check(config)

    assert calls == {
        "candidate_config": {"threshold": 12, "targets": {"Model A": 90}},
        "mail_config": config,
        "model": "Model A",
    }
    assert result["alertsSent"] == 1
    assert result["alertsFailed"] == 0
