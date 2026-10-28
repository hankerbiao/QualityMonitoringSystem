"""Monthly reinsert analysis using planned orders and their repair records."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any

from fastapi import HTTPException

from app.base_access import current_base_permissions
from app.services import repair_integration, rty_export
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.data_gateway_client import DataGatewayError, data_gateway
from app.services.lrr_normalization import compact_date
from app.services.rty_shared import normalize_order, order_variants, validate_date

_CACHE = AsyncTTLCache(max_entries=8)
UNKNOWN_COMPONENT = "未填写部件"
UNKNOWN_PN = "未填写PN"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _month(value: Any) -> str:
    value = compact_date(value)
    return f"{value[:4]}-{value[4:6]}" if len(value) >= 6 else ""


def _months(start: str, end: str) -> list[str]:
    year, month = int(start[:4]), int(start[5:7])
    last = end[:7]
    result = []
    while (value := f"{year:04d}-{month:02d}") <= last:
        result.append(value)
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return result


def _component(row: dict) -> str:
    return _text(row.get("ZBJ")) or UNKNOWN_COMPONENT


def _pn(row: dict) -> str:
    return repair_integration.identifier(row.get("ZCCLH")) or UNKNOWN_PN


def _event(row: dict) -> tuple[str, str] | None:
    sn, station = _text(row.get("PCODE")), _text(row.get("ZNGGZ"))
    return (sn, station) if sn and station else None


def _is_reinsert(row: dict) -> bool:
    return "重插" in _text(row.get("ZWXWD3"))


def _rate(count: int, denominator: int | float | None) -> float | None:
    return (
        round(count / denominator * 100, 2) if denominator is not None and denominator > 0 else None
    )


async def load_sources(
    date_from: str,
    date_to: str,
    models: list[str] | None,
    customers: list[str] | None,
    bases: list[str] | None,
) -> tuple[list[dict], list[dict], dict[str, repair_integration.OrderUsage], list[dict]]:
    start, end = validate_date(date_from), validate_date(date_to)
    if start > end:
        raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期")
    key = (
        data_gateway.base_url,
        current_base_permissions(),
        start,
        end,
        tuple(sorted(models or [])),
        tuple(sorted(customers or [])),
        tuple(sorted(bases or [])),
    )

    async def load():
        orders = await rty_export._load_orders(
            {"dateFrom": start, "dateTo": end, "orderScope": "normal"},
            product_models=models,
            customers=customers,
            bases=bases,
            include_all_orders=True,
        )
        by_order: dict[str, dict] = {}
        for row in orders:
            number = normalize_order(row.get("AUFNR"))
            if number in by_order and by_order[number] != row:
                raise DataGatewayError(f"生产订单 {number} 存在冲突记录，无法统计")
            by_order[number] = row
        orders = list(by_order.values())
        numbers = sorted(by_order)
        faults: list[dict] = []
        seen: set[str] = set()
        batches = [
            {
                "productionOrders": ",".join(order_variants(numbers[i : i + 50])),
                "timeField": "planned",
            }
            for i in range(0, len(numbers), 50)
        ]
        async for items in rty_export._source_batches(
            "/api/faults", batches, max_rows=rty_export.MAX_EXPORT_FAULTS
        ):
            for item in items:
                raw = dict(rty_export._source(item))
                number = normalize_order(raw.get("AUFNR") or item.get("productionOrder"))
                if number not in by_order:
                    continue
                identity = _text(item.get("id") or raw.get("_source_key") or raw.get("_id"))
                if identity and identity in seen:
                    continue
                if identity:
                    seen.add(identity)
                raw["_source_id"] = identity
                raw["_order"] = number
                faults.append(raw)
                if len(faults) > rty_export.MAX_EXPORT_FAULTS:
                    raise HTTPException(status_code=413, detail="维修记录超过上限，请缩小筛选范围")

        # Only read BOM for models associated with at least one known reinsert PN.
        needed = {
            (
                str(by_order[f["_order"]].get("LGORT") or ""),
                str(by_order[f["_order"]].get("MAKTX_TH") or ""),
            )
            for f in faults
            if _is_reinsert(f) and _event(f) and _pn(f) != UNKNOWN_PN
        }
        usage_orders = [
            repair_integration.identifier(row.get("AUFNR"))
            for row in orders
            if (str(row.get("LGORT") or ""), str(row.get("MAKTX_TH") or "")) in needed
        ]
        postings = (
            await data_gateway.export_rows(
                "bom", sorted(set(usage_orders)), max_rows=repair_integration.MAX_EXPORT_POSTINGS
            )
            if usage_orders
            else []
        )
        if postings is None:
            raise DataGatewayError("生产数据源不支持 BOM 批量导出")
        posting_groups: dict[str, list[dict]] = defaultdict(list)
        for item in postings:
            raw = dict(repair_integration._posting_source(item))
            number = repair_integration.identifier(raw.get("AUFNR_1"))
            if number not in usage_orders:
                raise DataGatewayError("发料查询返回未选择的生产订单")
            raw["_source_id"] = _text(item.get("id") or raw.get("_source_key") or raw.get("_id"))
            posting_groups[number].append(raw)
        usage = {
            number: repair_integration.aggregate_postings(
                number, [{"id": row["_source_id"], "raw": row} for row in rows]
            )
            for number, rows in posting_groups.items()
        }
        for number, rows in posting_groups.items():
            distinct: dict[str, dict] = {}
            for row in rows:
                distinct.setdefault(row["_source_id"], row)
            posting_groups[number] = list(distinct.values())
        for number in usage_orders:
            usage.setdefault(number, repair_integration.OrderUsage())
        return orders, faults, usage, [row for rows in posting_groups.values() for row in rows]

    return await _CACHE.get_or_set(key, load, ttl_seconds=60)


def _prepare(orders: list[dict], faults: list[dict]) -> tuple[dict, dict]:
    by_order = {normalize_order(row.get("AUFNR")): row for row in orders}
    models: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    for fault in faults:
        if not _is_reinsert(fault) or not _event(fault):
            continue
        order = by_order[fault["_order"]]
        base, model = _text(order.get("LGORT")) or "未知基地", _text(order.get("MAKTX_TH"))
        component, pn = _component(fault), _pn(fault)
        models[(base, component, "")].add(model)
        models[(base, component, pn)].add(model)
    return by_order, models


def _selected_orders(
    orders: list[dict], base: str, month: str, models: set[str] | None
) -> list[dict]:
    return [
        row
        for row in orders
        if (_text(row.get("LGORT")) or "未知基地") == base
        and _month(row.get("GSTRS")) == month
        and (models is None or _text(row.get("MAKTX_TH")) in models)
    ]


def _quantities(
    orders: list[dict], usage: dict, pn: str | None
) -> tuple[int | float | None, int | float | None, str]:
    plan = rty_export._sum_quantity(orders, "GAMNG") if orders else None
    if not pn or pn == UNKNOWN_PN:
        return plan, None, "未填写PN" if pn else ""
    if not orders:
        return plan, None, "无关联订单"
    amounts = []
    matched = False
    for row in orders:
        number = repair_integration.identifier(row.get("AUFNR"))
        item = usage.get(number)
        if item is None or not item.row_count:
            return plan, None, "发料记录不完整"
        if repair_integration.identifier(row.get("VBELN")) and item.sales - {
            repair_integration.identifier(row.get("VBELN"))
        }:
            return plan, None, "发料销售订单不一致"
        matched |= pn in item.quantities
        amounts.append(item.quantities.get(pn, Decimal(0)))
    if not matched:
        return plan, None, "未匹配发料记录"
    total = sum(amounts, Decimal(0))
    return plan, repair_integration.excel_number(total), "净发料量不大于零" if total <= 0 else ""


def _rows_for(
    faults: list[dict], by_order: dict, base: str, month: str, component: str = "", pn: str = ""
) -> list[dict]:
    return [
        row
        for row in faults
        if (_text(by_order[row["_order"]].get("LGORT")) or "未知基地") == base
        and _month(by_order[row["_order"]].get("GSTRS")) == month
        and (not component or _component(row) == component)
        and (not pn or _pn(row) == pn)
    ]


def _cell(rows: list[dict], orders: list[dict], usage: dict, pn: str | None = None) -> dict:
    reinsert = {_event(row) for row in rows if _is_reinsert(row) and _event(row)}
    all_repairs = {_event(row) for row in rows if _event(row)}
    plan, amount, reason = _quantities(orders, usage, pn)
    return {
        "reinsertCount": len(reinsert),
        "repairCount": len(all_repairs),
        "plannedQuantity": plan,
        "plannedRate": _rate(len(reinsert), plan),
        "usageQuantity": amount,
        "usageRate": _rate(len(reinsert), amount),
        "usageReason": reason,
    }


def _group_cells(
    base: str,
    component: str,
    pn: str,
    associated: dict,
    fault_index: dict,
    order_index: dict,
    usage: dict,
    months: list[str],
) -> dict:
    models = associated[(base, component, pn)]
    return {
        month: _cell(
            fault_index.get((base, month, component, pn), []),
            [row for model in models for row in order_index.get((base, month, model), [])],
            usage,
            pn or None,
        )
        for month in months
    }


def aggregate(orders: list[dict], faults: list[dict], usage: dict, start: str, end: str) -> dict:
    by_order, associated = _prepare(orders, faults)
    months = _months(start, end)
    bases = sorted({_text(row.get("LGORT")) or "未知基地" for row in orders})
    order_index: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    fault_index: dict[tuple[str, str, str, str], list[dict]] = defaultdict(list)
    pn_index: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for row in orders:
        base = _text(row.get("LGORT")) or "未知基地"
        order_index[(base, _month(row.get("GSTRS")), _text(row.get("MAKTX_TH")))].append(row)
    for row in faults:
        order = by_order[row["_order"]]
        base = _text(order.get("LGORT")) or "未知基地"
        month, component, pn = _month(order.get("GSTRS")), _component(row), _pn(row)
        fault_index[(base, month, "", "")].append(row)
        fault_index[(base, month, component, "")].append(row)
        fault_index[(base, month, component, pn)].append(row)
        pn_index[(base, month, pn)].append(row)
    result = []
    for base in bases:
        base_faults = [
            row
            for row in faults
            if (_text(by_order[row["_order"]].get("LGORT")) or "未知基地") == base
        ]
        components = sorted({key[1] for key in associated if key[0] == base})
        groups = []
        for component in components:
            pns = sorted(
                {key[2] for key in associated if key[0] == base and key[1] == component and key[2]}
            )
            groups.append(
                {
                    "component": component,
                    "months": _group_cells(
                        base, component, "", associated, fault_index, order_index, usage, months
                    ),
                    "pns": [
                        {
                            "pn": pn,
                            "months": _group_cells(
                                base,
                                component,
                                pn,
                                associated,
                                fault_index,
                                order_index,
                                usage,
                                months,
                            ),
                        }
                        for pn in pns
                    ],
                }
            )
        totals = {
            month: _cell(
                fault_index.get((base, month, "", ""), []),
                [
                    row
                    for (item_base, item_month, _), values in order_index.items()
                    if item_base == base and item_month == month
                    for row in values
                ],
                usage,
            )
            for month in months
        }
        pn_counts: dict[str, set[tuple[str, str, str]]] = defaultdict(set)
        for row in base_faults:
            if _is_reinsert(row) and (event := _event(row)) and _pn(row) != UNKNOWN_PN:
                pn_counts[_pn(row)].add((_month(by_order[row["_order"]].get("GSTRS")), *event))
        top = sorted(pn_counts, key=lambda pn: (-len(pn_counts[pn]), pn))[:5]
        pn_trends = []
        for pn in top:
            pn_models = set().union(
                *(
                    value
                    for (item_base, _, item_pn), value in associated.items()
                    if item_base == base and item_pn == pn
                )
            )
            trend = {}
            for month in months:
                matching = pn_index.get((base, month, pn), [])
                selected = [
                    row for model in pn_models for row in order_index.get((base, month, model), [])
                ]
                trend[month] = _cell(matching, selected, usage, pn)
            pn_trends.append({"pn": pn, "months": trend})
        result.append({"base": base, "months": totals, "components": groups, "topPns": pn_trends})
    return {
        "months": months,
        "bases": result,
        "invalidCount": sum(1 for row in faults if not _event(row)),
        "invalidReinsertCount": sum(1 for row in faults if _is_reinsert(row) and not _event(row)),
    }


def details(
    orders: list[dict],
    faults: list[dict],
    usage: dict,
    postings: list[dict],
    base: str,
    month: str,
    component: str,
    pn: str,
    kind: str,
    page: int,
    page_size: int,
) -> dict:
    by_order, associated = _prepare(orders, faults)
    if kind == "invalid" and not base and not month:
        items = [row for row in faults if not _event(row)]
        return {
            "items": items[(page - 1) * page_size : page * page_size],
            "total": len(items),
            "page": page,
            "pageSize": page_size,
        }
    rows = _rows_for(faults, by_order, base, month, component, pn)
    models = associated.get((base, component, pn), set()) if component else None
    selected = _selected_orders(orders, base, month, models)
    if kind in {"reinsert", "repairs"}:
        events: dict[tuple[str, str], list[dict]] = defaultdict(list)
        for row in rows:
            if (event := _event(row)) and (kind == "repairs" or _is_reinsert(row)):
                events[event].append(row)
        items = [
            {"SN": sn, "NG工站": station, "记录数": len(records), "维修记录": records}
            for (sn, station), records in sorted(events.items())
        ]
    elif kind == "invalid":
        items = [row for row in rows if not _event(row)]
    elif kind == "orders":
        items = selected
    else:
        numbers = {repair_integration.identifier(row.get("AUFNR")) for row in selected}
        items = [
            row
            for row in postings
            if repair_integration.identifier(row.get("AUFNR_1")) in numbers
            and repair_integration.identifier(row.get("MATNR")) == pn
            and _text(row.get("BWART")) in {"261", "262"}
        ]
    total = len(items)
    return {
        "items": items[(page - 1) * page_size : page * page_size],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }
