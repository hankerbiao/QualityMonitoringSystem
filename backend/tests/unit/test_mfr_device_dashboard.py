from unittest.mock import AsyncMock

import pytest

from app.schemas.mfr import MFRFilters
from app.services import mfr_device_dashboard as service
from app.services.data_gateway_client import DataGatewayError


def device(key, order, service_no, serial):
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
                "doaCode": "D1",
                "doaSalesOrder": "SO1",
                "judgment": "是",
                "doaStatus": "已受理",
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


async def test_groups_devices_and_all_associated_replacements_by_plan_date(monkeypatch):
    monkeypatch.setattr(
        service.scs_gateway,
        "doa_devices",
        AsyncMock(
            return_value=[
                device("product:a", "000010349985", "S1", "SN1"),
                device("product:b", "10349986", "S2", "SN2"),
                device("product:c", "10349987", "S2", "SN3"),
            ]
        ),
    )
    monkeypatch.setattr(
        service.data_gateway,
        "all_orders",
        AsyncMock(
            return_value=[
                {
                    "aufnr": "10349985",
                    "plannedStartDate": "2026-01-10",
                    "productionModel": "M1",
                    "salesOrder": "SO1",
                },
                {
                    "aufnr": "10349986",
                    "plannedStartDate": "2026-02-11",
                    "productionModel": "M2",
                    "salesOrder": "SO1",
                },
                {
                    "aufnr": "10349987",
                    "plannedStartDate": "2026-02-12",
                    "productionModel": "M2",
                    "salesOrder": "SO1",
                },
            ]
        ),
    )

    async def rows(view, **kwargs):
        assert view == "SCS_CHANGE"
        values = [
            change("S1", "SN1"),
            change("S1", "SN1", "换上-up"),
            change("S1", "SN1", "换下"),
            change("S1", "SN1", revoked=True),
            change("S2", "SN2"),
            change("S2", ""),
            change("S2", "WRONG"),
            change("S3", "SN4"),
        ]
        return [item for item in values if item["change_type"] == kwargs["changeType"]]

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
    assert len(result.faultDetails) == result.summary.faultCount
    assert [(row.model, row.deviceSn, row.serviceOrder, row.plannedDate, row.occurredAt)
            for row in result.faultDetails] == [
        ("M1", "SN1", "S1", "2026-01-10", "2026-12-01"),
        ("M2", "SN2", "S2", "2026-02-11", "2026-12-01"),
        ("M1", "SN1", "S1", "2026-01-10", "2026-12-01"),
    ]
    assert result.summary.mfrRate is None
    assert result.summary.unmatchedChangeCount == 2
    assert result.summary.deviceIssues["lifecycleDateIncomplete"] == 3
    assert [(x.period, x.fleetCount, x.faultCount) for x in result.trend] == [
        ("2026-01", 1, 2),
        ("2026-02", 2, 1),
    ]
    assert [x.mfrRate for x in result.trend] == [200, None]
    assert result.dailyTrend == []
    one_model = await service.build_device_dashboard(
        MFRFilters(dateFrom="2026-02-01", dateTo="2026-02-28", model="M2")
    )
    assert one_model.summary.fleetCount == 2
    assert len(one_model.faultDetails) == 1
    assert one_model.faultDetails[0].deviceSn == "SN2"
    assert one_model.dailyTrend[10].faultCount == 1
    assert sum(item.faultCount for item in one_model.dailyTrend) == 1
    service.scs_gateway.all.assert_any_await("SCS_CHANGE", changeType="换上")
    service.scs_gateway.all.assert_any_await("SCS_CHANGE", changeType="换上-up")


async def test_empty_device_scope_does_not_return_a_misleading_zero(monkeypatch):
    monkeypatch.setattr(service.scs_gateway, "doa_devices", AsyncMock(return_value=[]))
    monkeypatch.setattr(service.data_gateway, "all_orders", AsyncMock(return_value=[]))
    monkeypatch.setattr(service.scs_gateway, "all", AsyncMock(return_value=[]))
    with pytest.raises(DataGatewayError, match="没有数据"):
        await service.build_device_dashboard(MFRFilters(dateFrom="2026-10-01", dateTo="2026-10-29"))


async def test_only_devices_with_yes_and_not_pending_doa_are_counted(monkeypatch):
    devices = [device(f"product:{i}", str(i), f"S{i}", f"SN{i}") for i in range(1, 5)]
    for index, item in enumerate(devices, 1):
        item["evidence"][0]["doaCode"] = f"D{index}"
    devices[1]["evidence"][0]["judgment"] = "否"
    devices[2]["evidence"][0]["doaStatus"] = "待受理"
    devices[3]["evidence"][0]["judgment"] = ""
    monkeypatch.setattr(service.scs_gateway, "doa_devices", AsyncMock(return_value=devices))
    monkeypatch.setattr(
        service.data_gateway,
        "all_orders",
        AsyncMock(
            return_value=[
                {
                    "aufnr": str(i),
                    "plannedStartDate": "2026-10-01",
                    "productionModel": "M1",
                    "salesOrder": "SO1",
                }
                for i in range(1, 5)
            ]
        ),
    )

    monkeypatch.setattr(service.scs_gateway, "all", AsyncMock(return_value=[]))
    result = await service.build_device_dashboard(
        MFRFilters(dateFrom="2026-10-01", dateTo="2026-10-29")
    )
    assert result.summary.selectedDeviceCount == 1
    assert result.summary.deviceIssues["doaStatusUnresolved"] == 1


async def test_old_gateway_reports_missing_device_interface(monkeypatch):
    monkeypatch.setattr(
        service.scs_gateway,
        "doa_devices",
        AsyncMock(side_effect=DataGatewayError("not found", status_code=404)),
    )
    monkeypatch.setattr(service.data_gateway, "all_orders", AsyncMock(return_value=[]))
    monkeypatch.setattr(service.scs_gateway, "all", AsyncMock(return_value=[]))
    with pytest.raises(DataGatewayError, match="未提供 SCS DOA 设备接口"):
        await service.build_device_dashboard(MFRFilters(dateFrom="2026-10-01", dateTo="2026-10-29"))
