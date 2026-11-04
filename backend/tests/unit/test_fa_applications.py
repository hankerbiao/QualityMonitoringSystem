from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.schemas.fa_applications import FAPreviewRequest, FASubmitRequest
from app.services import fa_application_service as service
from app.services.mail_service import MailSendError


@pytest.mark.asyncio
async def test_fa_pn_denominator_uses_shared_rty_order_exclusions(monkeypatch):
    captured = {}

    async def load_bom(**kwargs):
        captured.update(kwargs)
        return [{"MATNR": "123", "GSTRS": "20261001", "AUFNR_1": "1", "MAKTX": "Material"}]

    monkeypatch.setattr(service.lrr_gateway, "load_bom", load_bom)
    rows, description = await service._pn_bom_rows("123", date(2026, 10, 1), date(2026, 10, 31))

    assert rows[0]["AUFNR_1"] == "1"
    assert description == "Material"
    assert captured["exclude_rty_orders"] is True


def test_preview_requires_a_date_range_for_each_selected_stage():
    with pytest.raises(ValidationError, match="产测计划开始时间开始和结束日期必填"):
        FAPreviewRequest(pn="PN-1", stages=["产测"])

    query = FAPreviewRequest(
        pn=" PN-1 ",
        vendor=" Vendor A ",
        faultDescription=" Fan failure ",
        stages=["DOA"],
        doaDateFrom="2026-10-01",
        doaDateTo="2026-10-31",
    )
    assert query.pn == "PN-1"
    assert query.vendor == "Vendor A"
    assert query.faultDescription == "Fan failure"
    assert query.stages == ["DOA"]


def test_repair_faults_match_exact_material_order_and_planned_month():
    bom_rows = [
        {
            "MATNR": "00000123",
            "GSTRS": "20261001",
            "AUFNR_1": "1",
            "VBELN_EX": "20",
            "LGORT": "1000",
            "_product_model": "Model A",
        }
    ]
    faults = [
        {"_id": "match", "MATNR": "123", "AUFNR": "000000000001", "GSTRS": "20261015"},
        {"_id": "wrong-pn", "MATNR": "456", "AUFNR": "1", "GSTRS": "20261015"},
        # A sales order cannot override a conflicting production order.
        {"_id": "wrong-order", "MATNR": "123", "AUFNR": "2", "VBELN": "20", "GSTRS": "20261015"},
        {"_id": "wrong-month", "MATNR": "123", "AUFNR": "1", "GSTRS": "20260930"},
    ]

    matches = service._matched_repair_faults(bom_rows, faults, "123")

    assert [row[0]["_id"] for row in matches] == ["match"]
    assert matches[0][1] == {
        "productionOrder": "1",
        "model": "Model A",
        "baseCode": "1000",
    }


@pytest.mark.asyncio
async def test_doa_rows_use_only_nonrevoked_swap_outs_in_operation_window(monkeypatch):
    calls = []

    async def all_changes(view_id, **filters):
        calls.append((view_id, filters))
        return [
            {
                "id": "selected",
                "part_number": "00000123",
                "part_sn": "PART-1",
                "part_name": "Spare",
                "device_sn": "DEVICE-1",
                "change_type": "换下",
                "is_revoked": False,
                "raw": {"operation_time": "2026-10-15 09:00:00", "ZRCOD1": "OLD"},
            },
            {
                "id": "swap-in",
                "part_number": "123",
                "change_type": "换上",
                "is_revoked": False,
                "raw": {"operation_time": "2026-10-15"},
            },
            {
                "id": "revoked",
                "part_number": "123",
                "change_type": "换下",
                "is_revoked": True,
                "raw": {"operation_time": "2026-10-15"},
            },
            {
                "id": "outside-range",
                "part_number": "123",
                "change_type": "换下",
                "is_revoked": False,
                "raw": {"operation_time": "2026-11-01"},
            },
        ]

    monkeypatch.setattr(service.scs_gateway, "all", all_changes)
    rows = await service._doa_rows("123", date(2026, 10, 1), date(2026, 10, 31))

    assert calls[0][0] == "SCS_CHANGE"
    assert calls[0][1]["company5000"] == "true"
    assert calls[0][1]["keyword"] == "123"
    assert len(rows) == 1
    assert rows[0]["originalCode"] == "OLD"
    assert rows[0]["reportedDevice"] == "DEVICE-1"


@pytest.mark.asyncio
async def test_repair_rows_read_zmcode1_as_part_serial(monkeypatch):
    bom_rows = [
        {
            "MATNR": "123",
            "GSTRS": "20261001",
            "AUFNR_1": "1",
            "LGORT": "1000",
            "_product_model": "Model A",
        }
    ]
    faults = [
        {
            "_id": "fault-1",
            "MATNR": "123",
            "AUFNR": "1",
            "GSTRS": "20261015",
            "PCODE": "HOST-1",
            "raw": {"ZMCODE1": "PART-SN-1"},
        }
    ]

    async def pn_bom_rows(*_args):
        return bom_rows, "Material"

    async def load_faults(**_kwargs):
        return faults

    from app.api import lrr

    monkeypatch.setattr(service, "_pn_bom_rows", pn_bom_rows)
    monkeypatch.setattr(service.lrr_gateway, "load_faults", load_faults)
    monkeypatch.setattr(
        lrr,
        "aggregate_lrr",
        lambda *_args, **_kwargs: ([SimpleNamespace(issuedQuantity=1, faultCount=1)], None),
    )

    rows, _ = await service._repair_rows("123", date(2026, 10, 1), date(2026, 10, 31))

    assert len(rows) == 1
    assert rows[0]["serialNumber"] == "PART-SN-1"


@pytest.mark.asyncio
async def test_email_recipients_are_normalized_and_cc_deduplicates_to(monkeypatch):
    captured = {}

    async def send_email(**kwargs):
        captured.update(kwargs)
        return {"status": 202}

    monkeypatch.setattr(service, "send_email", send_email)
    result = await service.deliver_application_email(
        to=[" first@example.com ", "first@example.com"],
        cc=["FIRST@example.com", "cc@example.com"],
        subject="",
        content="",
    )

    assert result == {"status": 202}
    assert captured["to"] == ["first@example.com"]
    assert captured["cc"] == ["cc@example.com"]
    assert captured["subject"] == ""
    assert "FA 质量反馈通知" in captured["html_content"]
    assert "（未填写正文）" in captured["html_content"]


def test_application_email_template_escapes_user_content_and_preserves_lines():
    rendered = service.build_application_email_html(
        subject="FA <质量>反馈",
        content="请检查 <物料> & 标签\r\n第二行",
    )

    assert "FA &lt;质量&gt;反馈" in rendered
    assert "请检查 &lt;物料&gt; &amp; 标签<br>第二行" in rendered
    assert "background-color:#eef3f8" in rendered
    assert "<物料>" not in rendered


@pytest.mark.asyncio
async def test_submit_emails_only_selected_fault_details_and_saves_them(monkeypatch):
    from app.api import fa_applications as api

    preview = {
        "materialDescription": "电源 <模块>",
        "repair": {"faultCount": 2},
        "doa": {"faultCount": 2},
        "repairFaults": [
            {"sourceId": "r1", "sn": "REPAIR-SELECTED", "serialNumber": "PART-1", "faultDimension3": "<fault>"},
            {"sourceId": "r2", "sn": "REPAIR-NOT-SELECTED"},
        ],
        "doaChanges": [
            {"sourceId": "d1", "sn": "DOA-SELECTED", "originalCode": "ORIGINAL-1"},
            {"sourceId": "d2", "sn": "DOA-NOT-SELECTED"},
        ],
    }
    sent = AsyncMock(return_value={"status": 202})
    inserted = AsyncMock()
    db = SimpleNamespace(
        fa_application_counters=SimpleNamespace(find_one_and_update=AsyncMock(return_value={"value": 1})),
        fa_applications=SimpleNamespace(insert_one=inserted),
    )
    monkeypatch.setattr(api, "build_preview", AsyncMock(return_value=preview))
    monkeypatch.setattr(api, "get_database", lambda: db)
    monkeypatch.setattr(service, "send_email", sent)
    payload = FASubmitRequest.model_validate({
        "application": {
            "pn": "PN-1", "vendor": "厂商 & A", "faultDescription": "无法启动",
            "stages": ["产测", "DOA"],
            "repairDateFrom": "2026-10-01", "repairDateTo": "2026-10-31",
            "doaDateFrom": "2026-10-01", "doaDateTo": "2026-10-31",
            "selectedRepairIds": ["r1"], "selectedDoaIds": ["d1"],
        },
        "email": {"to": ["person@example.com"], "subject": "反馈", "content": "用户正文"},
    })

    result = await api.submit_application.__wrapped__(payload=payload, current_user={"username": "tester"})

    rendered = sent.await_args.kwargs["html_content"]
    for value in ("用户正文", "PN-1", "厂商 &amp; A", "无法启动", "电源 &lt;模块&gt;",
                  "REPAIR-SELECTED", "PART-1", "&lt;fault&gt;", "DOA-SELECTED", "ORIGINAL-1"):
        assert value in rendered
    assert "REPAIR-NOT-SELECTED" not in rendered
    assert "DOA-NOT-SELECTED" not in rendered
    assert result["repairFaults"] == preview["repairFaults"][:1]
    assert result["doaChanges"] == preview["doaChanges"][:1]
    inserted.assert_awaited_once()


@pytest.mark.asyncio
async def test_submit_does_not_save_when_email_with_details_fails(monkeypatch):
    from fastapi import HTTPException

    from app.api import fa_applications as api

    monkeypatch.setattr(api, "build_preview", AsyncMock(return_value={
        "materialDescription": "", "repair": {}, "doa": {},
        "repairFaults": [{"sourceId": "r1", "sn": "SN-1"}], "doaChanges": [],
    }))
    monkeypatch.setattr(service, "send_email", AsyncMock(side_effect=MailSendError("发送失败")))
    database = AsyncMock()
    monkeypatch.setattr(api, "get_database", database)
    payload = FASubmitRequest.model_validate({
        "application": {
            "pn": "PN-1", "stages": ["产测"], "repairDateFrom": "2026-10-01",
            "repairDateTo": "2026-10-31", "selectedRepairIds": ["r1"], "selectedDoaIds": [],
        },
        "email": {"to": ["person@example.com"], "content": "正文"},
    })

    with pytest.raises(HTTPException, match="申请单未保存"):
        await api.submit_application.__wrapped__(payload=payload, current_user={"username": "tester"})
    database.assert_not_called()
