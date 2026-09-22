"""RTY calculations backed by the independent data gateway.

The gateway returns source rows only.  All grouping, SN de-duplication and
composite-model rules live here so the public RTY API remains unchanged.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

from fastapi import HTTPException

from app.schemas.rty import (
    DefectDetail,
    ExcludedOrder,
    RTYData,
    SalesOrderSummary,
    StationPassDetail,
    StationPassRate,
)
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.data_gateway_client import data_gateway
from app.services.lrr_normalization import compact_date
from app.services.rty_shared import (
    COMPOSITE_MODEL_ITEMS,
    EXCLUDED_ORDER_STATUSES,
    EXCLUDED_ORDER_TYPES,
    MAX_BINDING_ROW_COUNT,
    MAX_DETAIL_ROW_COUNT,
    REPAIR_YEAR_END,
    REPAIR_YEAR_START,
    YEAR_END,
    YEAR_START,
    normalize_order,
    order_variants,
    validate_date,
)
from app.services.station_pass_fields import normalize_station_code

MAX_SN_FILTERS = 1000
# The binding endpoint caps its /all response without returning a truncation
# marker. Keep each filtered request small enough that one request cannot hit
# that cap, otherwise composite RTY silently loses bindings.
MAX_BINDING_FILTERS = 32
RTY_CYCLE_CACHE_TTL_SECONDS = 60.0
_RTY_CYCLE_CACHE = AsyncTTLCache()


def _raw(item: dict[str, Any]) -> dict[str, Any]:
    raw = item.get("raw")
    return raw if isinstance(raw, dict) else item


def normalize_order_row(item: dict[str, Any]) -> dict[str, Any]:
    raw = _raw(item)
    nested = raw.get("data") if isinstance(raw.get("data"), dict) else raw
    data = dict(nested)
    for key, value in {
        "VBELN": item.get("salesOrder"),
        "KID": item.get("customerId"),
        "NAME1_ZU": item.get("finalUser"),
        "MAKTX": item.get("materialDescription"),
        "MAKTX_TH": item.get("productionModel"),
        "LGORT": item.get("inventoryLocation"),
        "GSTRS": item.get("plannedStartDate"),
        "WMENG": item.get("orderQuantity"),
    }.items():
        if key not in data and value is not None:
            data[key] = value
    aufnr = str(item.get("aufnr") or data.get("AUFNR") or raw.get("AUFNR") or "").strip()
    return {
        "aufnr": aufnr,
        "data": data,
        "gstrs_date": str(item.get("plannedStartDate") or data.get("GSTRS") or "")[:10],
        "source": item.get("source") or raw.get("source") or "",
    }


def normalize_fault_row(item: dict[str, Any]) -> dict[str, Any]:
    raw = _raw(item)
    return {
        **raw,
        "_id": item.get("id") or raw.get("_source_key") or raw.get("_id"),
        "PCODE": raw.get("PCODE") or item.get("serialNumber") or item.get("hostBarcode") or "",
        "AUFNR": item.get("productionOrder") or raw.get("AUFNR") or "",
        "VBELN": item.get("salesOrder") or raw.get("VBELN") or "",
        "ZDATE_WX": raw.get("ZDATE_WX") or str(item.get("repairAt") or "")[:10].replace("-", ""),
        "ZTIME": raw.get("ZTIME") or "",
        "ZNGGZ": raw.get("ZNGGZ") or item.get("ngStation") or "",
        "ZNGWD": raw.get("ZNGWD") or item.get("errorCode") or "",
        "ZWXWD": raw.get("ZWXWD")
        or item.get("faultDescription")
        or item.get("errorDescription")
        or "",
        "ZJXMC": raw.get("ZJXMC") or item.get("materialDescription") or "",
        "ZUSER": raw.get("ZUSER") or item.get("repairPerson") or "",
    }


async def _orders(filters: dict[str, Any]) -> list[dict[str, Any]]:
    rows = await _order_rows(filters)
    return [
        row for row in rows if row["aufnr"] and _eligible(row, filters.get("orderScope", "normal"))
    ]


async def _order_rows(filters: dict[str, Any]) -> list[dict[str, Any]]:
    gateway_filters = {
        key: value
        for key, value in filters.items()
        if key not in {"orderScope", "calculationMethod"} and value
    }
    rows = [
        normalize_order_row(item)
        for item in await data_gateway.all_orders(max_rows=1_000_000, **gateway_filters)
    ]
    date_from = validate_date(filters["dateFrom"]) if filters.get("dateFrom") else None
    date_to = validate_date(filters["dateTo"]) if filters.get("dateTo") else None
    if date_from or date_to:
        rows = [
            row
            for row in rows
            if row["gstrs_date"]
            and (date_from is None or row["gstrs_date"] >= date_from)
            and (date_to is None or row["gstrs_date"] <= date_to)
        ]
    return rows


def _exclusion_reasons(row: dict[str, Any]) -> list[str]:
    data = row.get("data") or {}
    reasons: list[str] = []
    status = str(data.get("ZSTAT") or "").strip()
    order_type = str(data.get("AUART") or "").strip()
    if status in EXCLUDED_ORDER_STATUSES:
        reasons.append(f"订单状态：{status}")
    if order_type in EXCLUDED_ORDER_TYPES:
        reasons.append(f"订单类型：{order_type}")
    return reasons


def _matches_scope(row: dict[str, Any], scope: str) -> bool:
    data = row.get("data") or {}
    return (str(data.get("IF_L6") or "") == "X") == (scope == "l6")


def _eligible(row: dict[str, Any], scope: str) -> bool:
    return not _exclusion_reasons(row) and _matches_scope(row, scope)


async def excluded_orders(filters: dict[str, Any], page: int, limit: int) -> dict[str, Any]:
    """Return orders excluded by RTY status/type rules within the selected L6 scope."""
    rows = await _order_rows(filters)
    scope = filters.get("orderScope", "normal")
    excluded = [
        row
        for row in rows
        if row["aufnr"] and _matches_scope(row, scope) and _exclusion_reasons(row)
    ]
    excluded.sort(key=lambda row: (row["gstrs_date"], row["aufnr"]), reverse=True)
    page_rows = excluded[(page - 1) * limit : page * limit]
    items = [
        ExcludedOrder(
            id=f"{row.get('source') or 'order'}:{row['aufnr']}",
            time=row["gstrs_date"],
            salesOrder=str((row["data"] or {}).get("VBELN") or ""),
            productionOrder=row["aufnr"],
            productModel=str((row["data"] or {}).get("MAKTX_TH") or ""),
            customer=str((row["data"] or {}).get("KID") or ""),
            base=str((row["data"] or {}).get("LGORT") or ""),
            orderStatus=str((row["data"] or {}).get("ZSTAT") or ""),
            orderType=str((row["data"] or {}).get("AUART") or ""),
            exclusionReasons=_exclusion_reasons(row),
        )
        for row in page_rows
    ]
    return {
        "items": items,
        "total": len(excluded),
        "page": page,
        "limit": limit,
        "has_more": page * limit < len(excluded),
    }


async def _faults(filters: dict[str, Any]) -> list[dict[str, Any]]:
    rows = [normalize_fault_row(item) for item in await data_gateway.all_faults(**filters)]
    return rows


async def _faults_for_sns(
    sns: set[str], *, date_from: str, date_to: str, station: str | None = None
) -> list[dict[str, Any]]:
    """Query repairs in bounded SN batches so URLs and Mongo filters stay manageable."""
    values = sorted(value for value in sns if value)
    chunks = [
        values[index : index + MAX_SN_FILTERS] for index in range(0, len(values), MAX_SN_FILTERS)
    ]
    if not chunks:
        return []
    semaphore = asyncio.Semaphore(12)

    async def fetch(chunk: list[str]) -> list[dict[str, Any]]:
        async with semaphore:
            rows = await data_gateway.fault_rows_by_sns(
                chunk, date_from=date_from, date_to=date_to, station=station or ""
            )
            return [normalize_fault_row(row) for row in rows]

    batches = await asyncio.gather(*(fetch(chunk) for chunk in chunks))
    return [row for batch in batches for row in batch]


async def _faults_for_orders(
    orders: set[str], *, date_from: str, date_to: str, chunk_size: int = 500
) -> list[dict[str, Any]]:
    """Fetch fault rows in bounded batches so URL/query size stays manageable."""
    variants = order_variants(sorted(orders))
    if not variants:
        return []
    chunks = [variants[index : index + chunk_size] for index in range(0, len(variants), chunk_size)]
    semaphore = asyncio.Semaphore(12)

    async def fetch(chunk: list[str]) -> list[dict[str, Any]]:
        async with semaphore:
            return await data_gateway.fault_lookup(
                production_orders=chunk,
                date_from=date_from,
                date_to=date_to,
            )

    rows = await asyncio.gather(*(fetch(chunk) for chunk in chunks))
    return [normalize_fault_row(row) for batch in rows for row in batch]


async def _bindings(filters: dict[str, Any]) -> list[dict[str, Any]]:
    return await data_gateway.all_view("ZSGV_ZPP_SERNOLIST", **filters)


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _date_range(date_from: str | None, date_to: str | None) -> tuple[str, str]:
    start = validate_date(date_from).replace("-", "") if date_from else REPAIR_YEAR_START
    end = validate_date(date_to).replace("-", "") if date_to else REPAIR_YEAR_END
    if start > end:
        raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期")
    return start, end


def _dedup_faults(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, ...]] = set()
    result = []
    for row in rows:
        key = tuple(
            (
                normalize_order(row.get(field))
                if field == "AUFNR"
                else str(row.get(field) or "").strip()
            )
            for field in (
                "PCODE",
                "AUFNR",
                "VBELN",
                "ZDATE_WX",
                "ZTIME",
                "ZNGWD",
                "ZNGGZ",
                "ZWXWD",
                "ZUSER",
            )
        )
        if key not in seen:
            seen.add(key)
            result.append(row)
    return result


async def _fault_sns_by_orders(
    orders: set[str],
    *,
    model: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, set[str]]:
    if not orders:
        return {}
    rows = await _faults_for_orders(
        orders,
        date_from=date_from or REPAIR_YEAR_START,
        date_to=date_to or REPAIR_YEAR_END,
    )
    result: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        order = normalize_order(row.get("AUFNR"))
        sn = str(row.get("PCODE") or "").strip()
        if order and sn:
            result[order].add(sn)
    # Composite models count a child/BOX repair against the bound head SN.
    if model in COMPOSITE_MODEL_ITEMS and orders:
        bindings = await _bindings({"headOrder": ",".join(order_variants(sorted(orders)))})
        item_to_heads: dict[str, set[str]] = defaultdict(set)
        item_order_to_heads: dict[str, set[str]] = defaultdict(set)
        for item in bindings:
            raw = _raw(item)
            head_order = normalize_order(raw.get("AUFNR_HEAD"))
            item_order = str(raw.get("AUFNR_ITEM") or "").strip()
            head_sn = str(raw.get("ZCODE_HEAD") or "").strip()
            item_sn = str(raw.get("ZCODE_ITEM") or "").strip()
            if item_order and head_order:
                item_order_to_heads[normalize_order(item_order)].add(head_order)
            if head_order and head_sn and item_sn:
                item_to_heads[item_sn].add(head_sn)
        if len(bindings) > MAX_BINDING_ROW_COUNT:
            raise HTTPException(
                status_code=413, detail="刀片绑定记录超过上限 100000，请缩小筛选范围"
            )
        if item_order_to_heads:
            child_rows = await _faults_for_orders(
                set(item_order_to_heads),
                date_from=date_from or REPAIR_YEAR_START,
                date_to=date_to or REPAIR_YEAR_END,
            )
            for row in child_rows:
                child_sn = str(row.get("PCODE") or "").strip()
                child_order = normalize_order(row.get("AUFNR"))
                for head_order in item_order_to_heads.get(child_order, set()):
                    result.setdefault(head_order, set()).update(item_to_heads.get(child_sn, set()))
    return result


async def _fault_sns_by_composite_groups(
    groups: dict[str, dict[str, Any]],
    *,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, dict[str, set[str]]]:
    """Resolve all composite groups with one binding query and one child query."""
    if not groups:
        return {}

    head_orders = set().union(*(group["orders"] for group in groups.values()))
    head_faults = await _faults_for_orders(
        head_orders,
        date_from=date_from or REPAIR_YEAR_START,
        date_to=date_to or REPAIR_YEAR_END,
    )
    result: dict[str, dict[str, set[str]]] = {key: defaultdict(set) for key in groups}
    order_to_groups: dict[str, set[str]] = defaultdict(set)
    for key, group in groups.items():
        for order in group["orders"]:
            order_to_groups[normalize_order(order)].add(key)
    for row in head_faults:
        order = normalize_order(row.get("AUFNR"))
        sn = str(row.get("PCODE") or "").strip()
        if not order or not sn:
            continue
        for key in order_to_groups.get(order, set()):
            result[key].setdefault(order, set()).add(sn)

    binding_values = sorted(
        {
            normalize_order(order).zfill(12)
            if normalize_order(order).isdigit()
            else normalize_order(order)
            for order in head_orders
            if normalize_order(order)
        }
    )
    binding_chunks = [
        binding_values[index : index + MAX_BINDING_FILTERS]
        for index in range(0, len(binding_values), MAX_BINDING_FILTERS)
    ]
    binding_batches = await asyncio.gather(
        *(_bindings({"headOrder": ",".join(chunk)}) for chunk in binding_chunks)
    )
    bindings = [item for batch in binding_batches for item in batch]
    if len(bindings) > MAX_BINDING_ROW_COUNT:
        raise HTTPException(status_code=413, detail="刀片绑定记录超过上限 100000，请缩小筛选范围")

    item_to_heads: dict[str, set[str]] = defaultdict(set)
    item_order_to_heads: dict[str, set[str]] = defaultdict(set)
    for item in bindings:
        raw = _raw(item)
        head_order = normalize_order(raw.get("AUFNR_HEAD"))
        item_order = normalize_order(raw.get("AUFNR_ITEM"))
        head_sn = str(raw.get("ZCODE_HEAD") or "").strip()
        item_sn = str(raw.get("ZCODE_ITEM") or "").strip()
        if item_order and head_order:
            item_order_to_heads[item_order].add(head_order)
        if head_order and head_sn and item_sn:
            item_to_heads[item_sn].add(head_sn)
    child_orders = set(item_order_to_heads)
    if not child_orders:
        return result

    child_faults = await _faults_for_orders(
        child_orders,
        date_from=date_from or REPAIR_YEAR_START,
        date_to=date_to or REPAIR_YEAR_END,
    )
    for row in child_faults:
        child_order = normalize_order(row.get("AUFNR"))
        child_sn = str(row.get("PCODE") or "").strip()
        if not child_order or not child_sn:
            continue
        head_sns = item_to_heads.get(child_sn, set())
        for head_order in item_order_to_heads.get(child_order, set()):
            for key in order_to_groups.get(head_order, set()):
                result[key].setdefault(head_order, set()).update(head_sns)
    return result


async def rty_list(
    filters: dict[str, Any], page: int, limit: int, targets: dict[str, float]
) -> dict[str, Any]:
    orders = await _orders(filters)
    group_by = (
        "aufnr"
        if filters.get("productionOrder")
        else "VBELN"
        if filters.get("salesOrder")
        else "KID"
        if filters.get("customer")
        else "MAKTX_TH"
        if filters.get("productModel") not in (None, "all")
        else "LGORT"
        if filters.get("base") not in (None, "all")
        else "VBELN"
    )
    groups: dict[str, dict[str, Any]] = {}
    for row in orders:
        data = row["data"]
        key = str(row["aufnr"] if group_by == "aufnr" else data.get(group_by) or "").strip()
        if not key:
            continue
        group = groups.setdefault(
            key, {"first": row, "input": 0.0, "orders": set(), "sales": set(), "customers": set()}
        )
        group["input"] += _num(data.get("WMENG"))
        group["orders"].add(row["aufnr"])
        group["sales"].add(str(data.get("VBELN") or "").strip())
        group["customers"].add(str(data.get("KID") or "").strip())
    keys = sorted(groups)
    page_keys = keys[(page - 1) * limit : page * limit]
    # Normal models can share one fault query for the whole page. The previous
    # implementation issued one request per group, which made the first page
    # an N+1 request pattern over the gateway.
    page_groups = [groups[key] for key in page_keys]
    normal_orders: set[str] = set()
    for group in page_groups:
        model = str((group["first"].get("data") or {}).get("MAKTX_TH") or "")
        if model not in COMPOSITE_MODEL_ITEMS:
            normal_orders.update(group["orders"])
    shared_faults = await _fault_sns_by_orders(
        normal_orders,
        date_from=filters.get("dateFrom"),
        date_to=filters.get("dateTo"),
    )
    composite_groups = {
        key: groups[key]
        for key in page_keys
        if str((groups[key]["first"].get("data") or {}).get("MAKTX_TH") or "")
        in COMPOSITE_MODEL_ITEMS
    }
    composite_faults = await _fault_sns_by_composite_groups(
        composite_groups,
        date_from=filters.get("dateFrom"),
        date_to=filters.get("dateTo"),
    )
    for key in page_keys:
        group = groups[key]
        model = str((group["first"].get("data") or {}).get("MAKTX_TH") or "")
        fault_map = shared_faults
        if model in COMPOSITE_MODEL_ITEMS:
            fault_map = composite_faults.get(key, {})
        defects = set().union(
            *(fault_map.get(normalize_order(order), set()) for order in group["orders"])
        )
        group["defects"] = defects
        group["model"] = model
    items: list[RTYData] = []
    for key in page_keys:
        group = groups[key]
        first = group["first"]
        data = first["data"]
        inp = round(group["input"])
        defects = len(group["defects"])
        items.append(
            RTYData(
                id=key,
                time=first["gstrs_date"],
                model="复合机型" if group["model"] in COMPOSITE_MODEL_ITEMS else "普通机型",
                productModel=group["model"],
                customer=next(iter(group["customers"]), ""),
                base=str(data.get("LGORT") or ""),
                defectCount=defects,
                inputCount=inp,
                rtyRate=round((1 - defects / inp) * 100, 2) if inp else 100.0,
                targetRate=float(targets.get(group["model"], 100)),
                salesOrder=next(iter(group["sales"]), ""),
                productionOrder=next(iter(group["orders"]), ""),
                salesOrders=sorted(x for x in group["sales"] if x),
                productionOrders=sorted(group["orders"]),
                serialNumbers=sorted(group["defects"]),
                productLine="",
                status="",
            )
        )
    return {
        "items": items,
        "total": len(keys),
        "page": page,
        "limit": limit,
        "has_more": page * limit < len(keys),
    }


async def cycle_data(
    order_scope: str, customer: str | None, targets: dict[str, float]
) -> list[RTYData]:
    key = (order_scope, customer or "", tuple(sorted(targets.items())))
    return await _RTY_CYCLE_CACHE.get_or_set(
        key,
        lambda: _build_cycle_data(order_scope, customer, targets),
        ttl_seconds=RTY_CYCLE_CACHE_TTL_SECONDS,
    )


async def _build_cycle_data(
    order_scope: str, customer: str | None, targets: dict[str, float]
) -> list[RTYData]:
    orders = await _orders(
        {
            "orderScope": order_scope,
            "customer": customer or "",
            "dateFrom": YEAR_START,
            "dateTo": YEAR_END,
        }
    )
    groups: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in orders:
        data = row["data"]
        key = (row["gstrs_date"][:7], str(data.get("MAKTX_TH") or ""), str(data.get("LGORT") or ""))
        group = groups.setdefault(key, {"input": 0.0, "orders": set()})
        group["input"] += _num(data.get("WMENG"))
        group["orders"].add(row["aufnr"])
    normal_orders = {
        order
        for (_month, model, _base), group in groups.items()
        if model not in COMPOSITE_MODEL_ITEMS
        for order in group["orders"]
    }
    # One batched fault read replaces one request per month/model/base group.
    # The response is still raw repair data; grouping and de-duplication stay
    # in this quality service.
    normal_fault_rows = await _faults_for_orders(
        normal_orders, date_from=REPAIR_YEAR_START, date_to=REPAIR_YEAR_END
    )
    normal_faults: dict[str, set[str]] = defaultdict(set)
    for fault in normal_fault_rows:
        order = normalize_order(fault.get("AUFNR"))
        sn = str(fault.get("PCODE") or "").strip()
        if order and sn:
            normal_faults[order].add(sn)
    composite_groups = {
        f"{month}:{model}:{base}": {**group, "model": model}
        for (month, model, base), group in groups.items()
        if model in COMPOSITE_MODEL_ITEMS
    }
    composite_faults_by_key = await _fault_sns_by_composite_groups(
        composite_groups,
        date_from=REPAIR_YEAR_START,
        date_to=REPAIR_YEAR_END,
    )
    rows = []
    for (month, model, base), group in sorted(groups.items()):
        faults = normal_faults
        if model in COMPOSITE_MODEL_ITEMS:
            faults = composite_faults_by_key.get(f"{month}:{model}:{base}", {})
        defect_sns = set().union(*(faults.get(normalize_order(o), set()) for o in group["orders"]))
        inp = round(group["input"])
        defects = len(defect_sns)
        rows.append(
            RTYData(
                id=f"cycle:{month}:{model}:{base}",
                time=month,
                model="复合机型" if model in COMPOSITE_MODEL_ITEMS else "普通机型",
                productModel=model,
                customer=customer or "",
                base=base,
                defectCount=defects,
                inputCount=inp,
                rtyRate=round((1 - defects / inp) * 100, 2) if inp else 100.0,
                targetRate=float(targets.get(model, 100)),
                salesOrders=[],
                productionOrders=[],
                serialNumbers=defect_sns,
                salesOrder="",
                productionOrder="",
                productLine="",
                status="",
            )
        )
    return rows


def _station_dimension_value(raw: dict[str, Any], group_by: str) -> str:
    values = {
        "salesOrder": raw.get("KDAUF") or raw.get("VBELN"),
        "productionOrder": raw.get("AUFNR"),
        "productModel": raw.get("MAKTX_TH"),
    }
    return str(values.get(group_by) or "未关联").strip() or "未关联"


def _matches_station_filters(
    raw: dict[str, Any],
    *,
    serial_number: str | None,
    product_model: str | None,
    base: str | None,
    group_by: str,
    dimension_value: str | None = None,
) -> bool:
    if serial_number and str(raw.get("PCODE") or "").strip() != serial_number.strip():
        return False
    if product_model and str(raw.get("MAKTX_TH") or "").strip() != product_model.strip():
        return False
    if base and str(raw.get("LGORT") or "").strip() != base.strip():
        return False
    return not dimension_value or _station_dimension_value(raw, group_by) == dimension_value


def _station_rows_in_planned_range(
    records: list[dict[str, Any]], start: str, end: str
) -> list[dict[str, Any]]:
    """Keep station samples whose planned start date (GSTRS) is in range."""
    result = []
    for item in records:
        planned_date = compact_date(_station_gstrs_date(item))
        if planned_date and start <= planned_date <= end:
            result.append(item)
    return result


def _station_gstrs_date(item: dict[str, Any]) -> str:
    raw = _raw(item)
    nested = raw.get("data") if isinstance(raw.get("data"), dict) else raw
    return str(nested.get("GSTRS") or raw.get("GSTRS") or "").strip()


async def station_rates(
    date_from: str | None,
    date_to: str | None,
    serial_number: str | None = None,
    product_model: str | None = None,
    base: str | None = None,
    group_by: str = "salesOrder",
) -> list[StationPassRate]:
    start, end = _date_range(date_from, date_to)
    records = await data_gateway.all_station_rows(
        dateFrom=f"{start[:4]}-{start[4:6]}-{start[6:]}",
        dateTo=f"{end[:4]}-{end[4:6]}-{end[6:]}",
        timeField="planned",
    )
    records = _station_rows_in_planned_range(records, start, end)
    by_station: dict[tuple[str, str], dict[str, Any]] = {}
    dimension_sns: dict[str, set[str]] = defaultdict(set)
    for item in records:
        raw = _raw(item)
        sn = str(raw.get("PCODE") or "").strip()
        station = str(
            item.get("stationCode")
            or raw.get("LINE_CODE")
            or raw.get("SPEC")
            or raw.get("OPERATION")
            or ""
        ).strip()
        station = normalize_station_code(station)
        if (
            sn
            and station
            and _matches_station_filters(
                raw,
                serial_number=serial_number,
                product_model=product_model,
                base=base,
                group_by=group_by,
            )
        ):
            dimension_value = _station_dimension_value(raw, group_by)
            by_station.setdefault((dimension_value, station), {"sns": set(), "name": station})[
                "sns"
            ].add(sn)
            dimension_sns[dimension_value].add(sn)
    all_sns = {sn for value in by_station.values() for sn in value["sns"]}
    repairs = await _faults_for_sns(all_sns, date_from=start, date_to=end)
    defect_by_station = {
        (dimension_value, station): {
            str(row.get("PCODE") or "")
            for row in repairs
            if normalize_station_code(str(row.get("ZNGGZ") or "")) == station
            and str(row.get("PCODE") or "") in value["sns"]
        }
        for (dimension_value, station), value in by_station.items()
    }
    dimension_defect_sns: dict[str, set[str]] = defaultdict(set)
    for (dimension_value, _station), defects in defect_by_station.items():
        dimension_defect_sns[dimension_value].update(defects)
    return [
        StationPassRate(
            dimensionValue=dimension_value,
            stationCode=station,
            stationName=value["name"],
            inputCount=len(value["sns"]),
            defectCount=len(defect_by_station.get((dimension_value, station), set())),
            passRate=round(
                (
                    1
                    - len(defect_by_station.get((dimension_value, station), set()))
                    / len(value["sns"])
                )
                * 100,
                2,
            )
            if value["sns"]
            else 100.0,
            totalInputCount=len(dimension_sns[dimension_value]),
            totalDefectCount=len(dimension_defect_sns[dimension_value]),
        )
        for (dimension_value, station), value in sorted(by_station.items())
    ]


async def station_details(
    station: str,
    date_from: str | None,
    date_to: str | None,
    detail_type: str,
    serial_number: str | None = None,
    product_model: str | None = None,
    base: str | None = None,
    group_by: str = "salesOrder",
    dimension_value: str | None = None,
) -> list[StationPassDetail]:
    start, end = _date_range(date_from, date_to)
    records = await data_gateway.all_station_rows(
        dateFrom=f"{start[:4]}-{start[4:6]}-{start[6:]}",
        dateTo=f"{end[:4]}-{end[4:6]}-{end[6:]}",
        timeField="planned",
    )
    records = _station_rows_in_planned_range(records, start, end)
    unique: dict[str, dict[str, Any]] = {}
    for item in records:
        raw = _raw(item)
        sn = str(raw.get("PCODE") or "").strip()
        code = normalize_station_code(
            str(item.get("stationCode") or raw.get("SPEC") or raw.get("OPERATION") or "")
        )
        if (
            sn
            and code == station
            and _matches_station_filters(
                raw,
                serial_number=serial_number,
                product_model=product_model,
                base=base,
                group_by=group_by,
                dimension_value=dimension_value,
            )
        ):
            unique.setdefault(sn, {"raw": raw, "code": code})
    if detail_type == "input":
        return [
            StationPassDetail(
                id=f"{station}:{sn}",
                sn=sn,
                stationCode=station,
                stationName=station,
                passDate=_station_gstrs_date(item),
                status="passed",
            )
            for sn, item in sorted(unique.items())
        ]
    if not unique:
        return []
    repairs = await _faults_for_sns(unique, date_from=start, date_to=end)
    seen: set[str] = set()
    result: list[StationPassDetail] = []
    for row in repairs:
        if normalize_station_code(str(row.get("ZNGGZ") or "")) != station:
            continue
        sn = str(row.get("PCODE") or "").strip()
        if not sn or sn in seen:
            continue
        seen.add(sn)
        result.append(
            StationPassDetail(
                id=f"{station}:{sn}:defect",
                sn=sn,
                stationCode=station,
                stationName=station,
                passDate=_station_gstrs_date(unique[sn]),
                status="defect",
                repairTime=f"{row.get('ZDATE_WX') or ''} {row.get('ZTIME') or ''}".strip(),
                defectCode=str(row.get("ZNGWD") or ""),
                description=str(row.get("ZWXWD") or ""),
                repairPerson=str(row.get("ZUSER") or ""),
            )
        )
    return result


def to_detail(row: dict[str, Any]) -> DefectDetail:
    return DefectDetail(
        id=str(row.get("_id") or ""),
        defectCode=str(row.get("ZNGWD") or row.get("ERROR_CODE") or row.get("ZNGGZ") or "未知"),
        description=str(row.get("ZWXWD") or row.get("ERROR_MSG") or row.get("ZGZMS") or ""),
        count=1,
        sn=str(row.get("PCODE") or ""),
        sale_no=str(row.get("VBELN") or ""),
        mfg_order=str(row.get("AUFNR") or ""),
        product_family=str(row.get("ZJXMC") or row.get("MAKTX") or ""),
        fault_2nd_appear="",
        fault_3rd_appear="",
        repairTime=f"{row.get('ZDATE_WX') or ''} {row.get('ZTIME') or ''}".strip(),
        repairPerson=str(row.get("ZUSER") or ""),
        repair_effectiveness="",
        customer=str(row.get("customer") or ""),
    )


async def details_by_orders(
    orders: set[str],
    model: str | None = None,
    *,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[DefectDetail]:
    if not orders:
        return []

    # The lookup endpoint intentionally returns only order-to-SN associations.
    # Resolve those SNs through the detail endpoint before rendering the modal,
    # otherwise every detail column is blank even though the RTY count is nonzero.
    links = _dedup_faults(
        await _faults_for_orders(
            orders,
            date_from=date_from or YEAR_START,
            date_to=date_to or YEAR_END,
        )
    )
    sns = {str(row.get("PCODE") or "").strip() for row in links}
    detail_rows = await _faults_for_sns(
        sns,
        date_from=date_from or YEAR_START,
        date_to=date_to or YEAR_END,
    )
    rows = _dedup_faults(detail_rows) if detail_rows else links
    return [
        to_detail(row)
        for row in sorted(
            rows,
            key=lambda row: (str(row.get("ZDATE_WX") or ""), str(row.get("ZTIME") or "")),
            reverse=True,
        )[:MAX_DETAIL_ROW_COUNT]
    ]


async def sales_order_summary(
    sales_orders: list[str], order_scope: str, targets: dict[str, float] | None = None
) -> list[SalesOrderSummary]:
    result = []
    for sales_order in sales_orders:
        rows = await _orders({"salesOrder": sales_order, "orderScope": order_scope})
        orders = {row["aufnr"] for row in rows}
        model = str((rows[0]["data"] or {}).get("MAKTX_TH") or "") if rows else None
        faults = await _fault_sns_by_orders(orders, model=model)
        inp = round(sum(_num((row["data"] or {}).get("WMENG")) for row in rows))
        defect_sns = set().union(*(faults.get(normalize_order(o), set()) for o in orders))
        result.append(
            SalesOrderSummary(
                salesOrder=sales_order,
                inputCount=inp,
                defectCount=len(defect_sns),
                rtyRate=round((1 - len(defect_sns) / inp) * 100, 2) if inp else 100.0,
            )
        )
    return result
