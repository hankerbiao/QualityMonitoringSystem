"""Resolve DOA devices to verified shipment dates without guessing."""

from collections import Counter, defaultdict
from datetime import date, datetime
from typing import Any

from app.schemas.mfr import MFRDeviceIssueDetail


def _date(value: Any) -> date | None:
    text = str(value or "").strip().replace("/", "-")
    for length, fmt in ((10, "%Y-%m-%d"), (8, "%Y%m%d")):
        try:
            return datetime.strptime(text[:length], fmt).date()
        except ValueError:
            continue
    return None


def is_company_5000(row: dict[str, Any]) -> bool:
    order = str(row.get("doaSalesOrder") or "").strip()
    if not order:
        order = str(row.get("salesOrder") or "").strip()
    return order.startswith("XNC")


def select_devices(
    devices: list[dict[str, Any]],
    valid_doa_codes: set[str],
    unresolved_doa_codes: set[str],
) -> tuple[list[dict[str, Any]], dict[str, int], list[MFRDeviceIssueDetail]]:
    """Select identifiable devices with valid XNC declaration evidence."""
    selected: list[dict[str, Any]] = []
    issues: Counter[str] = Counter()
    issue_details: list[MFRDeviceIssueDetail] = []
    identity_keys: dict[tuple[str, str], set[str]] = defaultdict(set)
    for device in devices:
        for row in device.get("evidence") or []:
            if not isinstance(row, dict):
                continue
            for field in ("contextId", "productBarcode"):
                value = str(row.get(field) or "").strip()
                if value:
                    identity_keys[(field, value)].add(device["deviceKey"])
    ambiguous_ids = {key for keys in identity_keys.values() if len(keys) > 1 for key in keys}
    for device in devices:
        evidence = [
            row
            for row in device.get("evidence") or []
            if isinstance(row, dict) and is_company_5000(row)
        ]
        if not evidence:
            continue
        codes = {str(row.get("doaCode") or "").strip() for row in evidence}
        matched_codes = codes & valid_doa_codes
        if not matched_codes:
            if "" not in codes and not codes & unresolved_doa_codes:
                continue
            reason = "doaStatusUnresolved"
        elif device.get("identityBasis") not in {"product_barcode", "product_context"}:
            reason = "identityUnverified"
        elif device["deviceKey"] in ambiguous_ids:
            reason = "identityConflict"
        else:
            reason = ""

        if reason:
            issues[reason] += 1
            issue_details.append(
                MFRDeviceIssueDetail(
                    reason=reason,
                    deviceKey=device["deviceKey"],
                    deviceSn=str(device.get("deviceSn") or ""),
                    identityBasis=str(device.get("identityBasis") or ""),
                    doaCodes=sorted(codes - {""}),
                    salesOrders=sorted(
                        {
                            value
                            for row in evidence
                            for field in ("doaSalesOrder", "salesOrder")
                            if (value := str(row.get(field) or "").strip())
                        }
                    ),
                    serviceOrders=sorted(
                        {
                            value
                            for row in evidence
                            for raw in [
                                row.get("serviceOrder"),
                                *(row.get("serviceOrderAliases") or []),
                            ]
                            if (value := str(raw or "").strip())
                        }
                    ),
                    declarationStates=sorted(
                        {
                            f"{row.get('doaCode') or '申报单号缺失'} · 判定 {row.get('judgment') or '缺失'} · 状态 {row.get('doaStatus') or '缺失'}"
                            for row in evidence
                        }
                    ),
                )
            )
            continue
        matched_rows = [
            row for row in evidence if str(row.get("doaCode") or "").strip() in matched_codes
        ]
        shipment_dates = {_date(row.get("shipmentDate")) for row in matched_rows}
        shipment = next(iter(shipment_dates)) if len(shipment_dates) == 1 else None
        models = {str(row.get("model") or "").strip() for row in matched_rows} - {""}
        model = next(iter(models)) if len(models) == 1 else "未知机型"
        selected.append(
            {
                **device,
                "shipmentDate": shipment,
                "matchedDoaCodes": matched_codes,
                "orderModel": model,
            }
        )
        for field in ("factoryDate", "warrantyEndDate"):
            value = device.get(field)
            if not isinstance(value, dict) or value.get("status") != "valid":
                issues["lifecycleDateIncomplete"] += 1
                break
    return selected, dict(issues), issue_details
