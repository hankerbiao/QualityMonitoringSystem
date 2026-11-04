"""FA application preview, snapshots, and mail delivery."""

from __future__ import annotations

import hashlib
import html
import re
from collections import defaultdict
from datetime import date, datetime
from typing import Any

from app.schemas.fa_applications import FAPreviewRequest
from app.services import lrr_gateway
from app.services.lrr_normalization import (
    month_from_date,
    normalize_material_number,
    normalize_production_order,
    normalize_sales_order,
)
from app.services.mail_service import send_email
from app.services.scs_gateway import scs_gateway

BASE_NAMES = {
    "1000": "天津",
    "2000": "盘锦",
    "3000": "昆山",
    "7000": "太原",
    "8000": "安阳",
    "9000": "桐乡",
    "D000": "大同",
}
EMAIL_PATTERN = re.compile(r"^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$")


def _plain(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _first(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if row.get(key) not in (None, ""):
            return row[key]
    return ""


def _date_key(value: Any) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    digits = re.sub(r"\D", "", _plain(value))
    if len(digits) >= 8:
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    return ""


def _in_range(value: Any, start: date | None, end: date | None) -> bool:
    key = _date_key(value)
    return bool(
        key
        and (start is None or key >= start.isoformat())
        and (end is None or key <= end.isoformat())
    )


def _stable_id(source: str, row: dict[str, Any]) -> str:
    identity = _first(row, "id", "_id", "_source_key", "so_code", "doa_code")
    if identity:
        return f"{source}:{identity}"
    fields = "|".join(_plain(row.get(key)) for key in sorted(row))
    return f"{source}:{hashlib.sha1(fields.encode('utf-8')).hexdigest()}"


def _row_data(row: dict[str, Any]) -> dict[str, Any]:
    nested = row.get("raw")
    if isinstance(nested, dict):
        data = nested.get("data")
        return data if isinstance(data, dict) else nested
    data = row.get("data")
    return data if isinstance(data, dict) else row


def _order_index(bom_rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for row in bom_rows:
        order = normalize_production_order(row.get("AUFNR_1"))
        if not order:
            continue
        index.setdefault(
            order,
            {
                "productionOrder": _plain(row.get("AUFNR_1")),
                "model": _plain(row.get("_product_model") or row.get("MAKTX_TH")),
                "baseCode": _plain(row.get("LGORT")),
            },
        )
    return index


def _matched_repair_faults(
    bom_rows: list[dict[str, Any]], fault_rows: list[dict[str, Any]], pn: str
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    normalized_pn = normalize_material_number(pn)
    groups: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"orders": set(), "sales": set(), "descriptions": set()}
    )
    for bom in bom_rows:
        if normalize_material_number(bom.get("MATNR")) != normalized_pn:
            continue
        month = month_from_date(bom.get("GSTRS"))
        if not month:
            continue
        group = groups[month]
        if order := normalize_production_order(bom.get("AUFNR_1")):
            group["orders"].add(order)
        if sales := normalize_sales_order(bom.get("VBELN_EX")):
            group["sales"].add(sales)
        description = _plain(bom.get("_match_description") or bom.get("MAKTX"))
        if description:
            group["descriptions"].add(" ".join(description.split()).casefold())

    selected: list[tuple[dict[str, Any], dict[str, Any]]] = []
    seen: set[str] = set()
    orders = _order_index(bom_rows)
    for fault in fault_rows:
        month = month_from_date(fault.get("GSTRS"))
        group = groups.get(month)
        if not group:
            continue
        order = normalize_production_order(fault.get("AUFNR"))
        sales = normalize_sales_order(fault.get("VBELN"))
        linked = order in group["orders"] if order else sales in group["sales"]
        if not linked:
            continue

        material_numbers = {
            normalize_material_number(value)
            for field in ("MATNR", "RECORD01REPAIRM")
            if (value := _plain(fault.get(field)))
        }
        if material_numbers:
            if normalized_pn not in material_numbers:
                continue
        else:
            description = " ".join(_plain(fault.get("ZJXMC")).split()).casefold()
            if not description or description not in group["descriptions"]:
                continue

        source_id = _stable_id("repair", fault)
        if source_id in seen:
            continue
        seen.add(source_id)
        metadata = orders.get(order, {}) if order else {}
        selected.append((fault, metadata))
    return selected


async def _pn_bom_rows(pn: str, start: date, end: date) -> tuple[list[dict[str, Any]], str]:
    bom_rows = await lrr_gateway.load_bom(
        material_number=pn,
        planned_date_from=start.isoformat(),
        planned_date_to=end.isoformat(),
        include_order_metadata=True,
        exclude_rty_orders=True,
    )
    bom_rows = [
        row
        for row in bom_rows
        if normalize_material_number(row.get("MATNR")) == normalize_material_number(pn)
        and _in_range(row.get("GSTRS"), start, end)
    ]
    description = next(
        (_plain(row.get("MAKTX")) for row in bom_rows if _plain(row.get("MAKTX"))), ""
    )
    if not description:
        description = (await lrr_gateway.material_descriptions([pn])).get(pn, "")
    return bom_rows, description


def _usage_summary(bom_rows: list[dict[str, Any]]) -> dict[str, Any]:
    from app.api.lrr import aggregate_lrr

    lrr_rows, _ = aggregate_lrr(bom_rows, [], include_details=False)
    issued_quantity = sum(row.issuedQuantity for row in lrr_rows)
    return {"issuedQuantity": issued_quantity}


async def _repair_rows(
    pn: str, start: date, end: date
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    bom_rows, description = await _pn_bom_rows(pn, start, end)
    order_numbers = {str(row.get("AUFNR_1") or "") for row in bom_rows if row.get("AUFNR_1")}
    sales_orders = {str(row.get("VBELN_EX") or "") for row in bom_rows if row.get("VBELN_EX")}
    fault_rows = await lrr_gateway.load_faults(
        production_orders=order_numbers,
        sales_orders=sales_orders,
        date_from=start.isoformat(),
        date_to=end.isoformat(),
        include_details=True,
    )
    matched = _matched_repair_faults(bom_rows, fault_rows, pn)

    # Use the existing LRR aggregation for its established 261/262 posting
    # quantity and fault-count semantics.
    from app.api.lrr import aggregate_lrr

    matched_faults = [row for row, _ in matched]
    lrr_rows, _ = aggregate_lrr(bom_rows, matched_faults, include_details=False)
    issued_quantity = sum(row.issuedQuantity for row in lrr_rows)
    fault_count = sum(row.faultCount or 0 for row in lrr_rows)
    fault_rate = round(fault_count / issued_quantity * 100, 2) if issued_quantity > 0 else None
    details: list[dict[str, Any]] = []
    for fault, metadata in matched:
        raw = _row_data(fault)
        base_code = metadata.get("baseCode") or _plain(fault.get("LGORT"))
        part_serial = _first(
            raw,
            "PART_SN",
            "part_sn",
            "SERIALNUMBER",
            "SERIAL_NO",
            "ZSERIAL",
            "ZZSN",
            "ZMCODE1",
            "RECORD01REPAIRSN",
        )
        noncritical = _first(
            raw,
            "RECORD01REPAIRM",
            "NONKEY_MATNR",
            "NONKEY_MATERIAL",
            "NON_CRITICAL_MATERIAL",
        )
        details.append(
            {
                "sourceId": _stable_id("repair", fault),
                "base": BASE_NAMES.get(base_code, base_code),
                "productionOrder": metadata.get("productionOrder") or _plain(fault.get("AUFNR")),
                "model": metadata.get("model") or _plain(fault.get("MAKTX_TH")),
                "sn": _plain(fault.get("PCODE")),
                "station": _plain(fault.get("ZNGGZ")),
                "ngTime": _plain(_first(raw, "T_FIND", "NG_TIME", "ZNGDT", "ZDATE_NG")),
                "faultDimension3": _plain(fault.get("ZNGWD3")),
                "faultDimension2": _plain(fault.get("ZNGWD2")),
                "repairDimension3": _plain(fault.get("ZWXWD3")),
                "materialNumber": _plain(fault.get("MATNR")) or pn,
                "nonCriticalMaterialNumber": _plain(noncritical),
                "materialDescription": description,
                "serialNumber": _plain(part_serial),
                "originalFactoryCode": _plain(_first(raw, "ZRCOD1", "originalFactoryCode")),
            }
        )
    summary = {
        "issuedQuantity": issued_quantity,
        "faultCount": fault_count,
        "faultRate": fault_rate,
        "materialDescription": description,
    }
    return details, summary


def _operation_time(change: dict[str, Any]) -> Any:
    raw = _row_data(change)
    return _first(
        raw,
        "operation_time",
        "operate_time",
        "operation_at",
        "change_time",
        "create_time",
        "create_at",
    ) or change.get("create_at")


async def _doa_rows(pn: str, start: date, end: date) -> list[dict[str, Any]]:
    changes = await scs_gateway.all(
        "SCS_CHANGE",
        company5000="true",
        keyword=pn,
        dateFrom=start.isoformat(),
        dateTo=end.isoformat(),
    )
    selected: list[dict[str, Any]] = []
    normalized_pn = normalize_material_number(pn)
    for change in changes:
        if change.get("is_revoked") or _plain(change.get("change_type")) != "换下":
            continue
        if normalize_material_number(change.get("part_number")) != normalized_pn:
            continue
        operation_time = _operation_time(change)
        if not _in_range(operation_time, start, end):
            continue
        raw = _row_data(change)
        selected.append(
            {
                "sourceId": _stable_id("doa", change),
                "pn": _plain(change.get("part_number")) or pn,
                "sn": _plain(change.get("part_sn")),
                "spareName": _plain(change.get("part_name")),
                "originalCode": _plain(
                    _first(
                        raw,
                        "original_factory_code",
                        "original_code",
                        "old_factory_code",
                        "old_part_number",
                        "old_material_code",
                        "before_original_code",
                        "ZRCOD1",
                    )
                ),
                "reportedDevice": _plain(change.get("device_sn")),
                "operationTime": _plain(operation_time),
            }
        )
    return selected


async def build_preview(query: FAPreviewRequest) -> dict[str, Any]:
    repair_rows: list[dict[str, Any]] = []
    doa_rows: list[dict[str, Any]] = []
    repair_summary = {
        "issuedQuantity": 0.0,
        "faultCount": 0,
        "faultRate": None,
        "materialDescription": "",
    }
    doa_summary = {"issuedQuantity": 0.0, "faultCount": 0, "faultRate": None}
    description = ""

    if "产测" in query.stages:
        repair_rows, repair_summary = await _repair_rows(
            query.pn,
            query.repairDateFrom,
            query.repairDateTo,  # type: ignore[arg-type]
        )
        description = repair_summary["materialDescription"]
    elif "DOA" in query.stages:
        description = (await lrr_gateway.material_descriptions([query.pn])).get(query.pn, "")

    if "DOA" in query.stages:
        doa_rows = await _doa_rows(query.pn, query.doaDateFrom, query.doaDateTo)  # type: ignore[arg-type]
        doa_summary["faultCount"] = len(doa_rows)
        doa_start, doa_end = query.doaDateFrom, query.doaDateTo
        doa_bom, doa_description = await _pn_bom_rows(query.pn, doa_start, doa_end)  # type: ignore[arg-type]
        doa_usage = _usage_summary(doa_bom)
        doa_summary.update(
            {
                "issuedQuantity": doa_usage["issuedQuantity"],
                "faultRate": round(len(doa_rows) / doa_usage["issuedQuantity"] * 100, 2)
                if doa_usage["issuedQuantity"] > 0
                else None,
            }
        )
        description = description or doa_description

    return {
        "pn": query.pn,
        "materialDescription": description,
        "repair": repair_summary,
        "doa": doa_summary,
        "repairFaults": repair_rows,
        "doaChanges": doa_rows,
    }


def normalize_recipients(values: list[str], *, label: str) -> list[str]:
    unique: dict[str, str] = {}
    for value in values:
        email = value.strip()
        if not email or not EMAIL_PATTERN.fullmatch(email):
            raise ValueError(f"{label}包含无效邮箱：{email or '空值'}")
        unique.setdefault(email.casefold(), email)
    return list(unique.values())


_REPAIR_EMAIL_FIELDS = (
    ("基地", "base"), ("生产订单", "productionOrder"), ("机型", "model"),
    ("设备 SN", "sn"), ("工站", "station"), ("NG 时间", "ngTime"),
    ("不良维度3", "faultDimension3"), ("不良维度2", "faultDimension2"),
    ("维修维度3", "repairDimension3"), ("物料号", "materialNumber"),
    ("非关键物料号", "nonCriticalMaterialNumber"), ("物料描述", "materialDescription"),
    ("序列号", "serialNumber"), ("替换前原厂码", "originalFactoryCode"),
)
_DOA_EMAIL_FIELDS = (
    ("PN", "pn"), ("SN", "sn"), ("备件名称", "spareName"),
    ("原厂原码", "originalCode"), ("报修设备", "reportedDevice"),
    ("操作时间", "operationTime"),
)


def _email_field_grid(fields: list[tuple[str, Any]]) -> str:
    cells = []
    for label, value in fields:
        safe_label = html.escape(label)
        safe_value = html.escape(str(value) if value is not None and value != "" else "—")
        safe_value = safe_value.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>")
        cells.append(
            '<td width="50%" valign="top" style="width:50%;padding:5px 8px;'
            'font-size:13px;line-height:1.6;word-break:break-word;">'
            f'<span style="color:#64748b;">{safe_label}：</span>'
            f'<span style="color:#1e293b;">{safe_value}</span></td>'
        )
    rows = "".join(
        f"<tr>{''.join(cells[index:index + 2])}{'<td></td>' if index + 1 == len(cells) else ''}</tr>"
        for index in range(0, len(cells), 2)
    )
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">{rows}</table>'


def _email_fault_section(
    title: str, rows: list[dict[str, Any]], fields: tuple[tuple[str, str], ...]
) -> str:
    if not rows:
        return ""
    items = "".join(
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="margin:0 0 10px;border:1px solid #e2e8f0;background-color:#ffffff;">'
        f'<tr><td style="padding:8px 12px;background-color:#f1f5f9;color:#334155;'
        f'font-size:13px;font-weight:600;">{html.escape(title)} {index}</td></tr>'
        f'<tr><td style="padding:6px;">{_email_field_grid([(label, row.get(key)) for label, key in fields])}</td></tr></table>'
        for index, row in enumerate(rows, 1)
    )
    return (
        f'<h2 style="margin:22px 0 10px;font-size:15px;color:#0f172a;">'
        f'{html.escape(title)}（{len(rows)} 条）</h2>{items}'
    )


def build_application_email_html(
    *,
    subject: str,
    content: str,
    application: dict[str, Any] | None = None,
    repair_faults: list[dict[str, Any]] | None = None,
    doa_changes: list[dict[str, Any]] | None = None,
) -> str:
    safe_subject = html.escape(subject.strip() or "FA 质量反馈通知")
    safe_content = html.escape(content).replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>")
    if not safe_content:
        safe_content = '<span style="color:#94a3b8;">（未填写正文）</span>'
    application_html = ""
    if application is not None:
        application_html = (
            '<h2 style="margin:22px 0 10px;font-size:15px;color:#0f172a;">申请信息</h2>'
            + _email_field_grid(list(application.items()))
        )
    details_html = (
        application_html
        + _email_fault_section("产测故障", repair_faults or [], _REPAIR_EMAIL_FIELDS)
        + _email_fault_section("DOA 换下明细", doa_changes or [], _DOA_EMAIL_FIELDS)
    )
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#eef3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#1e293b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef3f8;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="800" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:800px;background-color:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden;">
        <tr><td style="height:5px;background-color:#2563eb;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:22px 28px 18px;border-bottom:1px solid #e8eef5;">
          <p style="margin:0 0 7px;color:#2563eb;font-size:11px;font-weight:700;letter-spacing:1px;">QUALIBOARD · FA</p>
          <h1 style="margin:0;font-size:21px;line-height:1.45;color:#0f172a;font-weight:700;">{safe_subject}</h1>
          <p style="margin:8px 0 0;color:#64748b;font-size:13px;line-height:1.6;">FA 质量反馈与申请信息</p>
        </td></tr>
        <tr><td style="padding:24px 28px 26px;">
          <p style="margin:0 0 12px;color:#475569;font-size:13px;font-weight:600;">邮件正文</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #3b82f6;border-radius:6px;">
            <tr><td style="padding:18px 20px;color:#334155;font-size:14px;line-height:1.85;word-break:break-word;">{safe_content}</td></tr>
          </table>
          {details_html}
        </td></tr>
        <tr><td style="padding:14px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px;line-height:1.6;">
          本邮件由 QualiBoard FA 看板发送，请勿直接回复系统邮箱。
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>""".strip()


async def deliver_application_email(
    *,
    to: list[str],
    cc: list[str],
    subject: str,
    content: str,
    application: dict[str, Any] | None = None,
    repair_faults: list[dict[str, Any]] | None = None,
    doa_changes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    to_addresses = normalize_recipients(to, label="收件人")
    cc_addresses = normalize_recipients(cc, label="抄送人")
    to_keys = {value.casefold() for value in to_addresses}
    cc_addresses = [value for value in cc_addresses if value.casefold() not in to_keys]
    return await send_email(
        subject=subject.strip(),
        html_content=build_application_email_html(
            subject=subject, content=content, application=application,
            repair_faults=repair_faults, doa_changes=doa_changes,
        ),
        to=to_addresses,
        cc=cc_addresses,
    )
