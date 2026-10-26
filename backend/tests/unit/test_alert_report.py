from app.models.documents import Collections
from app.schemas.alert_report import AlertContext
from app.schemas.rty import DefectDetail
from app.services import alert_report


class FakeCollection:
    async def find_one(self, query: dict) -> dict:
        assert query == {"key": "model_targets"}
        return {"targets": {"Model A": 90}}


class FakeDatabase:
    def __getitem__(self, key: str) -> FakeCollection:
        assert key == Collections.CONFIGS
        return FakeCollection()


async def test_build_alert_report_uses_gateway_orders_faults_and_details(monkeypatch):
    monkeypatch.setattr(alert_report, "get_database", lambda: FakeDatabase())

    received_filters = {}

    async def load_orders(filters):
        received_filters.update(filters)
        return [
            {"aufnr": "0001", "data": {"MAKTX_TH": "Model A", "WMENG": 2}},
            {"aufnr": "0002", "data": {"MAKTX_TH": "Model A", "WMENG": 1}},
        ]

    async def load_faults(order_numbers, *, model=None):
        assert model == "Model A"
        return {"1": {"SN-1"}}

    async def load_details(order_numbers, model=None):
        assert order_numbers == {"0001", "0002"}
        return [
            DefectDetail(
                id="fault-1",
                defectCode="E01",
                description="故障",
                count=1,
                sn="SN-1",
            )
        ]

    monkeypatch.setattr(alert_report, "_orders", load_orders)
    monkeypatch.setattr(alert_report, "_fault_sns_by_orders", load_faults)
    monkeypatch.setattr(alert_report, "details_by_orders", load_details)

    report = await alert_report.build_alert_report(
        AlertContext(
            productModel="Model A",
            base="Base 1",
            dateFrom="2026-06-05 00:00:00",
            dateTo="2026-06-08 17:00:00",
        )
    )

    assert received_filters == {
        "base": "Base 1",
        "productModel": "Model A",
        "dateFrom": "2026-06-05",
        "dateTo": "2026-06-08",
        "orderScope": "normal",
    }
    assert report.summary.inputCount == 3
    assert report.summary.defectCount == 1
    assert report.summary.rtyRate == 66.67
    assert [item.sn for item in report.defects] == ["SN-1"]

    current_rule_report = await alert_report.build_alert_report(
        AlertContext(productModel="Model A"),
        targets_override={"Model A": 80},
    )
    assert current_rule_report.summary.targetRate == 80
