from datetime import date
from unittest.mock import AsyncMock

import pytest

from app.schemas.mfr import MFRFilters
from app.services import mfr_device_dashboard as service
from app.services.data_gateway_client import DataGatewayError


def device(key, order, service_no, serial, shipment="2026-10-01", fault="2026-10-01"):
    return {
        "deviceKey": key,
        "identityBasis": "product_barcode",
        "deviceSn": serial,
        "productionOrder": {"status": "valid", "value": order},
        "factoryDate": {"status": "missing"},
        "warrantyEndDate": {"status": "conflict"},
        "evidence": [
            {
                "company5000": True,
                "doaCode": "KX" + fault.replace("-", "") + "0001",
                "doaSalesOrder": "XNC1",
                "model": "M1" if service_no == "S1" else "M2",
                "judgment": "是",
                "doaStatus": "已受理",
                "shipmentDate": shipment,
                "serviceOrder": service_no,
                "serviceOrderAliases": [service_no],
            }
        ],
    }


def change(service_no, serial, kind="换上", revoked=False, when="2026-12-01"):
    return {
        "service_order": service_no,
        "device_sn": serial,
        "change_type": kind,
        "is_revoked": revoked,
        "create_at": when,
    }


@pytest.fixture(autouse=True)
def kk_shipments(monkeypatch):
    monkeypatch.setattr(service, "_DOA_DEVICES", service.AsyncTTLCache(max_entries=1))
    monkeypatch.setattr(
        service, "_KK_COUNTS", service.AsyncTTLCache(max_entries=1, copy_values=False)
    )
    mock = AsyncMock(return_value=())
    monkeypatch.setattr(service.data_gateway, "kk_cumulative_deliveries", mock)
    return mock


async def test_groups_distinct_devices_by_declaration_date(monkeypatch, kk_shipments):
    kk_shipments.side_effect = lambda *, date_to: (
        (("SO1", "2025-12", 1), ("SO1", "2026-02", 3))
        if date_to == date(2026, 2, 28)
        else (("SO1", "2025-12", 1), ("SO1", "2026-02", 2))
    )
    monkeypatch.setattr(
        service.scs_gateway,
        "doa_devices",
        AsyncMock(
            return_value=[
                device("product:a", "000010349985", "S1", "SN1", "2025-01-10", "2026-01-10"),
                device("product:b", "10349986", "S2", "SN2", "", "2026-02-11"),
                device("product:c", "10349987", "S2", "SN3", "2026-02-12", "2026-02-12"),
            ]
        ),
    )
    orders = AsyncMock(side_effect=AssertionError("MFR must not query the sales order dashboard"))
    monkeypatch.setattr(service.data_gateway, "all_orders", orders)

    async def rows(view, **kwargs):
        assert view == "SCS_CHANGE"
        values = [
            change("S1", "SN1"),
            change("S1", "SN1", "换上-up"),
            change("S1", "OTHER-SERIAL", "换下"),
            change("S1", "SN1", revoked=True),
            change("S2", "OTHER-SERIAL", "换下"),
            change("S3", "SN4"),
        ]
        return [
            item
            for item in values
            if item["change_type"] in kwargs["changeType"].split(",")
            and item["service_order"] in kwargs["serviceOrder"].split(",")
        ]

    monkeypatch.setattr(
        service.scs_gateway,
        "all",
        AsyncMock(side_effect=rows),
    )
    result = await service.build_device_dashboard(
        MFRFilters(dateFrom="2026-01-01", dateTo="2026-02-28")
    )
    assert result.summary.selectedDeviceCount == 3
    assert result.summary.faultCount == 3
    assert [row.faultDate for row in result.faultDetails] == [
        "2026-01-10",
        "2026-01-10",
        "2026-01-10",
        "2026-02-11",
        "2026-02-12",
    ]
    assert [
        (row.model, row.deviceSn, row.serviceOrder, row.plannedDate, row.occurredAt)
        for row in result.faultDetails
    ] == [
        ("M1", "SN1", "S1", "", "2026-12-01"),
        ("M1", "SN1", "S1", "", "2026-12-01"),
        ("M1", "SN1", "S1", "", "2026-12-01"),
        ("M2", "SN2", "S2", "", "2026-12-01"),
        ("M2", "SN3", "S2", "", "2026-12-01"),
    ]
    assert [row.shipmentDate for row in result.faultDetails] == ["2025-01-10"] * 3 + ["", "2026-02-12"]
    assert result.summary.mfrRate == 100.0
    assert result.summary.unmatchedChangeCount == 0
    assert result.summary.deviceIssues["lifecycleDateIncomplete"] == 3
    assert [(x.period, x.fleetCount, x.faultCount) for x in result.trend] == [
        ("2026-01", 0, 1),
        ("2026-02", 3, 2),
    ]
    assert [x.mfrRate for x in result.trend] == [None, 66.67]
    assert result.dailyTrend == []
    with pytest.raises(ValueError, match="暂只支持按日期筛选"):
        await service.build_device_dashboard(
            MFRFilters(dateFrom="2026-02-01", dateTo="2026-02-28", model="M2")
        )
    partial_month = await service.build_device_dashboard(
        MFRFilters(dateFrom="2026-02-11", dateTo="2026-02-28")
    )
    assert partial_month.summary.fleetCount == 1
    assert partial_month.trend[0].fleetCount == 1
    assert result.summary.fleetCount == 3
    assert kk_shipments.await_count == 2
    kk_shipments.assert_any_await(date_to=date(2026, 2, 28))
    kk_shipments.assert_any_await(date_to=date(2026, 2, 10))
    service.scs_gateway.doa_devices.assert_awaited_once()
    orders.assert_not_awaited()
    assert len(partial_month.faultDetails) == 2
    assert partial_month.faultDetails[0].deviceSn == "SN2"
    assert partial_month.dailyTrend[0].faultCount == 1
    assert sum(item.faultCount for item in partial_month.dailyTrend) == 2
    service.scs_gateway.all.assert_any_await(
        "SCS_CHANGE", changeType="换上,换上-up,换下", serviceOrder="S1,S2"
    )
    service.scs_gateway.all.assert_any_await(
        "SCS_CHANGE", changeType="换上,换上-up,换下", serviceOrder="S2"
    )


async def test_empty_device_scope_does_not_return_a_misleading_zero(monkeypatch):
    monkeypatch.setattr(service.scs_gateway, "doa_devices", AsyncMock(return_value=[]))
    monkeypatch.setattr(service.scs_gateway, "all", AsyncMock(return_value=[]))
    with pytest.raises(DataGatewayError, match="没有数据"):
        await service.build_device_dashboard(MFRFilters(dateFrom="2026-10-01", dateTo="2026-10-29"))


@pytest.mark.parametrize("sales_order", ["SO1", "XNC123"])
async def test_devices_with_yes_doa_are_counted_even_when_pending(monkeypatch, sales_order):
    devices = [device(f"product:{i}", str(i), f"S{i}", f"SN{i}") for i in range(1, 5)]
    for index, item in enumerate(devices, 1):
        item["evidence"][0]["doaCode"] = f"D{index}"
        item["evidence"][0]["doaSalesOrder"] = "" if sales_order.startswith("XNC") else sales_order
        item["evidence"][0]["salesOrder"] = sales_order
    devices[1]["evidence"][0]["judgment"] = "否"
    devices[2]["evidence"][0]["doaStatus"] = "待受理"
    devices[3]["evidence"][0]["judgment"] = ""
    monkeypatch.setattr(service.scs_gateway, "doa_devices", AsyncMock(return_value=devices))
    monkeypatch.setattr(service.scs_gateway, "all", AsyncMock(return_value=[]))
    result = await service.build_device_dashboard(
        MFRFilters(dateFrom="2026-10-01", dateTo="2026-10-29")
    )
    if sales_order.startswith("XNC"):
        assert result.summary.selectedDeviceCount == 2
        assert result.summary.deviceIssues["doaStatusUnresolved"] == 1
    else:
        assert result.summary.selectedDeviceCount == 0
        assert not result.summary.deviceIssues


async def test_old_gateway_reports_missing_device_interface(monkeypatch):
    monkeypatch.setattr(
        service.scs_gateway,
        "doa_devices",
        AsyncMock(side_effect=DataGatewayError("not found", status_code=404)),
    )
    monkeypatch.setattr(service.scs_gateway, "all", AsyncMock(return_value=[]))
    with pytest.raises(DataGatewayError, match="未提供 SCS DOA 设备接口"):
        await service.build_device_dashboard(MFRFilters(dateFrom="2026-10-01", dateTo="2026-10-29"))


def test_fault_date_uses_the_eight_digits_after_kx():
    assert service._fault_date("KX202610310012").isoformat() == "2026-10-31"
    assert service._fault_date("KX202602300012") is None
    assert service._fault_date("KX20261031") is None
