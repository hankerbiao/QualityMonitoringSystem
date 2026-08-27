from app.models.documents import Collections
from app.services import weekly_alert


class FakeCursor:
    def __init__(self, rows: list[dict]):
        self.rows = rows

    async def to_list(self, length: int) -> list[dict]:
        return self.rows[:length]


class FakeCollection:
    def __init__(self, rows: list[dict] | None = None, targets: dict | None = None):
        self.rows = rows or []
        self.targets = targets or {}

    async def find_one(self, query: dict) -> dict:
        return {"targets": self.targets}

    def aggregate(self, pipeline: list[dict]) -> FakeCursor:
        if self.rows and "product_family" in pipeline[0].get("$match", {}):
            return FakeCursor(self.rows)

        sns = pipeline[0]["$match"]["sn"]["$in"]
        return FakeCursor([{"c": 1}] if "A-1" in sns else [])


class FakeDatabase:
    def __init__(self):
        self.collections = {
            Collections.CONFIGS: FakeCollection(targets={"Model A": 90, "Model B": 100}),
            Collections.MACHINE_INFO: FakeCollection(
                rows=[
                    {"_id": "Model A", "sns": ["A-1", "A-2", "A-3"]},
                    {"_id": "Model B", "sns": ["B-1", "B-2"]},
                ]
            ),
            Collections.FAULT_INFO: FakeCollection(),
        }

    def __getitem__(self, key: str) -> FakeCollection:
        return self.collections[key]


async def test_get_weekly_production_candidates_returns_only_below_target_models(monkeypatch):
    monkeypatch.setattr(weekly_alert, "get_database", lambda: FakeDatabase())

    result = await weekly_alert.get_weekly_production_candidates(threshold=2)

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
