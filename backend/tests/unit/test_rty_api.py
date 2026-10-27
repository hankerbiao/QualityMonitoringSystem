from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from app.api import auth, rty
from app.schemas.rty import RTYCycleDetails, RTYTemplateExport, StationPassExport
from app.services import cycle_details, repair_quality, rty_gateway


@pytest.mark.asyncio
async def test_defect_details_uses_gateway_sn_lookup(monkeypatch):
    fault_rows_by_sns = AsyncMock(
        return_value=[
            {
                "_id": "fault-1",
                "PCODE": "SN-1",
                "AUFNR": "000000000001",
                "VBELN": "SO-1",
                "ZDATE_WX": "20260503",
                "ZNGWD": "F-01",
                "ZWXWD": "故障描述",
            }
        ]
    )
    monkeypatch.setattr(rty_gateway, "_faults_for_sns", fault_rows_by_sns)

    response = await rty.get_defect_details(" SN-1，SN-1 ,SN-2 ")

    fault_rows_by_sns.assert_awaited_once_with({"SN-1", "SN-2"})
    assert response.success
    assert len(response.data) == 1
    assert response.data[0].sn == "SN-1"
    assert response.data[0].defectCode == "F-01"
    assert response.data[0].repairTime == ""


@pytest.mark.asyncio
async def test_cycle_data_passes_validated_daily_range_to_gateway(monkeypatch):
    cycle_data = AsyncMock(return_value=[])
    monkeypatch.setattr(rty_gateway, "cycle_data", cycle_data)
    monkeypatch.setattr(rty, "_targets", AsyncMock(return_value={"M-1": 95}))

    response = await rty.get_rty_cycle_data(
        orderScope="normal",
        customer="customer-1",
        customers=["customer-2", "__NO_CUSTOMER_ID__"],
        dateFrom="2026-04-14",
        dateTo="2026-04-20",
    )

    cycle_data.assert_awaited_once_with(
        "normal",
        "customer-1",
        {"M-1": 95},
        customers=["customer-2", "__NO_CUSTOMER_ID__"],
        date_from="2026-04-14",
        date_to="2026-04-20",
    )
    assert response.success


@pytest.mark.asyncio
async def test_cycle_data_rejects_reversed_daily_range():
    with pytest.raises(HTTPException) as error:
        await rty.get_rty_cycle_data(
            orderScope="normal",
            dateFrom="2026-04-20",
            dateTo="2026-04-14",
        )
    assert error.value.detail == "开始日期不能晚于结束日期"


@pytest.mark.asyncio
async def test_cycle_details_forwards_applied_filters(monkeypatch):
    details = AsyncMock(return_value=RTYCycleDetails())
    monkeypatch.setattr(cycle_details, "build_cycle_details", details)

    response = await rty.get_cycle_details(
        request=None,
        dateFrom="2026-09-01",
        dateTo="2026-09-30",
        customer="C",
        customers=["C-2", "__NO_CUSTOMER_ID__"],
        productModels=["Model A"],
        bases=["B", "D"],
        orderScope="l6",
    )

    assert response.success
    details.assert_awaited_once_with(
        {
            "salesOrder": "",
            "productionOrder": "",
            "serialNumber": "",
            "base": "",
            "productModel": "",
            "customer": "C",
            "dateFrom": "2026-09-01",
            "dateTo": "2026-09-30",
            "orderScope": "l6",
            "calculationMethod": "",
        },
        product_models=["Model A"],
        bases=["B", "D"],
        customers=["C-2", "__NO_CUSTOMER_ID__", "C"],
    )
    route = next(route for route in rty.router.routes if route.path == "/cycle-details")
    assert route.dependencies


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("permissions", "status"),
    [(["rty"], 200), (["station-pass-rate"], 403), ([], 403)],
)
async def test_cycle_details_requires_rty_permission(monkeypatch, permissions, status):
    details = AsyncMock(
        return_value=RTYCycleDetails(orders=[{"AUFNR": "PO-1"}], faults=[])
    )
    monkeypatch.setattr(cycle_details, "build_cycle_details", details)
    app = FastAPI()
    app.include_router(rty.router, prefix="/api/rty")
    app.dependency_overrides[auth.get_current_user] = lambda: {
        "role": "user",
        "dashboardPermissions": permissions,
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/api/rty/cycle-details",
            params={"dateFrom": "2026-09-01", "dateTo": "2026-09-30"},
        )

    assert response.status_code == status
    if status == 200:
        assert response.json()["data"] == {
            "orders": [{"AUFNR": "PO-1"}],
            "faults": [],
        }
        details.assert_awaited_once()
    else:
        details.assert_not_awaited()


@pytest.mark.asyncio
async def test_station_pass_endpoints_forward_customer_filter(monkeypatch):
    station_rates = AsyncMock(return_value=[])
    station_details = AsyncMock(return_value=[])
    monkeypatch.setattr(rty_gateway, "station_rates", station_rates)
    monkeypatch.setattr(rty_gateway, "station_details", station_details)

    rates_response = await rty.get_station_pass_rates(customer="customer-1")
    details_response = await rty.get_station_pass_details(
        stationCode="OP10",
        customer="customer-1",
    )

    assert rates_response.success
    assert station_rates.await_args.kwargs["customers"] == ["customer-1"]
    assert details_response.success
    assert station_details.await_args.kwargs["customers"] == ["customer-1"]


@pytest.mark.asyncio
async def test_station_pass_endpoints_forward_overseas_filter(monkeypatch):
    station_rates = AsyncMock(return_value=[])
    station_details = AsyncMock(return_value=[])
    monkeypatch.setattr(rty_gateway, "station_rates", station_rates)
    monkeypatch.setattr(rty_gateway, "station_details", station_details)

    await rty.get_station_pass_rates(overseas=True)
    await rty.get_station_pass_details(stationCode="OP10", overseas=True)

    assert station_rates.await_args.kwargs["overseas"] is True
    assert station_details.await_args.kwargs["overseas"] is True


@pytest.mark.asyncio
async def test_repair_quality_endpoint_forwards_supported_filters(monkeypatch):
    analyze = AsyncMock(return_value={"snCount": 0, "groups": []})
    monkeypatch.setattr(repair_quality, "analyze", analyze)

    response = await rty.get_repair_quality(
        dateFrom="2026-10-01",
        dateTo="2026-10-31",
        productModels=["M1"],
        customers=["C1"],
        bases=["1000"],
    )

    assert response.success
    analyze.assert_awaited_once_with(
        "2026-10-01",
        "2026-10-31",
        product_models=["M1"],
        customers=["C1"],
        bases=["1000"],
    )


@pytest.mark.asyncio
async def test_repair_quality_export_forwards_supported_filters(monkeypatch):
    export = AsyncMock(return_value={"orders": [], "faults": [], "summary": {"snCount": 0}})
    monkeypatch.setattr(repair_quality, "build_export", export)
    response = await rty.get_repair_quality_export(
        dateFrom="2026-10-01", dateTo="2026-10-31",
        productModels=["M1", "M2"], customers=["C1"], bases=["1000"],
    )
    assert response.success
    export.assert_awaited_once_with(
        "2026-10-01", "2026-10-31", product_models=["M1", "M2"], customers=["C1"], bases=["1000"]
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("permissions", "bases", "status"),
    [(["repair-quality"], ["1000"], 200), (["rty"], ["1000"], 403),
     (["station-pass-rate"], ["1000"], 403), ([], ["1000"], 403),
     (["repair-quality"], ["3000"], 403)],
)
async def test_repair_quality_export_requires_own_permission_and_base_access(monkeypatch, permissions, bases, status):
    monkeypatch.setattr(rty, "get_database", lambda: None)
    monkeypatch.setattr(rty.SettingsService, "get_dashboard_statuses", AsyncMock(return_value={"repair-quality": "available"}))
    export = AsyncMock(return_value={"orders": [], "faults": [], "summary": {"snCount": 0}})
    monkeypatch.setattr(repair_quality, "build_export", export)
    app = FastAPI()
    app.include_router(rty.router, prefix="/api/rty")
    app.dependency_overrides[auth.get_current_user] = lambda: {
        "role": "user", "dashboardPermissions": permissions, "basePermissions": ["1000"],
    }
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/rty/repair-quality/export", params={
            "dateFrom": "2026-10-01", "dateTo": "2026-10-31", "bases": bases,
        })
    assert response.status_code == status
    if status == 200:
        export.assert_awaited_once()
    else:
        export.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["", "/options", "/export", "/details"])
@pytest.mark.parametrize(
    ("role", "dashboard_status", "expected"),
    [("user", "admin-only", 403), ("admin", "admin-only", 200), ("user", "available", 200)],
)
async def test_repair_quality_status_guards_all_endpoints(monkeypatch, endpoint, role, dashboard_status, expected):
    monkeypatch.setattr(rty, "get_database", lambda: None)
    monkeypatch.setattr(rty.SettingsService, "get_dashboard_statuses", AsyncMock(return_value={"repair-quality": dashboard_status}))
    analyze = AsyncMock(return_value={"snCount": 0, "groups": []})
    options = AsyncMock(return_value={"productModels": [], "customers": [], "bases": []})
    export = AsyncMock(return_value={"orders": [], "faults": [], "summary": {"snCount": 0}})
    details = AsyncMock(return_value={"items": [], "total": 0})
    monkeypatch.setattr(repair_quality, "analyze", analyze)
    monkeypatch.setattr(repair_quality, "options", options)
    monkeypatch.setattr(repair_quality, "build_export", export)
    monkeypatch.setattr(repair_quality, "details", details)
    app = FastAPI()
    app.include_router(rty.router, prefix="/api/rty")
    app.dependency_overrides[auth.get_current_user] = lambda: {
        "role": role, "dashboardPermissions": ["repair-quality"], "basePermissions": ["1000"],
    }
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(f"/api/rty/repair-quality{endpoint}", params={
            "dateFrom": "2026-10-01", "dateTo": "2026-10-26", "customer": "C1", "base": "1000",
        })
    assert response.status_code == expected
    if expected == 403:
        analyze.assert_not_awaited()
        options.assert_not_awaited()
        export.assert_not_awaited()
        details.assert_not_awaited()


@pytest.mark.asyncio
async def test_repair_quality_details_validates_and_forwards_query(monkeypatch):
    monkeypatch.setattr(rty, "get_database", lambda: None)
    monkeypatch.setattr(rty.SettingsService, "get_dashboard_statuses", AsyncMock(return_value={"repair-quality": "available"}))
    details = AsyncMock(return_value={"items": [], "total": 0})
    monkeypatch.setattr(repair_quality, "details", details)
    app = FastAPI()
    app.include_router(rty.router, prefix="/api/rty")
    app.dependency_overrides[auth.get_current_user] = lambda: {
        "role": "user", "dashboardPermissions": ["repair-quality"], "basePermissions": ["1000"],
    }
    params = {
        "dateFrom": "2026-10-01", "dateTo": "2026-10-31",
        "customer": "C1", "base": "1000", "bucket": "9+", "page": 2,
        "pageSize": 20, "productModels": "M1", "exportAll": "true",
    }
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/rty/repair-quality/details", params=params)
        invalid = await client.get("/api/rty/repair-quality/details", params={**params, "bucket": "10"})
        oversized = await client.get("/api/rty/repair-quality/details", params={**params, "pageSize": 201})
    assert response.status_code == 200
    assert invalid.status_code == oversized.status_code == 422
    details.assert_awaited_once_with(
        "2026-10-01", "2026-10-31", "C1", "1000", "9+",
        product_models=["M1"], customers=None, bases=None,
        page=2, page_size=20, export_all=True,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("permissions", [[], ["rty"], ["station-pass-rate"]])
async def test_repair_quality_details_requires_dashboard_permission(monkeypatch, permissions):
    details = AsyncMock(return_value={"items": [], "total": 0})
    monkeypatch.setattr(repair_quality, "details", details)
    app = FastAPI()
    app.include_router(rty.router, prefix="/api/rty")
    app.dependency_overrides[auth.get_current_user] = lambda: {
        "role": "user", "dashboardPermissions": permissions, "basePermissions": ["1000"],
    }
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/rty/repair-quality/details", params={
            "dateFrom": "2026-10-01", "dateTo": "2026-10-31",
            "customer": "C1", "base": "1000", "exportAll": "true",
        })
    assert response.status_code == 403
    details.assert_not_awaited()


@pytest.mark.asyncio
async def test_template_export_forwards_complete_filters_and_is_protected(monkeypatch):
    export = AsyncMock(return_value=RTYTemplateExport())
    monkeypatch.setattr(rty.rty_export, "build_template_export", export)

    response = await rty.get_rty_template_export(
        request=None,
        salesOrder="SO-1",
        productionOrder="PO-1",
        serialNumber="SN-1",
        base="B",
        productModel="M",
        customer="C",
        dateFrom="2026-09-01",
        dateTo="2026-09-30",
        orderScope="l6",
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    export.assert_awaited_once_with(
        {
            "salesOrder": "SO-1",
            "productionOrder": "PO-1",
            "serialNumber": "SN-1",
            "base": "B",
            "productModel": "M",
            "customer": "C",
            "dateFrom": "2026-09-01",
            "dateTo": "2026-09-30",
            "orderScope": "l6",
            "calculationMethod": "",
        },
        product_models=None,
        bases=None,
        customers=None,
        integrate=True,
    )
    route = next(route for route in rty.router.routes if route.path == "/export")
    assert route.dependencies


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("permissions", "status"),
    [(["rty"], 200), (["station-pass-rate"], 403), ([], 403)],
)
async def test_cycle_export_passes_repeated_filters_and_requires_only_rty_permission(
    monkeypatch,
    permissions,
    status,
):
    export = AsyncMock(return_value=StationPassExport())
    monkeypatch.setattr(rty.rty_export, "build_source_export", export)
    app = FastAPI()
    app.include_router(rty.router, prefix="/api/rty")
    app.dependency_overrides[auth.get_current_user] = lambda: {
        "role": "user",
        "dashboardPermissions": permissions,
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/api/rty/cycle-export",
            params=[
                ("dateFrom", "2026-10-05"),
                ("dateTo", "2026-10-11"),
                ("orderScope", "l6"),
                ("customer", "C"),
                ("customers", "C-1"),
                ("customers", "__NO_CUSTOMER_ID__"),
                ("productModels", "M, A"),
                ("productModels", "M B"),
                ("bases", "B"),
                ("bases", "D"),
            ],
        )
    assert response.status_code == status
    if status == 200:
        assert response.json()["data"] == {"orders": [], "faults": [], "modelSheets": []}
        assert export.await_args.kwargs == {
            "product_models": ["M, A", "M B"],
            "bases": ["B", "D"],
            "customers": ["C-1", "__NO_CUSTOMER_ID__", "C"],
            "integrate": True,
        }
        assert export.await_args.args[0]["orderScope"] == "l6"
        assert export.await_args.args[0]["customer"] == "C"
        assert export.await_args.args[0]["dateFrom"] == "2026-10-05"
        assert export.await_args.args[0]["dateTo"] == "2026-10-11"
    else:
        export.assert_not_awaited()


@pytest.mark.asyncio
async def test_station_export_forwards_overseas_filter(monkeypatch):
    export = AsyncMock(return_value=StationPassExport())
    monkeypatch.setattr(rty.rty_export, "build_source_export", export)

    response = await rty.get_station_pass_export(
        request=None,
        dateFrom="2026-10-05",
        dateTo="2026-10-11",
        overseas=True,
    )

    assert response.status_code == 200
    assert export.await_args.args[0]["overseas"] == "true"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("permissions", "status"),
    [(["station-pass-rate"], 200), (["rty"], 403), ([], 403)],
)
async def test_station_export_uses_station_permission_and_applied_filters(
    monkeypatch,
    permissions,
    status,
):
    export = AsyncMock(return_value=StationPassExport(orders=[{"AUFNR": "00001"}]))
    monkeypatch.setattr(rty.rty_export, "build_source_export", export)
    app = FastAPI()
    app.include_router(rty.router, prefix="/api/rty")
    app.dependency_overrides[auth.get_current_user] = lambda: {
        "role": "user",
        "dashboardPermissions": permissions,
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/api/rty/station-pass-export",
            params={
                "dateFrom": "2026-10-05",
                "dateTo": "2026-10-11",
                "orderScope": "l6",
                "serialNumber": "SN",
                "productModel": "M",
                "customer": "C",
                "base": "B",
            },
        )
    assert response.status_code == status
    if status == 200:
        assert response.json()["data"] == {
            "orders": [{"AUFNR": "00001"}],
            "faults": [],
            "modelSheets": [],
        }
        export.assert_awaited_once_with(
            {
                "salesOrder": "",
                "productionOrder": "",
                "serialNumber": "SN",
                "productModel": "M",
                "customer": "C",
                "base": "B",
                "dateFrom": "2026-10-05",
                "dateTo": "2026-10-11",
                "orderScope": "l6",
                "calculationMethod": "",
            },
            product_models=None,
            bases=None,
            customers=None,
            integrate=True,
        )
    else:
        export.assert_not_awaited()
