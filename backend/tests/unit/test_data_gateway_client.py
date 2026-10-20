import asyncio
from unittest.mock import AsyncMock

import httpx
import pytest

from app.services.data_gateway_client import DataGatewayClient, DataGatewayError


@pytest.mark.asyncio
async def test_order_cache_isolates_sync_versions_without_forwarding_them():
    client = DataGatewayClient("http://gateway.test")
    client.all_pages = AsyncMock(side_effect=[[{"id": "old"}], [{"id": "new"}]])
    assert await client.all_orders(source_version="v1", base="1000") == [{"id": "old"}]
    assert await client.all_orders(source_version="v2", base="1000") == [{"id": "new"}]
    assert await client.all_orders(source_version="v2", base="1000") == [{"id": "new"}]
    assert client.all_pages.await_count == 2
    assert client.all_pages.await_args.kwargs["filters"] == {"base": "1000"}


@pytest.mark.asyncio
async def test_export_rows_splits_oversized_batches_and_retains_every_repair():
    def handler(request):
        import json

        body = json.loads(request.read())
        assert request.url.path == "/api/exports/rows"
        assert body["resource"] == "faults"
        if len(body["keys"]) > 1:
            return httpx.Response(413, json={"error": "split batch"})
        number = body["keys"][0]
        rows = [
            {"_id": f"{number}-{index}", "AUFNR": number, "PCODE": "SAME-SN", "U_FIND": "finder"}
            for index in range(2)
        ]
        return httpx.Response(200, json={"items": rows, "total": 2, "complete": True})

    client = DataGatewayClient("http://gateway.test")
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=client.base_url
    )
    try:
        rows = await client.export_rows("faults", ["1", "2"], max_rows=10)
        assert [row["_id"] for row in rows] == ["1-0", "1-1", "2-0", "2-1"]
        with pytest.raises(DataGatewayError):
            await client.export_rows("faults", ["1", "2"], max_rows=3)
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_bom_export_rows_splits_batches_and_never_falls_back_to_paginated_views():
    def handler(request: httpx.Request) -> httpx.Response:
        import json

        body = json.loads(request.read())
        assert body["resource"] == "bom"
        if body["keys"] == ["TOO-LARGE"]:
            return httpx.Response(413, json={"error": "single BOM limit"})
        if len(body["keys"]) > 1:
            return httpx.Response(413, json={"error": "split batch"})
        order = body["keys"][0]
        return httpx.Response(
            200,
            json={
                "items": [{"_id": f"bom-{order}", "AUFNR_1": order}],
                "total": 1,
                "complete": True,
            },
        )

    client = DataGatewayClient("http://gateway.test")
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=client.base_url
    )
    client.all_pages = AsyncMock()
    try:
        rows = await client.export_rows("bom", ["1", "2"])
        assert [row["AUFNR_1"] for row in rows] == ["1", "2"]
        with pytest.raises(DataGatewayError, match="single BOM limit"):
            await client.export_rows("bom", ["TOO-LARGE"])
        client.all_pages.assert_not_awaited()
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"items": [{"_id": "1"}], "total": 1, "complete": False},
        {"items": [{"_id": "1"}], "total": 2, "complete": True},
        {"items": [None], "total": 1, "complete": True},
    ],
)
async def test_export_rows_rejects_incomplete_source_data(payload):
    client = DataGatewayClient("http://gateway.test")
    client.request_json = AsyncMock(return_value=payload)
    with pytest.raises(DataGatewayError):
        await client.export_rows("orders", ["SG:1"])


@pytest.mark.asyncio
async def test_export_rows_uses_checked_pagination_when_one_key_exceeds_bulk_limit():
    client = DataGatewayClient("http://gateway.test")
    client.request_json = AsyncMock(side_effect=DataGatewayError("too many rows", status_code=413))
    client.all_pages = AsyncMock(return_value=[{"_id": "1"}, {"_id": "2"}])
    assert len(await client.export_rows("faults", ["1"])) == 2
    assert client.all_pages.await_args.args == ("GET", "/api/faults")
    assert client.all_pages.await_args.kwargs["filters"]["timeField"] == "planned"


@pytest.mark.asyncio
async def test_export_bulk_falls_back_only_for_unsupported_gateways():
    client = DataGatewayClient("http://gateway.test")
    client.request_json = AsyncMock(side_effect=DataGatewayError("not found", status_code=404))
    assert await client.export_rows("orders", ["SG:1"]) is None
    assert await client.export_version() is None
    client.request_json.side_effect = DataGatewayError("offline", status_code=503)
    with pytest.raises(DataGatewayError):
        await client.export_rows("orders", ["SG:1"])


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
async def test_order_models_reads_distinct_endpoint_without_dashboard_filters():
    captured = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append((request.method, request.url.path, dict(request.url.params)))
        return httpx.Response(200, json={"items": ["Normal", " L6 ", "Historical", "Normal", " "]})

    client = DataGatewayClient("http://gateway.test")
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=client.base_url
    )
    try:
        assert await client.order_models() == ["Historical", "L6", "Normal"]
    finally:
        await client.close()
    assert captured == [("GET", "/api/orders/models", {})]


@pytest.mark.asyncio
async def test_order_options_reads_scoped_endpoint_and_normalizes_values():
    captured = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append((request.method, request.url.path, dict(request.url.params)))
        return httpx.Response(
            200,
            json={
                "productionOrders": [" PO-2 ", "PO-1", "PO-1"],
                "salesOrders": ["SO-2"],
                "materialNumbers": ["MAT-1"],
                "productModels": ["Model-1"],
                "bases": ["1000"],
                "customerIds": ["C-1"],
            },
        )

    client = DataGatewayClient("http://gateway.test")
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=client.base_url
    )
    try:
        result = await client.order_options(base="1000")
    finally:
        await client.close()
    assert result["productionOrders"] == ["PO-1", "PO-2"]
    assert captured == [("GET", "/api/orders/options", {"base": "1000"})]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [None, [], {}, {"items": None}, {"items": "M"}, {"items": ["M", None]}, {"items": [1]}],
)
async def test_order_models_rejects_invalid_list_and_allows_retry(payload):
    client = DataGatewayClient("http://gateway.test")
    client.request_json = AsyncMock(side_effect=[payload, {"items": ["M"]}])
    with pytest.raises(DataGatewayError, match="无效机型列表") as error:
        await client.order_models()
    assert error.value.code == "DATA_GATEWAY_BAD_RESPONSE"
    assert await client.order_models() == ["M"]


@pytest.mark.asyncio
async def test_order_models_accepts_empty_source():
    client = DataGatewayClient("http://gateway.test")
    client.request_json = AsyncMock(return_value={"items": []})
    assert await client.order_models() == []


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
        assert error.value.code == "DATA_GATEWAY_UNAVAILABLE"
        assert error.value.retryable is True
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
            production_orders=["1", "000000000001"],
            date_from="2026-01-01",
            date_to="2026-12-31",
            time_field="planned",
        )
    finally:
        await client.close()

    assert result[0]["serialNumber"] == "SN1"
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/faults/lookup"
    assert '"timeField":"planned"' in captured["body"].decode()


@pytest.mark.asyncio
async def test_fault_rows_by_host_barcodes_reads_full_fault_documents():
    client = DataGatewayClient("http://gateway.test", timeout=2)
    captured: dict[str, object] = {}

    async def all_pages(method: str, path: str, **kwargs: object):
        captured.update({"method": method, "path": path, **kwargs})
        return [{"id": "fault-1"}]

    client.all_pages = all_pages  # type: ignore[method-assign]
    result = await client.fault_rows_by_host_barcodes(
        ["SN-1", "SN-1"], date_from="2026-08-01", date_to="2026-08-31"
    )

    assert result == [{"id": "fault-1"}]
    assert captured == {
        "method": "GET",
        "path": "/api/faults",
        "filters": {
            "hostBarcode": "SN-1",
            "dateFrom": "2026-08-01",
            "dateTo": "2026-08-31",
        },
        "max_rows": 250_000,
    }


@pytest.mark.asyncio
async def test_all_orders_reuses_short_lived_cache():
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"items": [{"id": "KK:1", "aufnr": "1"}], "total": 1})

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
async def test_all_orders_coalesces_concurrent_loads():
    calls = 0

    async def request_json(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return {"items": [{"id": "KK:1", "aufnr": "1"}], "total": 1}

    client = DataGatewayClient("http://gateway.test", timeout=2)
    client.request_json = request_json  # type: ignore[method-assign]
    first, second = await asyncio.gather(client.all_orders(), client.all_orders())
    assert calls == 1
    assert first == second == [{"id": "KK:1", "aufnr": "1"}]


@pytest.mark.asyncio
async def test_all_orders_reads_beyond_the_bulk_endpoint_cap():
    client = DataGatewayClient("http://gateway.test")
    client.cache_ttl = 10
    requests = []

    async def request_json(method, path, *, params):
        requests.append((method, path, params))
        first = (params["page"] - 1) * 100
        return {
            "items": [{"id": f"KK:{index}"} for index in range(first, min(first + 100, 10_001))],
            "total": 10_001,
        }

    client.request_json = request_json
    result = await client.all_orders(dateFrom="2026-01-01")
    assert len(result) == 10_001
    assert result[-1] == {"id": "KK:10000"}
    assert len(requests) == 101
    assert all(path == "/api/orders" for _, path, _ in requests)
    assert all(params["dateFrom"] == "2026-01-01" for _, _, params in requests)
    assert requests[0][2].get("includeTotal") is None
    assert all(params.get("includeTotal") == "false" for _, _, params in requests[1:])
    assert await client.all_orders(dateFrom="2026-01-01") == result
    assert len(requests) == 101


@pytest.mark.asyncio
async def test_all_pages_uses_first_total_when_followup_pages_skip_count():
    client = DataGatewayClient("http://gateway.test")
    requests = []

    async def request_json(method, path, *, params):
        requests.append((method, path, params))
        if params["page"] == 1:
            return {"items": [{"id": f"row-{index}"} for index in range(100)], "total": 101}
        return {"items": [{"id": "row-100"}], "total": 0}

    client.request_json = request_json
    rows = await client.all_pages("GET", "/api/orders")

    assert len(rows) == 101
    assert requests[0][2].get("includeTotal") is None
    assert requests[1][2]["includeTotal"] == "false"


@pytest.mark.asyncio
@pytest.mark.parametrize("duplicate_index", [0, 99])
async def test_all_orders_rejects_duplicate_ids_across_pages_without_caching(duplicate_index):
    client = DataGatewayClient("http://gateway.test")
    client.cache_ttl = 10
    first_page = [{"id": f"KK:{index}"} for index in range(100)]
    client.request_json = AsyncMock(
        side_effect=[
            {"items": list(first_page), "total": 101},
            {"items": [{"id": f"KK:{duplicate_index}"}], "total": 101},
            {"items": list(first_page), "total": 101},
            {"items": [{"id": "KK:100"}], "total": 101},
        ]
    )

    with pytest.raises(DataGatewayError) as error:
        await client.all_orders()
    assert error.value.code == "DATA_GATEWAY_BAD_RESPONSE"
    assert error.value.retryable is True
    assert await client.all_orders() == [*first_page, {"id": "KK:100"}]
    assert client.request_json.await_count == 4


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "items",
    [
        [{"id": "KK:1"}, {"id": "KK:1"}],
        [{"id": "KK:1"}, {"aufnr": "2"}],
        [{"id": ""}],
        [{"id": None}],
        [{"id": []}],
        [{"id": 1}],
    ],
)
async def test_all_orders_rejects_duplicate_or_invalid_ids_within_a_page(items):
    client = DataGatewayClient("http://gateway.test")
    client.request_json = AsyncMock(return_value={"items": items, "total": len(items)})

    with pytest.raises(DataGatewayError) as error:
        await client.all_orders()
    assert error.value.code == "DATA_GATEWAY_BAD_RESPONSE"
    assert error.value.retryable is True


@pytest.mark.asyncio
@pytest.mark.parametrize("concurrent", [False, True])
async def test_order_row_limits_are_enforced_for_cached_and_concurrent_reads(concurrent):
    client = DataGatewayClient("http://gateway.test")
    client.cache_ttl = 10
    client.request_json = AsyncMock(
        return_value={"items": [{"id": "KK:1"}, {"id": "KK:2"}], "total": 2}
    )
    if concurrent:
        large, small = await asyncio.gather(
            client.all_orders(max_rows=2),
            client.all_orders(max_rows=1),
            return_exceptions=True,
        )
        assert large == [{"id": "KK:1"}, {"id": "KK:2"}]
        assert isinstance(small, DataGatewayError)
        assert small.code == "QUERY_TOO_LARGE"
    else:
        assert len(await client.all_orders(max_rows=2)) == 2
        with pytest.raises(DataGatewayError) as error:
            await client.all_orders(max_rows=1)
        assert error.value.code == "QUERY_TOO_LARGE"


@pytest.mark.asyncio
async def test_cached_views_reject_smaller_limits_instead_of_truncating():
    client = DataGatewayClient("http://gateway.test")
    client.cache_ttl = 10
    client.request_json = AsyncMock(return_value={"items": [{"id": 1}, {"id": 2}]})
    assert len(await client.all_view("view", max_rows=2)) == 2
    with pytest.raises(DataGatewayError) as error:
        await client.all_view("view", max_rows=1)
    assert error.value.code == "QUERY_TOO_LARGE"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"items": [], "total": 101},
        {"items": [{"id": 1}], "total": 2},
        {"items": [{"id": 1}, None], "total": 2},
        {"items": [{"id": 1}]},
        {"items": [], "total": -1},
        {"items": [], "total": True},
        {"items": [], "total": 0.5},
        {"items": [], "total": "0"},
        {"total": 0},
    ],
)
async def test_all_pages_rejects_incomplete_or_invalid_results(payload):
    client = DataGatewayClient("http://gateway.test")
    client.request_json = AsyncMock(return_value=payload)
    with pytest.raises(DataGatewayError) as error:
        await client.all_pages("GET", "/api/orders")
    assert error.value.code == "DATA_GATEWAY_BAD_RESPONSE"


@pytest.mark.asyncio
async def test_all_pages_rejects_changing_totals():
    client = DataGatewayClient("http://gateway.test")
    client.request_json = AsyncMock(
        side_effect=[
            {"items": [{"id": index} for index in range(100)], "total": 101},
            {"items": [{"id": 100}, {"id": 101}], "total": 102},
        ]
    )
    with pytest.raises(DataGatewayError) as error:
        await client.all_pages("GET", "/api/orders")
    assert error.value.code == "DATA_GATEWAY_BAD_RESPONSE"


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
async def test_stream_text_coalesces_concurrent_loads():
    calls = 0

    async def request_text(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0)
        return "id\tvalue\n1\trow\n"

    client = DataGatewayClient("http://gateway.test", timeout=2)
    client.request_text = request_text  # type: ignore[method-assign]
    # Exercise the same behavior through the internal single-flight primitive
    # without making a real network request.
    client._request_text_network = request_text  # type: ignore[method-assign]
    try:
        first, second = await asyncio.gather(
            DataGatewayClient.request_text(client, "GET", "/api/views/SCS_CHANGE/stream"),
            DataGatewayClient.request_text(client, "GET", "/api/views/SCS_CHANGE/stream"),
        )
    finally:
        await client.close()

    assert calls == 1
    assert first == second


@pytest.mark.asyncio
async def test_bom_stream_falls_back_to_paginated_view_when_gstrs_is_missing():
    client = DataGatewayClient("http://gateway.test", timeout=2)
    calls: list[str] = []
    captured: dict[str, object] = {}

    async def request_json(method: str, path: str, **kwargs: object):
        del method
        calls.append(path)
        captured.update(kwargs)
        return {"items": [{"id": "bom-1", "GSTRS": "2026-09-20"}], "total": 1}

    client.request_json = request_json  # type: ignore[method-assign]
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(200, text="id\tMATNR\nrow-1\tPN-1\n")
        ),
        base_url=client.base_url,
    )
    try:
        rows = await client.all_bom_rows(materialCode="PN-1")
    finally:
        await client.close()

    assert rows == [{"id": "bom-1", "GSTRS": "2026-09-20"}]
    assert calls == ["/api/views/ZSGV_ZSD124"]
    assert captured["params"] == {
        "page": 1,
        "pageSize": 100,
        "materialCode": "PN-1",
        "timeField": "planned",
    }


@pytest.mark.asyncio
async def test_bom_stream_falls_back_when_required_bwart_values_are_empty():
    client = DataGatewayClient("http://gateway.test", timeout=2)
    captured: dict[str, object] = {}

    async def all_pages(method: str, path: str, **kwargs: object):
        captured.update({"method": method, "path": path, **kwargs})
        return [{"id": "bom-1", "GSTRS": "2026-10-10", "BWART": "261", "MENGE_A": "607"}]

    client.all_pages = all_pages  # type: ignore[method-assign]
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200, text="id\tGSTRS\tBWART\nstream-1\t20261010\t\n"
            )
        ),
        base_url=client.base_url,
    )
    try:
        rows = await client.all_bom_rows(
            materialCode="PN-1",
            dateFrom="2026-10-10",
            dateTo="2026-10-16",
            require_bwart=True,
        )
    finally:
        await client.close()

    assert rows[0]["BWART"] == "261"
    assert captured == {
        "method": "GET",
        "path": "/api/views/ZSGV_ZSD124",
        "filters": {
            "materialCode": "PN-1",
            "dateFrom": "2026-10-10",
            "dateTo": "2026-10-16",
            "timeField": "planned",
        },
        "max_rows": 1_000_000,
    }


@pytest.mark.asyncio
async def test_bom_stream_rejects_an_unbounded_gateway_stream_at_its_row_cap():
    client = DataGatewayClient("http://gateway.test", timeout=2)
    rows = [{"id": f"bom-{index}", "GSTRS": "2026-01-01"} for index in range(10_000)]
    client.all_pages = AsyncMock()  # type: ignore[method-assign]
    stream_text = "id\tGSTRS\n" + "\n".join(f"{row['id']}\t{row['GSTRS']}" for row in rows) + "\n"
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _request: httpx.Response(200, text=stream_text)),
        base_url=client.base_url,
    )
    try:
        with pytest.raises(DataGatewayError, match="缩小日期或增加筛选条件") as error:
            await client.all_bom_rows(dateFrom="2026-01-01", dateTo="2026-01-01")
    finally:
        await client.close()

    assert error.value.code == "QUERY_TOO_LARGE"
    client.all_pages.assert_not_awaited()


@pytest.mark.asyncio
async def test_bom_stream_rejects_an_unbounded_query_before_network():
    client = DataGatewayClient("http://gateway.test", timeout=2)
    client.all_pages = AsyncMock()  # type: ignore[method-assign]
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _request: pytest.fail("unbounded BOM query reached the gateway")
        ),
        base_url=client.base_url,
    )
    try:
        with pytest.raises(DataGatewayError, match="未限定范围的查询已禁用") as error:
            await client.all_bom_rows()
    finally:
        await client.close()

    assert error.value.code == "QUERY_TOO_LARGE"
    client.all_pages.assert_not_awaited()


@pytest.mark.asyncio
async def test_bom_stream_splits_a_capped_date_range_without_paging():
    client = DataGatewayClient("http://gateway.test", timeout=2)
    calls: list[str] = []

    async def all_pages(*_args: object, **_kwargs: object):
        calls.append("paged")
        return []

    client.all_pages = all_pages  # type: ignore[method-assign]

    def handler(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        if params["dateFrom"] != params["dateTo"]:
            rows = [{"id": f"bom-{index}", "GSTRS": "2026-01-01"} for index in range(10_000)]
        elif params["dateFrom"] == "2026-01-01":
            rows = [{"id": "bom-1", "GSTRS": "2026-01-01"}]
        else:
            rows = [{"id": "bom-2", "GSTRS": "2026-01-02"}]
        return httpx.Response(
            200,
            text="id\tGSTRS\n" + "\n".join(f"{row['id']}\t{row['GSTRS']}" for row in rows),
        )

    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=client.base_url
    )
    try:
        result = await client.all_bom_rows(dateFrom="2026-01-01", dateTo="2026-01-02")
    finally:
        await client.close()

    assert len(result) == 2
    assert calls == []


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


@pytest.mark.asyncio
async def test_station_rows_falls_back_to_paginated_view_when_planned_gstrs_is_missing():
    client = DataGatewayClient("http://gateway.test", timeout=2)
    captured: dict[str, object] = {}

    async def request_json(method: str, path: str, **kwargs: object):
        captured.update({"method": method, "path": path, **kwargs})
        return {"items": [{"id": "station-1", "GSTRS": "2026-07-15"}], "total": 1}

    client.request_json = request_json  # type: ignore[method-assign]
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(200, text="id\tPCODE\nrow-1\tSN1\n")
        ),
        base_url=client.base_url,
    )
    try:
        rows = await client.all_station_rows(
            dateFrom="2026-07-01", dateTo="2026-07-31", timeField="planned"
        )
    finally:
        await client.close()

    assert rows == [{"id": "station-1", "GSTRS": "2026-07-15"}]
    assert captured == {
        "method": "GET",
        "path": "/api/views/Z_V_ZMES_T_001",
        "params": {
            "page": 1,
            "pageSize": 100,
            "dateFrom": "2026-07-01",
            "dateTo": "2026-07-31",
            "timeField": "planned",
        },
    }


@pytest.mark.asyncio
async def test_fault_rows_by_sns_posts_planned_time_field():
    client = DataGatewayClient("http://gateway.test", timeout=2)
    captured: dict[str, object] = {}

    async def request_json(method: str, path: str, **kwargs: object):
        captured.update({"method": method, "path": path, **kwargs})
        return {"items": [{"PCODE": "SN-1", "GSTRS": "2026-07-15"}]}

    client.request_json = request_json  # type: ignore[method-assign]
    rows = await client.fault_rows_by_sns(
        ["SN-1", " SN-1 ", ""],
        date_from="2026-07-01",
        date_to="2026-07-31",
        time_field="planned",
    )

    assert rows == [{"PCODE": "SN-1", "GSTRS": "2026-07-15"}]
    assert captured == {
        "method": "POST",
        "path": "/api/faults/by-sns",
        "json": {
            "sns": ["SN-1"],
            "dateFrom": "2026-07-01",
            "dateTo": "2026-07-31",
            "station": "",
            "timeField": "planned",
        },
    }


@pytest.mark.asyncio
async def test_fault_rows_by_sns_falls_back_when_gateway_omits_planned_date():
    client = DataGatewayClient("http://gateway.test", timeout=2)
    calls: list[str] = []

    async def request_json(method: str, path: str, **kwargs: object):
        calls.append(method)
        return {"items": [{"PCODE": "SN-1", "ZDATE_WX": "20260720"}]}

    async def all_pages(method: str, path: str, **kwargs: object):
        calls.append(method)
        assert kwargs["filters"]["timeField"] == "planned"
        assert kwargs["filters"]["hostBarcode"] == "SN-1"
        return [{"PCODE": "SN-1", "GSTRS": "2026-07-15"}]

    client.request_json = request_json  # type: ignore[method-assign]
    client.all_pages = all_pages  # type: ignore[method-assign]
    rows = await client.fault_rows_by_sns(
        ["SN-1"],
        date_from="2026-07-01",
        date_to="2026-07-31",
        time_field="planned",
    )

    assert rows == [{"PCODE": "SN-1", "GSTRS": "2026-07-15"}]
    assert calls == ["POST", "GET"]


@pytest.mark.asyncio
async def test_fault_rows_without_date_filter_keep_rows_missing_planned_date():
    client = DataGatewayClient("http://gateway.test", timeout=2)
    client.request_json = AsyncMock(
        return_value={
            "items": [{"PCODE": "SN-1", "ZDATE_WX": ""}],
        }
    )
    client.all_pages = AsyncMock()

    rows = await client.fault_rows_by_sns(["SN-1"], time_field="planned")

    assert rows == [{"PCODE": "SN-1", "ZDATE_WX": ""}]
    client.all_pages.assert_not_awaited()
    assert client.request_json.await_args.kwargs["json"] == {
        "sns": ["SN-1"],
        "dateFrom": "",
        "dateTo": "",
        "station": "",
        "timeField": "planned",
    }


@pytest.mark.asyncio
async def test_station_rows_reject_a_stream_above_the_row_cap():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="id\tPCODE\n1\tA\n2\tB\n")

    client = DataGatewayClient("http://gateway.test", timeout=2)
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url=client.base_url
    )
    try:
        with pytest.raises(DataGatewayError, match="单次处理上限 1 条"):
            await client.all_station_rows(dateFrom="2026-01-01", max_rows=1)
    finally:
        await client.close()
