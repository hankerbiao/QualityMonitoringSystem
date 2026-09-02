import httpx
import pytest

from app.api.sales_orders import _query_gateway_orders, _serialize_gateway_order
from app.services.data_gateway_client import DataGatewayClient, DataGatewayError


@pytest.mark.asyncio
async def test_orders_maps_gateway_pagination_and_filters():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["params"] = dict(request.url.params)
        return httpx.Response(200, json={"items": [], "total": 0})

    client = DataGatewayClient("http://gateway.test", timeout=2)
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=client.base_url
    )
    try:
        result = await client.orders(page=3, page_size=25, source="SG", keyword=" PO-1 ")
    finally:
        await client.close()

    assert result["total"] == 0
    assert captured == {
        "path": "/api/orders",
        "params": {"page": "3", "pageSize": "25", "source": "SG", "keyword": " PO-1 "},
    }


@pytest.mark.asyncio
async def test_gateway_errors_are_normalized():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": "MongoDB unavailable"})

    client = DataGatewayClient("http://gateway.test", timeout=2)
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=client.base_url
    )
    try:
        with pytest.raises(DataGatewayError, match="MongoDB unavailable") as error:
            await client.health()
        assert error.value.status_code == 503
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_unconfigured_gateway_fails_fast():
    client = DataGatewayClient("")
    with pytest.raises(DataGatewayError, match="DATA_GATEWAY_URL 未配置"):
        await client.health()


def test_gateway_order_is_adapted_to_existing_schema():
    order = _serialize_gateway_order(
        {
            "id": "SG:PO-1",
            "source": "SG",
            "aufnr": "PO-1",
            "salesOrder": "SO-1",
            "productionModel": "Model A",
            "inventoryLocation": "BASE-A",
            "orderQuantity": 3,
            "plannedStartDate": "2026-01-02",
        }
    )
    assert order.id == "SG:PO-1"
    assert order.aufnr == "PO-1"
    assert order.data["MAKTX_TH"] == "Model A"
    assert order.data["LGORT"] == "BASE-A"
    assert order.quantity == 3


@pytest.mark.asyncio
async def test_gateway_order_query_preserves_bff_response_shape(monkeypatch):
    from app.api import sales_orders

    async def orders(**_kwargs):
        return {
            "items": [{"id": "SG:PO-1", "source": "SG", "aufnr": "PO-1", "orderQuantity": 4}],
            "page": 1,
            "pageSize": 20,
            "total": 1,
        }

    async def stats(**_kwargs):
        return {"orderQuantity": 4}

    monkeypatch.setattr(sales_orders.data_gateway, "orders", orders)
    monkeypatch.setattr(sales_orders.data_gateway, "order_stats", stats)
    result = await _query_gateway_orders(page=1, limit=20, date_from=None, date_to=None, keyword=None)
    assert result.total == 1
    assert result.items[0].aufnr == "PO-1"
    assert result.stats.total_quantity == 4
