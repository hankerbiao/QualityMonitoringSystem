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


@pytest.mark.asyncio
async def test_fault_lookup_uses_post_body():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        captured["body"] = request.read()
        return httpx.Response(
            200, json={"items": [{"productionOrder": "1", "serialNumber": "SN1"}]}
        )

    client = DataGatewayClient("http://gateway.test", timeout=2)
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=client.base_url
    )
    try:
        result = await client.fault_lookup(
            production_orders=["1", "000000000001"], date_from="2026-01-01", date_to="2026-12-31"
        )
    finally:
        await client.close()

    assert result[0]["serialNumber"] == "SN1"
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/faults/lookup"


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

    async def all_orders(**_kwargs):
        return [{"id": "SG:PO-1", "source": "SG", "aufnr": "PO-1", "orderQuantity": 4}]

    monkeypatch.setattr(sales_orders.data_gateway, "all_orders", all_orders)
    result = await _query_gateway_orders(
        page=1, limit=20, date_from=None, date_to=None, keyword=None
    )
    assert result.total == 1
    assert result.items[0].aufnr == "PO-1"
    assert result.stats.total_quantity == 4


@pytest.mark.asyncio
async def test_all_orders_reuses_short_lived_cache():
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"items": [{"aufnr": "1"}]})

    client = DataGatewayClient("http://gateway.test", timeout=2)
    client.cache_ttl = 10
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=client.base_url
    )
    try:
        first = await client.all_orders(dateFrom="2026-01-01")
        first[0]["aufnr"] = "mutated"
        second = await client.all_orders(dateFrom="2026-01-01")
    finally:
        await client.close()

    assert calls == 1
    assert second[0]["aufnr"] == "1"


@pytest.mark.asyncio
async def test_all_view_reuses_short_lived_cache():
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"items": [{"id": "row-1"}]})

    client = DataGatewayClient("http://gateway.test", timeout=2)
    client.cache_ttl = 10
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=client.base_url
    )
    try:
        await client.all_view("ZSGV_ZSD124", dateFrom="2026-01-01")
        second = await client.all_view("ZSGV_ZSD124", dateFrom="2026-01-01")
    finally:
        await client.close()

    assert calls == 1
    assert second == [{"id": "row-1"}]


@pytest.mark.asyncio
async def test_stream_text_reuses_short_lived_cache():
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, text="id,AUFNR_1\n1,PO-1\n")

    client = DataGatewayClient("http://gateway.test", timeout=2)
    client.cache_ttl = 10
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=client.base_url
    )
    try:
        first = await client.request_text("GET", "/api/views/ZSGV_ZSD124/stream", params={"x": "1"})
        second = await client.request_text(
            "GET", "/api/views/ZSGV_ZSD124/stream", params={"x": "1"}
        )
    finally:
        await client.close()

    assert calls == 1
    assert first == second


@pytest.mark.asyncio
async def test_station_rows_reuses_short_lived_cache():
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, text="id\tPCODE\nrow-1\tSN1\n")

    client = DataGatewayClient("http://gateway.test", timeout=2)
    client.cache_ttl = 10
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=client.base_url
    )
    try:
        first = await client.all_station_rows(dateFrom="2026-01-01")
        second = await client.all_station_rows(dateFrom="2026-01-01")
    finally:
        await client.close()

    assert calls == 1
    assert first == second == [{"id": "row-1", "PCODE": "SN1"}]
