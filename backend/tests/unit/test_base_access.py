"""Production-base boundaries, including cached aggregates and image grants."""

import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.base_access import (
    base_access_scope,
    base_allowed,
    current_base_permissions,
    require_base_access,
)
from app.schemas.users import UpdateUserRequest
from app.services import lrr_gateway, rty_export, rty_gateway
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.image_access import image_grant, require_image_grant
from app.services.lrr_list_cache import LRRListQuery
from app.services.process_record_service import ProcessRecordGateway, get_filter_options


def test_base_names_codes_and_empty_scope():
    assert UpdateUserRequest(basePermissions=["天津", "TJ", "1000"]).basePermissions == ["1000"]
    with base_access_scope(["1000"]):
        assert base_allowed("天津")
        assert base_allowed("TJ")
        assert not base_allowed("3000")
        assert not base_allowed("")
        with pytest.raises(HTTPException) as error:
            require_base_access("1000,3000")
        assert error.value.status_code == 403
    with base_access_scope([]):
        assert not base_allowed("天津")
    assert base_allowed("3000")


async def test_scope_is_isolated_between_concurrent_requests():
    async def request(scope):
        with base_access_scope(scope):
            await asyncio.sleep(0)
            return current_base_permissions()

    assert await asyncio.gather(request(["1000"]), request(["3000"]), request(None)) == [
        ("1000",),
        ("3000",),
        None,
    ]
    assert current_base_permissions() is None


async def test_orders_and_options_filter_missing_and_unauthorized_bases(monkeypatch):
    rows = [
        {"aufnr": "1", "inventoryLocation": "1000", "productionModel": "TJ-model"},
        {"aufnr": "2", "inventoryLocation": "3000", "productionModel": "KS-model"},
        {"aufnr": "3", "productionModel": "unknown-model"},
    ]
    monkeypatch.setattr(rty_gateway.data_gateway, "all_orders", AsyncMock(return_value=rows))

    async def order_options(*, base: str = ""):
        scoped = [
            row
            for row in rows
            if not base or row.get("inventoryLocation") == base
        ]
        return {
            "productionOrders": [row["aufnr"] for row in scoped],
            "salesOrders": [row.get("salesOrder", "") for row in scoped if row.get("salesOrder")],
            "materialNumbers": [],
            "productModels": [
                row["productionModel"] for row in scoped if row.get("productionModel")
            ],
            "bases": [
                row["inventoryLocation"] for row in scoped if row.get("inventoryLocation")
            ],
            "customerIds": [],
        }

    monkeypatch.setattr(rty_gateway.data_gateway, "order_options", order_options)
    with base_access_scope(["1000"]):
        assert [row["aufnr"] for row in await rty_gateway._order_rows({})] == ["1"]
        options = await lrr_gateway.options()
        assert options["bases"] == ["1000"]
        assert options["productModels"] == ["TJ-model"]
    with base_access_scope([]):
        assert await rty_gateway._order_rows({}) == []


async def test_order_ownership_index_reuses_immutable_sets_and_tracks_scope_and_version(
    monkeypatch,
):
    version = {"orders": "1", "faults": "1", "bindings": "1"}
    monkeypatch.setattr(
        rty_gateway.data_gateway, "export_version", AsyncMock(side_effect=lambda: dict(version))
    )
    loader = AsyncMock(
        return_value=[
            {"aufnr": "0001", "inventoryLocation": "1000", "raw": {"data": {"IF_L6": "X"}}},
            {"aufnr": "0002", "inventoryLocation": "3000"},
            {"aufnr": "0003"},
        ]
    )
    monkeypatch.setattr(rty_gateway.data_gateway, "all_orders", loader)
    with base_access_scope(["1000"]):
        first = await rty_gateway.accessible_order_numbers()
        assert first == frozenset({"1"})
        assert await rty_gateway.accessible_order_numbers() is first
    with base_access_scope(["3000"]):
        assert await rty_gateway.accessible_order_numbers() == frozenset({"2"})
    with base_access_scope(["1000", "3000"]):
        assert await rty_gateway.accessible_order_numbers() == frozenset({"1", "2"})
    with base_access_scope([]):
        assert await rty_gateway.accessible_order_numbers() == frozenset()
    assert loader.await_count == 1
    version["faults"] = "2"
    with base_access_scope(["1000"]):
        assert await rty_gateway.accessible_order_numbers() is first
        version["orders"] = "2"
        loader.return_value = [{"aufnr": "0001", "inventoryLocation": "3000"}]
        assert await rty_gateway.accessible_order_numbers() == frozenset()
    assert loader.await_count == 2
    assert loader.await_args.kwargs == {"source_version": "2"}


async def test_order_ownership_rejects_sync_rollover_and_retries(monkeypatch):
    version = {"orders": "1", "faults": "1", "bindings": "1"}
    monkeypatch.setattr(
        rty_gateway.data_gateway, "export_version", AsyncMock(side_effect=lambda: dict(version))
    )

    async def load(**_kwargs):
        version["orders"] = "2"
        return [{"aufnr": "1", "inventoryLocation": "1000"}]

    loader = AsyncMock(side_effect=load)
    monkeypatch.setattr(rty_gateway.data_gateway, "all_orders", loader)
    with base_access_scope(["1000"]):
        from app.services.data_gateway_client import DataGatewayError

        with pytest.raises(DataGatewayError, match="版本"):
            await rty_gateway.accessible_order_numbers()
        assert await rty_gateway.accessible_order_numbers() == frozenset({"1"})
    assert loader.await_count == 2


async def test_rty_list_and_cycle_caches_never_reuse_another_scope(monkeypatch):
    async def list_loader(*_args):
        return {"scope": current_base_permissions()}

    async def cycle_loader(*_args):
        return [current_base_permissions()]

    monkeypatch.setattr(rty_gateway, "_build_rty_list", list_loader)
    monkeypatch.setattr(rty_gateway, "_build_cycle_data", cycle_loader)
    monkeypatch.setattr(rty_gateway, "_RTY_LIST_CACHE", AsyncTTLCache())
    monkeypatch.setattr(rty_gateway, "_RTY_CYCLE_CACHE", AsyncTTLCache())
    for scope in (None, ["1000"], ["3000"], []):
        with base_access_scope(scope):
            assert (await rty_gateway.rty_list({}, 1, 50, {}))[
                "scope"
            ] == current_base_permissions()
            assert await rty_gateway.cycle_data("normal", None, {}) == [current_base_permissions()]


def test_lrr_cache_fingerprint_includes_base_access():
    assert (
        len(
            {
                LRRListQuery(base_permissions=scope).fingerprint
                for scope in (None, (), ("1000",), ("3000",))
            }
        )
        == 4
    )


async def test_lrr_uses_order_ownership_when_bom_base_is_missing_or_conflicting(monkeypatch):
    monkeypatch.setattr(
        lrr_gateway.data_gateway,
        "all_orders",
        AsyncMock(
            return_value=[
                {"aufnr": "1", "inventoryLocation": "1000"},
                {"aufnr": "2", "inventoryLocation": "3000"},
            ]
        ),
    )
    monkeypatch.setattr(
        lrr_gateway.data_gateway,
        "all_bom_rows",
        AsyncMock(
            return_value=[
                {"id": "a", "AUFNR_1": "1", "MATNR": "M", "GSTRS": "20261001", "MENGE_A": 5},
                {
                    "id": "b",
                    "AUFNR_1": "2",
                    "MATNR": "M",
                    "GSTRS": "20261001",
                    "MENGE_A": 9,
                    "LGORT": "1000",
                },
                {"id": "c", "AUFNR_1": "3", "MATNR": "M", "GSTRS": "20261001", "MENGE_A": 7},
            ]
        ),
    )
    with base_access_scope(["1000"]):
        rows = await lrr_gateway.load_bom()
    assert [row["_id"] for row in rows] == ["a"]


def test_station_filters_deny_foreign_or_missing_base():
    kwargs = {"serial_number": None, "product_model": None, "base": None, "group_by": "salesOrder"}
    with base_access_scope(["1000"]):
        assert rty_gateway._matches_station_filters({"LGORT": "1000"}, **kwargs)
        assert not rty_gateway._matches_station_filters({"LGORT": "3000"}, **kwargs)
        assert not rty_gateway._matches_station_filters({}, **kwargs)


async def test_export_checks_base_again_after_loading_full_order(monkeypatch):
    row = {"id": "a", "aufnr": "1", "plannedStartDate": "2026-10-01", "inventoryLocation": "1000"}
    monkeypatch.setattr(rty_export.data_gateway, "all_orders", AsyncMock(return_value=[row]))
    monkeypatch.setattr(
        rty_export,
        "_full_orders",
        AsyncMock(
            return_value=[
                {**row, "raw": {"data": {"AUFNR": "1", "GSTRS": "20261001", "LGORT": "3000"}}}
            ]
        ),
    )
    with base_access_scope(["1000"]):
        assert (
            await rty_export._load_orders({"dateFrom": "2026-10-01", "dateTo": "2026-10-31"}) == []
        )


async def test_export_source_cache_is_partitioned_by_permission_scope(monkeypatch):
    monkeypatch.setattr(rty_export, "_SOURCE_CACHE", AsyncTTLCache())
    monkeypatch.setattr(
        rty_export.data_gateway,
        "export_version",
        AsyncMock(return_value={"orders": "1", "faults": "1", "bindings": "1"}),
    )

    async def loader(*_args, **_kwargs):
        return [{"bases": current_base_permissions()}], []

    monkeypatch.setattr(rty_export, "_load_sources_uncached", loader)
    filters = {"dateFrom": "2026-10-01", "dateTo": "2026-10-31"}
    for scope in (None, ["1000"], ["3000"], []):
        with base_access_scope(scope):
            orders, _ = await rty_export._load_sources(filters)
            assert orders[0]["bases"] == scope


def test_image_grant_checks_path_source_expiry_and_current_permissions(monkeypatch):
    monkeypatch.setattr("app.services.image_access.time.time", lambda: 100)
    path = "Upload/Tables/test/a.jpg"
    token = image_grant("system1", path, "天津")
    with base_access_scope(["1000"]):
        require_image_grant(token, "system1", path)
        for grant, source, requested_path in [
            ("", "system1", path),
            (token + "x", "system1", path),
            (token, "system2", path),
            (token, "system1", "Upload/Tables/test/b.jpg"),
        ]:
            with pytest.raises(HTTPException):
                require_image_grant(grant, source, requested_path)
    with base_access_scope(["3000"]), pytest.raises(HTTPException):
        require_image_grant(token, "system1", path)
    monkeypatch.setattr("app.services.image_access.time.time", lambda: 3700)
    with base_access_scope(["1000"]), pytest.raises(HTTPException):
        require_image_grant(token, "system1", path)


async def test_photos_query_only_allowed_bases_and_paginate_merged_rows(monkeypatch):
    calls = []

    class Client:
        async def fetch_page(self, page, rows, *, sn, base, station):
            calls.append((page, rows, base))
            records = [
                {
                    "id": value,
                    "base_code": base,
                    "scan_code": f"SN-{base}-{value}",
                    "photo_url_one": f"Upload/Tables/test/{base}-{value}.jpg",
                }
                for value in (6, 4, 2)
                if base == "TJ"
            ] + [
                {"id": value, "base_code": base, "scan_code": f"SN-{base}-{value}"}
                for value in (5, 3, 1)
                if base == "KS"
            ]
            return {"total": len(records), "rows": records[(page - 1) * rows : page * rows]}

    gateway = ProcessRecordGateway()
    monkeypatch.setattr(gateway, "_ensure_clients", AsyncMock(return_value={"system1": Client()}))
    with base_access_scope(["1000", "3000"]):
        data = await gateway.query("system1", 2, 2, "")
        assert data.total == 6
        assert [row.recordId for row in data.rows] == ["4", "3"]
        assert data.rows[0].photos[0].accessToken
        assert {option.name for option in get_filter_options().bases} == {"天津", "昆山"}
    assert sorted(calls) == [(1, 2, "KS"), (1, 2, "TJ"), (2, 2, "KS"), (2, 2, "TJ")]
    calls.clear()
    with base_access_scope(["1000", "3000"]):
        assert [row.recordId for row in (await gateway.query("system1", 3, 2, "")).rows] == [
            "2",
            "1",
        ]
    assert calls == []
    calls.clear()
    with base_access_scope([]):
        assert (await gateway.query("all", 1, 30, "")).total == 0
    assert calls == []


async def test_photos_fail_closed_if_upstream_ignores_base_filter(monkeypatch):
    client = AsyncMock()
    client.fetch_page.return_value = {"total": 1, "rows": [{"id": 1, "base_code": "KS"}]}
    gateway = ProcessRecordGateway()
    monkeypatch.setattr(gateway, "_ensure_clients", AsyncMock(return_value={"system1": client}))
    with base_access_scope(["1000"]):
        data = await gateway.query("system1", 1, 30, "")
    assert data.rows == []
    assert data.total == 0
    assert data.sources["system1"].online is False


async def test_single_base_photos_use_direct_deep_pagination_and_fresh_grants(monkeypatch):
    client = AsyncMock()
    client.fetch_page.return_value = {
        "total": 6000,
        "rows": [{"id": 1, "base_code": "TJ", "photo_url_one": "Upload/Tables/a.jpg"}],
    }
    gateway = ProcessRecordGateway()
    monkeypatch.setattr(gateway, "_ensure_clients", AsyncMock(return_value={"system1": client}))
    tokens = iter(["token-one", "token-two"])
    monkeypatch.setattr("app.services.process_record_service.image_grant", lambda *_: next(tokens))
    with base_access_scope(["1000"]):
        first = await gateway.query("system1", 100, 30, "")
        second = await gateway.query("system1", 100, 30, "")
    client.fetch_page.assert_awaited_once_with(100, 30, sn="", base="TJ", station="")
    assert first.rows[0].photos[0].accessToken == "token-one"
    assert second.rows[0].photos[0].accessToken == "token-two"


async def test_photo_page_errors_are_not_cached_and_invalidation_discards_pages(monkeypatch):
    client = AsyncMock()
    client.fetch_page.side_effect = [
        RuntimeError("offline"),
        {"total": 1, "rows": [{"id": 1, "base_code": "TJ"}]},
        {"total": 1, "rows": [{"id": 2, "base_code": "TJ"}]},
    ]
    gateway = ProcessRecordGateway()
    monkeypatch.setattr(gateway, "_ensure_clients", AsyncMock(return_value={"system1": client}))
    with base_access_scope(["1000"]):
        assert not (await gateway.query("system1", 1, 30, "")).sources["system1"].online
        assert (await gateway.query("system1", 1, 30, "")).rows[0].recordId == "1"
        await gateway.invalidate_clients()
        assert (await gateway.query("system1", 1, 30, "")).rows[0].recordId == "2"
    assert client.fetch_page.await_count == 3
