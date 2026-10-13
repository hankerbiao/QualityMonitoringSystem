import asyncio

import httpx
import pytest

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
async def test_all_orders_coalesces_concurrent_loads():
    calls = 0

    async def request_json(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return {"items": [{"aufnr": "1"}]}

    client = DataGatewayClient("http://gateway.test", timeout=2)
    client.request_json = request_json  # type: ignore[method-assign]
    first, second = await asyncio.gather(client.all_orders(), client.all_orders())
    assert calls == 1
    assert first == second == [{"aufnr": "1"}]


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
async def test_bom_stream_falls_back_when_gateway_stream_hits_its_row_cap():
    client = DataGatewayClient("http://gateway.test", timeout=2)
    calls: list[str] = []
    rows = [{"id": f"bom-{index}", "GSTRS": "2026-01-01"} for index in range(10_000)]

    async def all_pages(method: str, path: str, **kwargs: object):
        del method
        calls.append(path)
        assert kwargs["filters"] == {"timeField": "planned"}
        return [{"id": "complete", "GSTRS": "2026-02-01"}]

    client.all_pages = all_pages  # type: ignore[method-assign]
    stream_text = "id\tGSTRS\n" + "\n".join(
        f"{row['id']}\t{row['GSTRS']}" for row in rows
    ) + "\n"
    client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _request: httpx.Response(200, text=stream_text)),
        base_url=client.base_url,
    )
    try:
        result = await client.all_bom_rows()
    finally:
        await client.close()

    assert result == [{"id": "complete", "GSTRS": "2026-02-01"}]
    assert calls == ["/api/views/ZSGV_ZSD124"]


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
