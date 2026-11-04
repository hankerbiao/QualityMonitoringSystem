from datetime import date
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.fa_applications import FAPreviewRequest
from app.services import fa_application_service as service


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
