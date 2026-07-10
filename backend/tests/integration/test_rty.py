"""
Integration tests for RTY API endpoints

Each test that needs data inserts it directly in the test body,
using the same mock_db and client fixtures to ensure isolation.
"""
from datetime import datetime, timezone

import pytest


def make_rty_doc(time, product_model, customer, base, defect, inp, rty, target, model="普通机型", status="已达成", sales="SO"):
    now = datetime.now(tz=timezone.utc)
    return {
        "time": time, "model": model, "productModel": product_model,
        "customer": customer, "base": base, "defectCount": defect,
        "inputCount": inp, "rtyRate": rty, "targetRate": target,
        "salesOrder": sales, "productionOrder": "PO", "productLine": "Line",
        "orderType": "普通", "planStartDate": time, "planEndDate": time,
        "status": status, "createdAt": now, "updatedAt": now,
    }


@pytest.mark.integration
class TestRTYList:
    """Tests for GET /api/rty/list"""

    async def test_empty_database_returns_empty_list(self, client, db_clean):
        """Empty DB should return [] with success=True."""
        response = await client.get("/api/rty/list")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"] == []

    async def test_returns_inserted_data(self, client, db_clean):
        """Inserted RTY records should be returned."""
        docs = [
            make_rty_doc("2026-06-01", "6210 C21", "客户A", "天津", 10, 1000, 99.0, 99.0),
            make_rty_doc("2026-06-02", "6210 C21", "客户A", "昆山", 15, 1000, 98.5, 99.0),
            make_rty_doc("2026-06-03", "6410 X21", "客户B", "天津", 5, 500, 99.0, 98.5),
        ]
        await db_clean.rty_data.insert_many(docs)

        response = await client.get("/api/rty/list")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["data"]) == 3

    async def test_pagination_limit(self, client, db_clean):
        """?limit=2 should return only 2 records."""
        docs = [
            make_rty_doc("2026-06-01", "6210 C21", "客户A", "天津", 10, 1000, 99.0, 99.0),
            make_rty_doc("2026-06-02", "6210 C21", "客户A", "昆山", 15, 1000, 98.5, 99.0),
            make_rty_doc("2026-06-03", "6410 X21", "客户B", "天津", 5, 500, 99.0, 98.5),
        ]
        await db_clean.rty_data.insert_many(docs)

        response = await client.get("/api/rty/list?limit=2")
        assert response.status_code == 200
        assert len(response.json()["data"]) == 2

    async def test_pagination_page(self, client, db_clean):
        """page=2 with limit=2 should return the 3rd record."""
        docs = [
            make_rty_doc("2026-06-01", "6210 C21", "客户A", "天津", 10, 1000, 99.0, 99.0),
            make_rty_doc("2026-06-02", "6210 C21", "客户A", "昆山", 15, 1000, 98.5, 99.0),
            make_rty_doc("2026-06-03", "6410 X21", "客户B", "天津", 5, 500, 99.0, 98.5),
        ]
        await db_clean.rty_data.insert_many(docs)

        response = await client.get("/api/rty/list?page=2&limit=2")
        assert response.status_code == 200
        assert len(response.json()["data"]) == 1

    async def test_filter_by_base(self, client, db_clean):
        """?base=天津 should only return Tianjin records."""
        docs = [
            make_rty_doc("2026-06-01", "6210 C21", "客户A", "天津", 10, 1000, 99.0, 99.0),
            make_rty_doc("2026-06-02", "6210 C21", "客户A", "昆山", 15, 1000, 98.5, 99.0),
        ]
        await db_clean.rty_data.insert_many(docs)

        response = await client.get("/api/rty/list?base=天津")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 1
        assert data["data"][0]["base"] == "天津"

    async def test_filter_by_product_model(self, client, db_clean):
        """?productModel=6210 C21 should only return that model's records."""
        docs = [
            make_rty_doc("2026-06-01", "6210 C21", "客户A", "天津", 10, 1000, 99.0, 99.0),
            make_rty_doc("2026-06-02", "6210 C21", "客户A", "昆山", 15, 1000, 98.5, 99.0),
            make_rty_doc("2026-06-03", "6410 X21", "客户B", "天津", 5, 500, 99.0, 98.5),
        ]
        await db_clean.rty_data.insert_many(docs)

        response = await client.get("/api/rty/list?productModel=6210 C21")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 2

    async def test_filter_by_date_range(self, client, db_clean):
        """Date range filter should work."""
        docs = [
            make_rty_doc("2026-06-01", "6210 C21", "客户A", "天津", 10, 1000, 99.0, 99.0),
            make_rty_doc("2026-06-02", "6210 C21", "客户A", "昆山", 15, 1000, 98.5, 99.0),
            make_rty_doc("2026-06-03", "6410 X21", "客户B", "天津", 5, 500, 99.0, 98.5),
        ]
        await db_clean.rty_data.insert_many(docs)

        response = await client.get("/api/rty/list?date_from=2026-06-01&date_to=2026-06-02")
        assert response.status_code == 200
        assert len(response.json()["data"]) == 2

    async def test_filter_by_date_from_only(self, client, db_clean):
        """date_from without date_to should return from that date onward."""
        docs = [
            make_rty_doc("2026-06-01", "6210 C21", "客户A", "天津", 10, 1000, 99.0, 99.0),
            make_rty_doc("2026-06-03", "6410 X21", "客户B", "天津", 5, 500, 99.0, 98.5),
        ]
        await db_clean.rty_data.insert_many(docs)

        response = await client.get("/api/rty/list?date_from=2026-06-03")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 1
        assert data["data"][0]["time"] == "2026-06-03"

    async def test_filter_by_date_to_only(self, client, db_clean):
        """date_to without date_from should return up to that date."""
        docs = [
            make_rty_doc("2026-06-01", "6210 C21", "客户A", "天津", 10, 1000, 99.0, 99.0),
            make_rty_doc("2026-06-02", "6210 C21", "客户A", "昆山", 15, 1000, 98.5, 99.0),
            make_rty_doc("2026-06-03", "6410 X21", "客户B", "天津", 5, 500, 99.0, 98.5),
        ]
        await db_clean.rty_data.insert_many(docs)

        response = await client.get("/api/rty/list?date_to=2026-06-02")
        assert response.status_code == 200
        assert len(response.json()["data"]) == 2

    async def test_filter_all(self, client, db_clean):
        """Multiple filters combined."""
        docs = [
            make_rty_doc("2026-06-01", "6210 C21", "客户A", "天津", 10, 1000, 99.0, 99.0),
            make_rty_doc("2026-06-02", "6210 C21", "客户A", "昆山", 15, 1000, 98.5, 99.0),
            make_rty_doc("2026-06-03", "6410 X21", "客户B", "天津", 5, 500, 99.0, 98.5),
        ]
        await db_clean.rty_data.insert_many(docs)

        response = await client.get("/api/rty/list?base=天津&productModel=6210 C21")
        assert response.status_code == 200
        assert len(response.json()["data"]) == 1

    async def test_filter_customer_case_insensitive(self, client, db_clean):
        """Customer filter should be case-insensitive via regex."""
        docs = [
            make_rty_doc("2026-06-01", "6210 C21", "客户A", "天津", 10, 1000, 99.0, 99.0),
            make_rty_doc("2026-06-02", "6210 C21", "客户A", "昆山", 15, 1000, 98.5, 99.0),
        ]
        await db_clean.rty_data.insert_many(docs)

        response = await client.get("/api/rty/list?customer=客户a")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 2

    async def test_response_fields(self, client, db_clean):
        """Response should contain all expected RTY fields."""
        docs = [make_rty_doc("2026-06-01", "6210 C21", "客户A", "天津", 10, 1000, 99.0, 99.0)]
        await db_clean.rty_data.insert_many(docs)

        response = await client.get("/api/rty/list?limit=1")
        data = response.json()["data"][0]
        for field in ("id", "time", "productModel", "base", "defectCount", "inputCount", "rtyRate", "targetRate"):
            assert field in data
