"""
Integration tests for RTY API endpoints
"""
import pytest


@pytest.mark.integration
class TestRTYList:
    """Tests for GET /api/rty/list"""

    async def test_empty_database_returns_empty_list(self, client, mock_db):
        """Empty DB should return [] with success=True."""
        response = await client.get("/api/rty/list")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"] == []

    async def test_returns_inserted_data(self, rty_client):
        """Inserted RTY records should be returned."""
        response = await rty_client.get("/api/rty/list")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["data"]) == 3

    async def test_pagination_limit(self, rty_client):
        """?limit=2 should return only 2 records."""
        response = await rty_client.get("/api/rty/list?limit=2")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 2

    async def test_pagination_page(self, rty_client):
        """page=2 with limit=2 should return the 3rd record."""
        response = await rty_client.get("/api/rty/list?page=2&limit=2")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 1

    async def test_filter_by_base(self, rty_client):
        """?base=天津 should only return Tianjin records."""
        response = await rty_client.get("/api/rty/list?base=天津")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 2
        assert all(r["base"] == "天津" for r in data["data"])

    async def test_filter_by_product_model(self, rty_client):
        """?productModel=6210 C21 should only return that model's records."""
        response = await rty_client.get("/api/rty/list?productModel=6210 C21")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 2
        assert all(r["productModel"] == "6210 C21" for r in data["data"])

    async def test_filter_by_date_range(self, rty_client):
        """Date range filter should work."""
        response = await rty_client.get("/api/rty/list?date_from=2026-06-01&date_to=2026-06-02")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 2

    async def test_filter_by_date_from_only(self, rty_client):
        """date_from without date_to should return from that date onward."""
        response = await rty_client.get("/api/rty/list?date_from=2026-06-03")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 1
        assert data["data"][0]["time"] == "2026-06-03"

    async def test_filter_by_date_to_only(self, rty_client):
        """date_to without date_from should return up to that date."""
        response = await rty_client.get("/api/rty/list?date_to=2026-06-02")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 2

    async def test_filter_all(self, rty_client):
        """Multiple filters combined."""
        response = await rty_client.get("/api/rty/list?base=天津&productModel=6210 C21")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 1

    async def test_filter_customer_case_insensitive(self, rty_client):
        """Customer filter should be case-insensitive via regex."""
        response = await rty_client.get("/api/rty/list?customer=客户a")
        assert response.status_code == 200
        data = response.json()
        assert len(data["data"]) == 3
        assert all("客户A" in r["customer"] or "客户B" in r["customer"] for r in data["data"])

    async def test_response_fields(self, rty_client):
        """Response should contain all expected RTY fields."""
        response = await rty_client.get("/api/rty/list?limit=1")
        data = response.json()["data"][0]
        assert "id" in data
        assert "time" in data
        assert "productModel" in data
        assert "base" in data
        assert "defectCount" in data
        assert "inputCount" in data
        assert "rtyRate" in data
        assert "targetRate" in data