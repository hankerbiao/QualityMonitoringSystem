"""RTY calculations backed by the independent data gateway.

The gateway returns source rows only.  All grouping, SN de-duplication and
composite-model rules live here so the public RTY API remains unchanged.
"""

from __future__ import annotations

import asyncio
import calendar
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from types import MappingProxyType
from typing import Any, TypeVar

from fastapi import HTTPException

from app.base_access import base_allowed, canonical_base, current_base_permissions
from app.schemas.rty import (
    DefectDetail,
    ExcludedOrder,
    RTYData,
    SalesOrderSummary,
    StationPassDetail,
    StationPassRate,
)
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.data_gateway_client import DataGatewayError, data_gateway
from app.services.lrr_normalization import compact_date
from app.services.rty_shared import (
    COMPOSITE_MODEL_ITEMS,
    EXCLUDED_ORDER_STATUSES,
    EXCLUDED_ORDER_TYPES,
    MAX_BINDING_ROW_COUNT,
    MAX_DETAIL_ROW_COUNT,
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
RTY_LIST_CACHE_TTL_SECONDS = 15.0
_RTY_CYCLE_CACHE = AsyncTTLCache()
_RTY_LIST_CACHE = AsyncTTLCache()
_ORDER_OWNERSHIP_CACHE = AsyncTTLCache(max_entries=4, copy_values=False)
_ORDER_SCOPE_CACHE = AsyncTTLCache(max_entries=64, copy_values=False)
_GroupKey = TypeVar("_GroupKey")
NO_CUSTOMER_ID = "__NO_CUSTOMER_ID__"


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
        "GAMNG": item.get("orderQuantity"),
        "WMENG": item.get("storageQuantity"),
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


def _selected_order_types(filters: dict[str, Any]) -> set[str]:
    return {value.strip() for value in str(filters.get("orderTypes") or filters.get("orderType") or "").split(",") if value.strip()}


async def _order_rows(filters: dict[str, Any]) -> list[dict[str, Any]]:
    if current_base_permissions() == ():
        return []
    gateway_filters = {
        key: value
        for key, value in filters.items()
        if key not in {"orderScope", "calculationMethod", "orderType", "orderTypes", "_productModels", "_bases", "_customers"} and value
    }
    rows = [
        normalize_order_row(item)
        for item in await data_gateway.all_orders(max_rows=1_000_000, **gateway_filters)
    ]
    rows = [row for row in rows if base_allowed(row["data"].get("LGORT"))]
    order_types = _selected_order_types(filters)
    if order_types:
        rows = [row for row in rows if str(row["data"].get("AUART") or "").strip() in order_types]
    models = set(filters.get("_productModels") or [])
    bases = set(filters.get("_bases") or [])
    customers = set(filters.get("_customers") or [])
    no_customer = NO_CUSTOMER_ID in customers
    customers.discard(NO_CUSTOMER_ID)
    if models:
        rows = [row for row in rows if row["data"].get("MAKTX_TH") in models]
    if bases:
        rows = [row for row in rows if row["data"].get("LGORT") in bases]
    if customers or no_customer:
        rows = [
            row
            for row in rows
            if str(row["data"].get("KID") or "").strip() in customers
            or (no_customer and not str(row["data"].get("KID") or "").strip())
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
    rows = [
        normalize_fault_row(item)
        for item in await data_gateway.all_faults(**{**filters, "timeField": "planned"})
    ]
    return rows


async def _faults_for_sns(
    sns: set[str],
    *,
    date_from: str = "",
    date_to: str = "",
    station: str | None = None,
    time_field: str = "planned",
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
            filters: dict[str, Any] = {
                "date_from": date_from,
                "date_to": date_to,
                "station": station or "",
            }
            if time_field:
                filters["time_field"] = time_field
            rows = await data_gateway.fault_rows_by_sns(chunk, **filters)
            return [normalize_fault_row(row) for row in rows]

    batches = await asyncio.gather(*(fetch(chunk) for chunk in chunks))
    return [row for batch in batches for row in batch]


def _repair_gstrs_date(row: dict[str, Any]) -> str:
    raw = _raw(row)
    nested = raw.get("data") if isinstance(raw.get("data"), dict) else raw
    return str(nested.get("GSTRS") or raw.get("GSTRS") or "").strip()


async def _station_repairs_for_sns(
    sns: set[str], *, date_from: str, date_to: str
) -> list[dict[str, Any]]:
    """Return station repairs whose planned start (GSTRS) is in range."""
    rows = await _faults_for_sns(
        sns,
        date_from=date_from,
        date_to=date_to,
        time_field="planned",
    )
    return [
        row
        for row in rows
        if (planned_date := compact_date(_repair_gstrs_date(row)))
        and date_from <= planned_date <= date_to
    ]


async def _faults_for_orders(
    orders: set[str], *, chunk_size: int = 500
) -> list[dict[str, Any]]:
    """Join selected orders to all faults, without filtering repair dates."""
    variants = order_variants(sorted(orders))
    if not variants:
        return []
    chunks = [variants[index : index + chunk_size] for index in range(0, len(variants), chunk_size)]
    semaphore = asyncio.Semaphore(12)

    async def fetch(chunk: list[str]) -> list[dict[str, Any]]:
        async with semaphore:
            return await data_gateway.fault_lookup(
                production_orders=chunk,
                time_field="planned",
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
    start = (validate_date(date_from) if date_from else YEAR_START).replace("-", "")
    end = (validate_date(date_to) if date_to else YEAR_END).replace("-", "")
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
                "ZNGWD",
                "ZNGGZ",
                "ZWXWD",
                "ZUSER",
            )
        )
        if row.get("_id"):
            key = ("id", str(row["_id"]))
        if key not in seen:
            seen.add(key)
            result.append(row)
    return result


async def _fault_sns_by_orders(
    orders: set[str],
    *,
    model: str | None = None,
) -> dict[str, set[str]]:
    if not orders:
        return {}
    rows = await _faults_for_orders(orders)
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
            child_rows = await _faults_for_orders(set(item_order_to_heads))
            for row in child_rows:
                child_sn = str(row.get("PCODE") or "").strip()
                child_order = normalize_order(row.get("AUFNR"))
                for head_order in item_order_to_heads.get(child_order, set()):
                    result.setdefault(head_order, set()).update(item_to_heads.get(child_sn, set()))
    return result


@dataclass
class CompositeFaults:
    by_order: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    source_sns: set[str] = field(default_factory=set)


async def _fault_sns_by_composite_groups(
    groups: dict[_GroupKey, dict[str, Any]],
) -> dict[_GroupKey, CompositeFaults]:
    """Resolve all composite groups with one binding query and one child query."""
    if not groups:
        return {}

    head_orders = set().union(*(group["orders"] for group in groups.values()))
    head_faults = await _faults_for_orders(head_orders)
    result = {key: CompositeFaults() for key in groups}
    order_to_groups: dict[str, set[_GroupKey]] = defaultdict(set)
    for key, group in groups.items():
        for order in group["orders"]:
            order_to_groups[normalize_order(order)].add(key)
    for row in head_faults:
        order = normalize_order(row.get("AUFNR"))
        sn = str(row.get("PCODE") or "").strip()
        if not order or not sn:
            continue
        for key in order_to_groups.get(order, set()):
            result[key].by_order[order].add(sn)
            result[key].source_sns.add(sn)

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

    child_faults = await _faults_for_orders(child_orders)
    for row in child_faults:
        child_order = normalize_order(row.get("AUFNR"))
        child_sn = str(row.get("PCODE") or "").strip()
        if not child_order or not child_sn:
            continue
        head_sns = item_to_heads.get(child_sn, set())
        if not head_sns:
            continue
        for head_order in item_order_to_heads.get(child_order, set()):
            for key in order_to_groups.get(head_order, set()):
                result[key].by_order[head_order].update(head_sns)
                result[key].source_sns.add(child_sn)
    return result


async def rty_list(
    filters: dict[str, Any], page: int, limit: int, targets: dict[str, float]
) -> dict[str, Any]:
    key = (
        current_base_permissions(),
        tuple(sorted((name, str(value)) for name, value in filters.items())),
        page,
        limit,
        tuple(sorted(targets.items())),
    )
    return await _RTY_LIST_CACHE.get_or_set(
        key,
        lambda: _build_rty_list(filters, page, limit, targets),
        ttl_seconds=RTY_LIST_CACHE_TTL_SECONDS,
    )


async def _build_rty_list(
    filters: dict[str, Any], page: int, limit: int, targets: dict[str, float]
) -> dict[str, Any]:
    orders = await _orders(filters)
    group_by = (
        "aufnr"
        if filters.get("productionOrder")
        else "VBELN"
        if filters.get("salesOrder")
        else "KID"
        if filters.get("customer") or filters.get("_customers")
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
        if group_by == "KID" and not key:
            key = NO_CUSTOMER_ID
        if not key:
            continue
        group = groups.setdefault(
            key, {"first": row, "input": 0.0, "orders": set(), "sales": set(), "customers": set()}
        )
        group["input"] += _num(data.get("GAMNG"))
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
    shared_faults = await _fault_sns_by_orders(normal_orders)
    composite_groups = {
        key: groups[key]
        for key in page_keys
        if str((groups[key]["first"].get("data") or {}).get("MAKTX_TH") or "")
        in COMPOSITE_MODEL_ITEMS
    }
    composite_faults = await _fault_sns_by_composite_groups(composite_groups)
    for key in page_keys:
        group = groups[key]
        model = str((group["first"].get("data") or {}).get("MAKTX_TH") or "")
        fault_map = shared_faults
        composite = composite_faults.get(key)
        if model in COMPOSITE_MODEL_ITEMS:
            fault_map = composite.by_order if composite else {}
        defects = set().union(
            *(fault_map.get(normalize_order(order), set()) for order in group["orders"])
        )
        group["defects"] = defects
        group["fault_sns"] = sorted(composite.source_sns) if composite else None
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
                faultSerialNumbers=group["fault_sns"],
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
    order_scope: str,
    customer: str | None,
    targets: dict[str, float],
    *,
    customers: list[str] | None = None,
    date_from: str = YEAR_START,
    date_to: str = YEAR_END,
    order_type: str | None = None,
    order_types: list[str] | None = None,
) -> list[RTYData]:
    selected_customers = sorted(
        {
            value.strip()
            for value in [*(customers or []), customer]
            if value and value.strip()
        }
    )
    key = (
        current_base_permissions(),
        order_scope,
        tuple(selected_customers),
        date_from,
        date_to,
        order_type or "",
        tuple(sorted(set(order_types or []))),
        tuple(sorted(targets.items())),
    )
    return await _RTY_CYCLE_CACHE.get_or_set(
        key,
        lambda: _build_cycle_data(
            order_scope, selected_customers, targets, date_from, date_to, order_type, order_types
        ),
        ttl_seconds=RTY_CYCLE_CACHE_TTL_SECONDS,
    )


async def _rty_order_groups(
    orders: list[dict[str, Any]], *, group_by: str | None = None
) -> dict[tuple[str, str, str, str], dict[str, Any]]:
    """Share cycle RTY grouping and order-linked faults with station summaries."""
    groups: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for row in orders:
        data = row["data"]
        dimension = (
            _station_dimension_value({**data, "AUFNR": row["aufnr"]}, group_by)
            if group_by
            else ""
        )
        model = str(data.get("MAKTX_TH") or "")
        key = (dimension, row["gstrs_date"][:7], model, str(data.get("LGORT") or ""))
        group = groups.setdefault(key, {"input": 0.0, "orders": set(), "model": model})
        group["input"] += _num(data.get("GAMNG"))
        group["orders"].add(row["aufnr"])
    normal_orders = {
        order
        for group in groups.values()
        if group["model"] not in COMPOSITE_MODEL_ITEMS
        for order in group["orders"]
    }
    composite_groups = {
        key: group for key, group in groups.items() if group["model"] in COMPOSITE_MODEL_ITEMS
    }
    normal_faults, composite_faults = await asyncio.gather(
        _fault_sns_by_orders(normal_orders),
        _fault_sns_by_composite_groups(composite_groups),
    )
    for key, group in groups.items():
        faults = normal_faults
        composite = composite_faults.get(key)
        if group["model"] in COMPOSITE_MODEL_ITEMS:
            faults = composite.by_order if composite else {}
        group["defects"] = set().union(
            *(faults.get(normalize_order(order), set()) for order in group["orders"])
        )
        group["fault_sns"] = composite.source_sns if composite else None
    return groups


async def _build_cycle_data(
    order_scope: str,
    customers: list[str] | str | None,
    targets: dict[str, float],
    date_from: str,
    date_to: str,
    order_type: str | None = None,
    order_types: list[str] | None = None,
) -> list[RTYData]:
    selected_customers = (
        [customers] if isinstance(customers, str) and customers else customers or []
    )
    orders = await _orders(
        {
            "orderScope": order_scope,
            "_customers": selected_customers,
            "dateFrom": date_from,
            "dateTo": date_to,
            "orderType": order_type or "",
            "orderTypes": ",".join(order_types or []),
        }
    )
    groups = await _rty_order_groups(orders)
    rows = []
    for (_dimension, month, model, base), group in sorted(groups.items()):
        inp = round(group["input"])
        defects = len(group["defects"])
        rows.append(
            RTYData(
                id=f"cycle:{month}:{model}:{base}",
                time=month,
                model="复合机型" if model in COMPOSITE_MODEL_ITEMS else "普通机型",
                productModel=model,
                customer=selected_customers[0] if len(selected_customers) == 1 else "",
                base=base,
                defectCount=defects,
                inputCount=inp,
                rtyRate=round((1 - defects / inp) * 100, 2) if inp else 100.0,
                targetRate=float(targets.get(model, 100)),
                salesOrders=[],
                productionOrders=[],
                serialNumbers=sorted(group["defects"]),
                faultSerialNumbers=(
                    sorted(group["fault_sns"]) if group["fault_sns"] is not None else None
                ),
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
        "productModel": raw.get("MAKTX_TH") or raw.get("ZJXMC") or raw.get("MAKTX"),
    }
    return str(values.get(group_by) or "未关联").strip() or "未关联"


def _matches_station_filters(
    raw: dict[str, Any],
    *,
    serial_number: str | None,
    product_models: list[str] | None,
    bases: list[str] | None,
    customers: list[str] | None,
    group_by: str,
    order_scope: str = "normal",
    dimension_value: str | None = None,
    scope_orders: set[str] | None = None,
) -> bool:
    if not base_allowed(raw.get("LGORT")):
        return False
    if serial_number and str(raw.get("PCODE") or "").strip() != serial_number.strip():
        return False
    if product_models and str(raw.get("MAKTX_TH") or "").strip() not in product_models:
        return False
    if bases and str(raw.get("LGORT") or "").strip() not in bases:
        return False
    if customers and scope_orders is None:
        customer = str(raw.get("KID") or "").strip()
        include_empty = NO_CUSTOMER_ID in customers
        selected = set(customers) - {NO_CUSTOMER_ID}
        if customer not in selected and not (include_empty and not customer):
            return False
    if scope_orders is not None:
        order = normalize_order(raw.get("AUFNR"))
        if not order or order not in scope_orders:
            return False
    elif (str(raw.get("IF_L6") or "") == "X") != (order_scope == "l6"):
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


async def _station_records_in_range(
    start: str, end: str, *, serial_number: str | None
) -> list[dict[str, Any]]:
    """Read long station ranges in calendar-month windows below the stream cap."""
    start_date = datetime.strptime(start, "%Y%m%d").date()
    end_date = datetime.strptime(end, "%Y%m%d").date()
    months: list[tuple[str, str]] = []
    cursor = start_date.replace(day=1)
    while cursor <= end_date:
        month_end = cursor.replace(day=calendar.monthrange(cursor.year, cursor.month)[1])
        window_start = max(start_date, cursor)
        window_end = min(end_date, month_end)
        months.append((window_start.isoformat(), window_end.isoformat()))
        cursor = (month_end + timedelta(days=1)).replace(day=1)

    semaphore = asyncio.Semaphore(4)

    async def read_month(month_start: str, month_end: str) -> list[dict[str, Any]]:
        async with semaphore:
            return await data_gateway.all_station_rows(
                dateFrom=month_start,
                dateTo=month_end,
                timeField="planned",
                sn=serial_number or "",
            )

    batches = await asyncio.gather(*(read_month(*window) for window in months))
    return [row for batch in batches for row in batch]


async def station_rates(
    date_from: str | None,
    date_to: str | None,
    serial_number: str | None = None,
    product_models: list[str] | None = None,
    bases: list[str] | None = None,
    group_by: str = "salesOrder",
    order_scope: str = "normal",
    customers: list[str] | None = None,
    overseas: bool = False,
    product_model: str | None = None,
    base: str | None = None,
    customer: str | None = None,
    order_types: list[str] | None = None,
    serial_numbers: list[str] | None = None,
    production_orders: list[str] | None = None,
    sales_orders: list[str] | None = None,
) -> list[StationPassRate]:
    if current_base_permissions() == ():
        return []
    from app.services import advanced_filters

    start, end = _date_range(date_from, date_to)
    serial_values = advanced_filters.values(serial_numbers)
    production_values = {normalize_order(value) for value in advanced_filters.values(production_orders)}
    sales_values = {advanced_filters.normalize_sales_order(value) for value in advanced_filters.values(sales_orders)}
    date_from_iso = f"{start[:4]}-{start[4:6]}-{start[6:]}"
    date_to_iso = f"{end[:4]}-{end[4:6]}-{end[6:]}"
    # Orders determine the eligible population and the summary fault count.
    selected_models = {value.strip() for value in [*(product_models or []), product_model] if value and value.strip()}
    selected_bases = {value.strip() for value in [*(bases or []), base] if value and value.strip()}
    selected_customers = {value.strip() for value in [*(customers or []), customer] if value and value.strip()}
    include_empty_customer = NO_CUSTOMER_ID in selected_customers
    selected_customers.discard(NO_CUSTOMER_ID)
    records, orders = await asyncio.gather(
        _station_records_in_range(start, end, serial_number=serial_number),
        # Reuse cycle RTY grouping below; individual station metrics stay separate.
        _orders(
            {
                "dateFrom": date_from_iso,
                "dateTo": date_to_iso,
                "serialNumber": serial_number or "",
                "orderScope": order_scope,
                "overseas": "true" if overseas else "",
                "orderTypes": ",".join(order_types or []),
            }
        ),
    )
    orders = [
        row for row in orders
        if advanced_filters.order_matches(row["aufnr"], row["data"].get("VBELN"), production_values, sales_values)
        and (not selected_models or str(row["data"].get("MAKTX_TH") or "").strip() in selected_models)
        and (not selected_bases or str(row["data"].get("LGORT") or "").strip() in selected_bases)
        and (
            not selected_customers
            and not include_empty_customer
            or str(row["data"].get("KID") or "").strip() in selected_customers
            or include_empty_customer and not str(row["data"].get("KID") or "").strip()
        )
    ]
    records = _station_rows_in_planned_range(records, start, end)
    if serial_values:
        records = [item for item in records if str(_raw(item).get("PCODE") or "").strip() in serial_values]
    if serial_values:
        selected_orders = {normalize_order(_raw(item).get("AUFNR")) for item in records}
        orders = [row for row in orders if normalize_order(row["aufnr"]) in selected_orders]
    # Station projections may omit IF_L6 and other order attributes. Use the
    # filtered RTY order set as the source of truth for every scope so missing
    # station fields cannot admit records from a different order population.
    scope_orders = {
        normalize_order(row["aufnr"]) for row in orders if normalize_order(row["aufnr"])
    }

    by_station: dict[tuple[str, str], dict[str, Any]] = {}
    sn_dimensions: dict[str, set[str]] = defaultdict(set)
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
                product_models=list(selected_models),
                bases=list(selected_bases),
                customers=list(selected_customers),
                group_by=group_by,
                order_scope=order_scope,
                scope_orders=scope_orders,
            )
        ):
            dimension_value = _station_dimension_value(raw, group_by)
            sn_dimensions[sn].add(dimension_value)
            by_station.setdefault((dimension_value, station), {"sns": set(), "name": station})[
                "sns"
            ].add(sn)
    all_sns = {sn for value in by_station.values() for sn in value["sns"]}
    repairs, rty_groups = await asyncio.gather(
        _station_repairs_for_sns(all_sns, date_from=start, date_to=end),
        _rty_order_groups(orders, group_by=group_by),
    )
    summary_faults: dict[str, int] = defaultdict(int)
    summary_quantity: dict[str, int] = defaultdict(int)
    for (dimension, _month, _model, _base), group in rty_groups.items():
        summary_faults[dimension] += len(group["defects"] & serial_values if serial_values else group["defects"])
        summary_quantity[dimension] += round(group["input"])
    defect_by_station: dict[tuple[str, str], set[str]] = defaultdict(set)
    for row in repairs:
        repair_station = normalize_station_code(str(row.get("ZNGGZ") or ""))
        repair_sn = str(row.get("PCODE") or "").strip()
        if not repair_station or not repair_sn:
            continue
        dimensions = sn_dimensions.get(repair_sn)
        if not dimensions:
            dimensions = {_station_dimension_value(row, group_by)}
        for dimension_value in dimensions:
            if (dimension_value, repair_station) in by_station:
                # The repair's NG station is authoritative. Do not require
                # the same SN to have a pass row at that station.
                defect_by_station[(dimension_value, repair_station)].add(repair_sn)
    return [
        StationPassRate(
            dimensionValue=dimension_value,
            stationCode=station,
            stationName=value["name"],
            inputCount=len(value["sns"]),
            defectCount=len(defect_by_station.get((dimension_value, station), set())),
            passRate=round(
                (
                    max(
                        0,
                        len(value["sns"])
                        - len(defect_by_station.get((dimension_value, station), set())),
                    )
                    / len(value["sns"])
                )
                * 100,
                2,
            )
            if value["sns"]
            else 100.0,
            totalInputCount=summary_quantity[dimension_value],
            totalDefectCount=summary_faults[dimension_value],
        )
        for (dimension_value, station), value in sorted(by_station.items())
    ]


async def station_details(
    station: str,
    date_from: str | None,
    date_to: str | None,
    detail_type: str,
    serial_number: str | None = None,
    product_models: list[str] | None = None,
    bases: list[str] | None = None,
    customers: list[str] | None = None,
    group_by: str = "salesOrder",
    dimension_value: str | None = None,
    order_scope: str = "normal",
    overseas: bool = False,
    product_model: str | None = None,
    base: str | None = None,
    customer: str | None = None,
    order_types: list[str] | None = None,
    serial_numbers: list[str] | None = None,
    production_orders: list[str] | None = None,
    sales_orders: list[str] | None = None,
) -> list[StationPassDetail]:
    if current_base_permissions() == ():
        return []
    from app.services import advanced_filters

    start, end = _date_range(date_from, date_to)
    serial_values = advanced_filters.values(serial_numbers)
    production_values = {normalize_order(value) for value in advanced_filters.values(production_orders)}
    sales_values = {advanced_filters.normalize_sales_order(value) for value in advanced_filters.values(sales_orders)}
    selected_models = {value.strip() for value in [*(product_models or []), product_model] if value and value.strip()}
    selected_bases = {value.strip() for value in [*(bases or []), base] if value and value.strip()}
    selected_customers = {value.strip() for value in [*(customers or []), customer] if value and value.strip()}
    include_empty_customer = NO_CUSTOMER_ID in selected_customers
    selected_customers.discard(NO_CUSTOMER_ID)
    records = await _station_records_in_range(start, end, serial_number=serial_number)
    records = _station_rows_in_planned_range(records, start, end)
    if serial_values:
        records = [item for item in records if str(_raw(item).get("PCODE") or "").strip() in serial_values]
    scope_orders = None
    if order_scope == "l6" or selected_customers or include_empty_customer or overseas or order_types or production_values or sales_values or serial_values:
        orders = await _orders(
            {
                "dateFrom": f"{start[:4]}-{start[4:6]}-{start[6:]}",
                "dateTo": f"{end[:4]}-{end[4:6]}-{end[6:]}",
                "serialNumber": serial_number or "",
                "orderScope": order_scope,
                "overseas": "true" if overseas else "",
                "orderTypes": ",".join(order_types or []),
            }
        )
        orders = [
            row for row in orders
            if advanced_filters.order_matches(row["aufnr"], row["data"].get("VBELN"), production_values, sales_values)
            and (not selected_models or str(row["data"].get("MAKTX_TH") or "").strip() in selected_models)
            and (not selected_bases or str(row["data"].get("LGORT") or "").strip() in selected_bases)
            and (
                not selected_customers
                and not include_empty_customer
                or str(row["data"].get("KID") or "").strip() in selected_customers
                or include_empty_customer and not str(row["data"].get("KID") or "").strip()
            )
        ]
        scope_orders = {
            normalize_order(row["aufnr"]) for row in orders if normalize_order(row["aufnr"])
        }
    unique: dict[str, dict[str, Any]] = {}
    scope_records: dict[str, dict[str, Any]] = {}
    for item in records:
        raw = _raw(item)
        sn = str(raw.get("PCODE") or "").strip()
        code = normalize_station_code(
            str(item.get("stationCode") or raw.get("SPEC") or raw.get("OPERATION") or "")
        )
        if (
            sn
            and _matches_station_filters(
                raw,
                serial_number=serial_number,
                product_models=list(selected_models),
                bases=list(selected_bases),
                customers=list(selected_customers),
                group_by=group_by,
                order_scope=order_scope,
                dimension_value=dimension_value,
                scope_orders=scope_orders,
            )
        ):
            scope_records.setdefault(sn, item)
            if code == station:
                unique.setdefault(sn, {"raw": raw, "code": code})
    if detail_type == "input":
        repairs = await _station_repairs_for_sns(set(unique), date_from=start, date_to=end)
        repairs_by_sn: dict[str, dict[str, Any]] = {}
        for row in repairs:
            if normalize_station_code(str(row.get("ZNGGZ") or "")) != station:
                continue
            sn = str(row.get("PCODE") or "").strip()
            if sn and sn in unique:
                repairs_by_sn.setdefault(sn, row)
        return [
            StationPassDetail(
                id=f"{station}:{sn}",
                sn=sn,
                stationCode=station,
                stationName=station,
                passDate=_station_gstrs_date(item),
                status="passed",
                defectCode=str(repairs_by_sn[sn].get("ZNGWD") or "") if sn in repairs_by_sn else "",
                description=str(repairs_by_sn[sn].get("ZWXWD") or "")
                if sn in repairs_by_sn
                else "",
                repairPerson=str(repairs_by_sn[sn].get("ZUSER") or "")
                if sn in repairs_by_sn
                else "",
                raw=repairs_by_sn.get(sn, {}),
            )
            for sn, item in sorted(unique.items())
        ]
    if not scope_records:
        return []
    repairs = await _station_repairs_for_sns(set(scope_records), date_from=start, date_to=end)
    repairs = [
        row for row in repairs
        if normalize_station_code(str(row.get("ZNGGZ") or "")) == station
        and str(row.get("PCODE") or "").strip() in scope_records
    ]
    sns_with_ids = {
        str(row.get("PCODE") or "").strip()
        for row in repairs if row.get("_source_key") or row.get("_id")
    }
    full_by_key: dict[str, dict[str, Any]] = {}
    if sns_with_ids:
        full_rows = await data_gateway.fault_rows_by_host_barcodes(sorted(sns_with_ids))
        for item in full_rows:
            full = normalize_fault_row(item)
            for identity in {str(full.get("_source_key") or "").strip(), str(full.get("_id") or "").strip()} - {""}:
                if identity in full_by_key:
                    raise DataGatewayError("维修明细原始记录标识重复，请重新查询", retryable=True)
                full_by_key[identity] = full
    result: list[StationPassDetail] = []
    for row in repairs:
        sn = str(row.get("PCODE") or "").strip()
        pass_row = scope_records[sn]
        identity = str(row.get("_source_key") or row.get("_id") or "").strip()
        full = full_by_key.get(identity)
        if (
            full
            and str(full.get("PCODE") or "").strip() == sn
            and normalize_order(full.get("AUFNR")) == normalize_order(row.get("AUFNR"))
            and normalize_station_code(str(full.get("ZNGGZ") or "")) == station
        ):
            row = {**row, **full}
        elif identity:
            raise DataGatewayError("维修明细原始记录缺失或不匹配，请重新查询", retryable=True)
        result.append(
            StationPassDetail(
                id=f"{station}:{sn}:defect:{len(result)}",
                sn=sn,
                stationCode=station,
                stationName=station,
                passDate=_station_gstrs_date(pass_row),
                status="defect",
                defectCode=str(row.get("ZNGWD") or ""),
                description=str(row.get("ZWXWD") or ""),
                repairPerson=str(row.get("ZUSER") or ""),
                matchedModel=str(_raw(pass_row).get("MAKTX_TH") or pass_row.get("productionModel") or ""),
                raw=row,
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
        repairPerson=str(row.get("ZUSER") or ""),
        repair_effectiveness="",
        customer=str(row.get("customer") or ""),
    )


async def details_by_orders(
    orders: set[str],
    model: str | None = None,
) -> list[DefectDetail]:
    if current_base_permissions() is not None:
        allowed = await accessible_order_numbers()
        orders = {order for order in orders if normalize_order(order) in allowed}
    if not orders:
        return []

    # The lookup endpoint intentionally returns only order-to-SN associations.
    # Resolve those SNs through the detail endpoint before rendering the modal,
    # otherwise every detail column is blank even though the RTY count is nonzero.
    links = _dedup_faults(await _faults_for_orders(orders))
    sns = {str(row.get("PCODE") or "").strip() for row in links}
    detail_rows = await _faults_for_sns(sns)
    selected_orders = {normalize_order(order) for order in orders}
    detail_rows = [
        row for row in detail_rows
        if normalize_order(row.get("AUFNR")) in selected_orders
    ]
    rows = _dedup_faults(detail_rows)
    return [
        to_detail(row)
        for row in sorted(
            rows,
            key=lambda row: (
                normalize_order(row.get("AUFNR")),
                str(row.get("PCODE") or ""),
                str(row.get("_id") or ""),
            ),
        )[:MAX_DETAIL_ROW_COUNT]
    ]


async def accessible_order_numbers() -> frozenset[str]:
    """Use order ownership, including excluded and L6 orders, for detail authorization."""
    scope = current_base_permissions()
    if scope == ():
        return frozenset()
    try:
        version = await data_gateway.export_version()
    except DataGatewayError:
        version = None
    if not version:
        return frozenset(
            normalize_order(row["aufnr"]) for row in await _order_rows({}) if row["aufnr"]
        )
    order_version = version["orders"]
    key = (data_gateway.base_url, order_version)

    async def load_index():
        by_base: dict[str, set[str]] = defaultdict(set)
        for item in await data_gateway.all_orders(source_version=order_version):
            row = normalize_order_row(item)
            if row["aufnr"]:
                by_base[canonical_base(row["data"].get("LGORT"))].add(normalize_order(row["aufnr"]))
        latest = await data_gateway.export_version()
        if not latest or latest["orders"] != order_version:
            raise DataGatewayError("订单归属版本发生变化，请重新查询", retryable=True)
        return MappingProxyType({base: frozenset(orders) for base, orders in by_base.items()})

    async def load_scope():
        index = await _ORDER_OWNERSHIP_CACHE.get_or_set(key, load_index, ttl_seconds=3600)
        bases = index if scope is None else scope
        return frozenset().union(*(index.get(base, frozenset()) for base in bases))

    return await _ORDER_SCOPE_CACHE.get_or_set((key, scope), load_scope, ttl_seconds=3600)


async def authorized_fault_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if current_base_permissions() is None:
        return rows
    allowed = await accessible_order_numbers()
    return [row for row in rows if normalize_order(row.get("AUFNR")) in allowed]


async def sales_order_summary(
    sales_orders: list[str], order_scope: str, targets: dict[str, float] | None = None
) -> list[SalesOrderSummary]:
    result = []
    for sales_order in sales_orders:
        rows = await _orders({"salesOrder": sales_order, "orderScope": order_scope})
        if not rows and current_base_permissions() is not None:
            continue
        orders = {row["aufnr"] for row in rows}
        model = str((rows[0]["data"] or {}).get("MAKTX_TH") or "") if rows else None
        faults = await _fault_sns_by_orders(orders, model=model)
        inp = round(sum(_num((row["data"] or {}).get("GAMNG")) for row in rows))
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
