"""Source-backed RTY template export; unconfirmed metrics remain unavailable."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from math import isfinite
from typing import Any

from fastapi import HTTPException

from app.schemas.rty import RTYTemplateExport, StationPassExport
from app.services import rty_gateway
from app.services.data_gateway_client import DataGatewayError, data_gateway
from app.services.lrr_normalization import compact_date
from app.services.rty_shared import (
    COMPOSITE_MODEL_ITEMS,
    normalize_order,
    order_variants,
    validate_date,
)

MAX_EXPORT_ORDERS = 100_000
MAX_EXPORT_FAULTS = 250_000
ORDER_DETAIL_CONCURRENCY = 8
MatchedFault = tuple[dict[str, Any], set[tuple[str, str]]]
ORDER_FIELDS = (
    "VBELN",
    "POSNR",
    "AUFNR",
    "MAKTX_TH",
    "CPXH",
    "IF_L6",
    "ZSTAT",
    "KID",
    "GAMNG",
    "WMENG",
    "GSTRS",
    "ZDATE_STARTED",
    "AUART",
    "WERKS",
    "LGORT",
    "MATNR",
    "MAKTX",
    "NAME1_ZU",
)
FAULT_FIELDS = (
    "FACTORY",
    "VBELN",
    "AUFNR",
    "ZJXMC",
    "PCODE",
    "ZNGGZ",
    "U_FIND",
    "T_FIND",
    "ZNGWD3",
    "ZNGWD",
    "U_FIX",
    "ZWXDT",
    "ZWXWD3",
    "SECFLG",
    "ZBJ",
    "ZZRFL",
    "ZCCLH",
    "SECOND_PART_NO",
    "FIX_REMARKS",
    "MATNR",
    "MAKTX",
    "ZMCOD1",
    "ZRCOD1",
    "ZMCOD2",
    "ZRCOD2",
    "RECORD01REPAIRM",
    "ERROR_CODE",
    "ERROR_MSG",
    "REJUDGE",
    "RET",
    "RPDESC",
    "RNOTE",
    "U_RMA_NAM",
    "RMA_RESULT",
)


def _source(item: dict[str, Any]) -> dict[str, Any]:
    raw = item.get("raw")
    raw = raw if isinstance(raw, dict) else item
    return raw["data"] if isinstance(raw.get("data"), dict) else raw


def _columns(row: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {
        key: value
        if isinstance(value, (str, int, float, bool))
        and (not isinstance(value, float) or isfinite(value))
        else None
        for key in fields
        for value in [row.get(key)]
    }


def _sum_quantity(rows: list[dict[str, Any]], key: str) -> int | float | None:
    total = Decimal(0)
    for row in rows:
        value = row.get(key)
        if value is None or isinstance(value, bool) or str(value).strip() == "":
            return None
        try:
            number = Decimal(str(value).strip())
        except InvalidOperation:
            return None
        if not number.is_finite() or number < 0:
            return None
        total += number
    return int(total) if total == total.to_integral_value() else float(total)


def _fault_rate(count: int | None, quantity: int | float | None) -> float | None:
    if count is None or quantity is None or quantity <= 0 or count > quantity:
        return None
    return count / quantity


async def _load_orders(
    filters: dict[str, str],
    *,
    product_models: list[str] | None = None,
    bases: list[str] | None = None,
) -> list[dict[str, Any]]:
    gateway_filters = {
        key: value
        for key, value in filters.items()
        if value and key not in {"orderScope", "calculationMethod"}
    }
    items = await data_gateway.all_orders(max_rows=MAX_EXPORT_ORDERS, **gateway_filters)
    start = compact_date(validate_date(filters["dateFrom"]))
    end = compact_date(validate_date(filters["dateTo"]))
    selected_models = set(product_models) if product_models else None
    selected_bases = set(bases) if bases else None
    candidates = []
    for item in items:
        normalized = rty_gateway.normalize_order_row(item)
        planned_date = compact_date(normalized["gstrs_date"])
        if (
            normalized["aufnr"]
            and start <= planned_date <= end
            and (selected_models is None or normalized["data"].get("MAKTX_TH") in selected_models)
            and (selected_bases is None or normalized["data"].get("LGORT") in selected_bases)
        ):
            candidates.append(item)

    rows = []
    # List raw.data is projected: read full documents by source ID before
    # exporting fields or applying rules that depend on source fields.
    for index in range(0, len(candidates), ORDER_DETAIL_CONCURRENCY):
        details = await asyncio.gather(
            *(_full_order(item) for item in candidates[index : index + ORDER_DETAIL_CONCURRENCY]),
            return_exceptions=True,
        )
        for detail in details:
            if isinstance(detail, BaseException):
                raise detail
            normalized = rty_gateway.normalize_order_row(detail)
            data = dict(_source(detail))
            planned_date = compact_date(data.get("GSTRS") or normalized["gstrs_date"])
            if (
                normalized["aufnr"]
                and start <= planned_date <= end
                and rty_gateway._eligible(normalized, filters.get("orderScope", "normal"))
            ):
                if not str(data.get("AUFNR") or "").strip():
                    data["AUFNR"] = normalized["aufnr"]
                rows.append(data)
    return rows


async def _full_order(item: dict[str, Any]) -> dict[str, Any]:
    raw = item.get("raw")
    identity = item.get("id") or (raw.get("_id") if isinstance(raw, dict) else None)
    if not identity:
        raise DataGatewayError("订单缺少数据源 ID，无法读取完整导出字段")
    detail = await data_gateway.order_detail(str(identity))
    full_raw = detail.get("raw") if isinstance(detail, dict) else None
    if not isinstance(full_raw, dict) or not isinstance(full_raw.get("data"), dict):
        raise DataGatewayError("订单详情缺少原始数据，无法完整导出")
    order = detail.get("order")
    return {**item, **(order if isinstance(order, dict) else {}), "raw": full_raw}


async def _child_bindings(
    orders: list[dict[str, Any]],
) -> dict[tuple[str, str], set[tuple[str, str]]]:
    heads: dict[str, set[str]] = defaultdict(set)
    for row in orders:
        model = str(row.get("MAKTX_TH") or "")
        if model in COMPOSITE_MODEL_ITEMS:
            heads[normalize_order(row["AUFNR"])].add(model)
    result: dict[tuple[str, str], set[tuple[str, str]]] = defaultdict(set)
    values = sorted(heads)
    for index in range(0, len(values), 32):
        items = await data_gateway.all_pages(
            "GET",
            "/api/views/ZSGV_ZPP_SERNOLIST",
            filters={"headOrder": ",".join(order_variants(values[index : index + 32]))},
            max_rows=100_000,
        )
        for item in items:
            raw = _source(item)
            head_order = normalize_order(raw.get("AUFNR_HEAD"))
            child_order = normalize_order(raw.get("AUFNR_ITEM"))
            child_sn = str(raw.get("ZCODE_ITEM") or "").strip()
            head_sn = str(raw.get("ZCODE_HEAD") or "").strip()
            if child_order and child_sn and head_sn:
                for model in heads.get(head_order, set()):
                    result[(child_order, child_sn)].add((model, head_sn))
    return result


async def _load_sources(
    filters: dict[str, str],
    *,
    product_models: list[str] | None = None,
    bases: list[str] | None = None,
) -> tuple[list[dict[str, Any]], list[MatchedFault]]:
    start = validate_date(filters["dateFrom"])
    end = validate_date(filters["dateTo"])
    if start > end:
        raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期")
    orders = await _load_orders(filters, product_models=product_models, bases=bases)
    if not orders:
        return [], []

    order_models: dict[str, set[str]] = defaultdict(set)
    for row in orders:
        model = str(row.get("MAKTX_TH") or "")
        order_models[normalize_order(row["AUFNR"])].add(model)
    children = await _child_bindings(orders)
    lookup_orders = sorted(set(order_models) | {order for order, _ in children})
    faults: list[MatchedFault] = []
    seen_ids: set[str] = set()
    for index in range(0, len(lookup_orders), 50):
        items = await data_gateway.all_pages(
            "GET",
            "/api/faults",
            filters={
                "productionOrders": ",".join(order_variants(lookup_orders[index : index + 50])),
                "timeField": "planned",
            },
            max_rows=MAX_EXPORT_FAULTS,
        )
        for item in items:
            raw = _source(item)
            order = normalize_order(raw.get("AUFNR") or item.get("productionOrder"))
            sn = str(raw.get("PCODE") or item.get("hostBarcode") or "").strip()
            matches = {(model, sn) for model in order_models.get(order, set())}
            matches.update(children.get((order, sn), set()))
            # A bound child order can contain unrelated machines.
            if not matches:
                continue
            identity = str(item.get("id") or raw.get("_source_key") or raw.get("_id") or "")
            if identity and identity in seen_ids:
                continue
            if identity:
                seen_ids.add(identity)
            faults.append((_columns(raw, FAULT_FIELDS), matches))
            if len(faults) > MAX_EXPORT_FAULTS:
                raise HTTPException(status_code=413, detail="维修明细超过导出上限，请缩小筛选范围")
    return orders, faults


async def build_template_export(
    filters: dict[str, str],
    *,
    product_models: list[str] | None = None,
    bases: list[str] | None = None,
) -> RTYTemplateExport:
    orders, faults = await _load_sources(filters, product_models=product_models, bases=bases)
    by_model: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in orders:
        by_model[str(row.get("MAKTX_TH") or "")].append(row)

    defect_sns: dict[str, set[str]] = defaultdict(set)
    top_groups: dict[tuple[str, ...], set[str]] = defaultdict(set)
    for raw, matches in faults:
        # Conflicting PNs and material serial numbers cannot identify one part.
        materials = {
            str(raw.get(key) or "").strip()
            for key in ("ZCCLH", "MATNR")
            if str(raw.get(key) or "").strip()
        }
        material = next(iter(materials)) if len(materials) == 1 else ""
        for model, head_sn in matches:
            defect_sns[model].add(head_sn)
            group = (
                model,
                str(raw.get("ZNGWD3") or ""),
                str(raw.get("ZWXWD3") or ""),
                material,
                str(raw.get("MAKTX") or "")
                if material and material == str(raw.get("MATNR") or "").strip()
                else "",
            )
            top_groups[group].add(head_sn)

    quantities = {model: _sum_quantity(rows, "WMENG") for model, rows in by_model.items()}
    summary = []
    for model in sorted(by_model):
        count = None if "" in defect_sns[model] else len(defect_sns[model])
        rate = _fault_rate(count, quantities[model])
        summary.append(
            {
                "model": model,
                "plannedQuantity": _sum_quantity(by_model[model], "GAMNG"),
                "completedQuantity": quantities[model],
                "defectCount": count,
                "completionRate": 1 - rate if rate is not None else None,
            }
        )
    top_problems = []
    for sequence, (group, sns) in enumerate(
        sorted(top_groups.items(), key=lambda item: (-len(item[1]), item[0])), 1
    ):
        model, problem, action, material, description = group
        count = None if "" in sns else len(sns)
        top_problems.append(
            {
                "sequence": sequence,
                "model": model,
                "problem": problem,
                "repairAction": action,
                "material": material,
                "materialDescription": description,
                "serialCount": count,
                "productionQuantity": quantities[model],
                "machineFaultRate": _fault_rate(count, quantities[model]),
            }
        )
    return RTYTemplateExport(
        summary=summary,
        orders=[_columns(row, ORDER_FIELDS) for row in orders],
        faults=[raw for raw, _ in faults],
        topProblems=top_problems,
    )


async def build_source_export(
    filters: dict[str, str],
    *,
    product_models: list[str] | None = None,
    bases: list[str] | None = None,
) -> StationPassExport:
    """Load raw source sheets without computing template summary or TOP rows."""
    orders, faults = await _load_sources(filters, product_models=product_models, bases=bases)
    return StationPassExport(
        orders=[_columns(row, ORDER_FIELDS) for row in orders],
        faults=[raw for raw, _ in faults],
    )
