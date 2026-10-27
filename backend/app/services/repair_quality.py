"""First-repair and repeat-repair analytics for orders selected by actual start date."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

from fastapi import HTTPException

from app.base_access import base_allowed, current_base_permissions
from app.schemas.rty import StationPassExport
from app.services import rty_export, rty_gateway
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.data_gateway_client import DataGatewayError, data_gateway
from app.services.lrr_normalization import compact_date
from app.services.rty_export import MAX_EXPORT_ORDERS, _source
from app.services.rty_shared import normalize_order, validate_date

MAX_REPAIR_QUALITY_FAULTS = 250_000
REPAIR_QUALITY_SOURCE_CACHE_TTL_SECONDS = 60.0
_REPAIR_QUALITY_SOURCE_CACHE = AsyncTTLCache(max_entries=64)


def _order_identity(item: dict[str, Any]) -> str:
    raw = item.get("raw")
    raw = raw if isinstance(raw, dict) else item
    return str(item.get("id") or raw.get("_id") or "").strip()


def _date_in_range(value: Any, start: str, end: str) -> bool:
    date = compact_date(value)
    return bool(date and start <= date <= end)


def _unique_repairs(faults: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, ...]] = set()
    result = []
    for row in faults:
        sn = str(row.get("PCODE") or "").strip()
        if not sn:
            continue
        identity = str(row.get("_id") or "").strip()
        key = (
            ("id", identity)
            if identity
            else tuple(
                str(row.get(field) or "").strip()
                for field in ("PCODE", "AUFNR", "VBELN", "ZNGWD", "ZNGGZ", "ZWXWD", "ZUSER")
            )
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(row)
    return result


def _group_repairs(
    faults: list[dict[str, Any]],
    orders: dict[str, dict[str, Any]],
) -> tuple[dict[str, list[dict[str, Any]]], dict[tuple[str, str], set[str]]]:
    rows_by_sn: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in _unique_repairs(faults):
        sn = str(row.get("PCODE") or "").strip()
        rows_by_sn[sn].append(row)

    groups: dict[tuple[str, str], set[str]] = defaultdict(set)
    for sn, rows in rows_by_sn.items():
        for row in rows:
            order = orders.get(normalize_order(row.get("AUFNR")), {})
            groups[(str(order.get("KID") or "未填写客户").strip(), str(order.get("LGORT") or "未知基地").strip())].add(sn)
    return rows_by_sn, groups


def aggregate_repairs(
    faults: list[dict[str, Any]],
    orders: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Aggregate de-duplicated source repair rows per SN and customer/base."""
    rows_by_sn, groups = _group_repairs(faults, orders)

    def summary(sns: set[str]) -> dict[str, Any]:
        counts = [len(rows_by_sn[sn]) for sn in sns]
        denominator = len(counts)
        distribution = {str(index): sum(count == index for count in counts) for index in range(1, 9)}
        distribution["9+"] = sum(count >= 9 for count in counts)
        first_pass = distribution["1"]
        return {
            "snCount": denominator,
            "firstPassCount": first_pass,
            "repeatCount": denominator - first_pass,
            "firstPassRate": round(first_pass / denominator * 100, 2) if denominator else 0,
            "distribution": [
                {
                    "repairCount": label,
                    "snCount": count,
                    "percentage": round(count / denominator * 100, 2) if denominator else 0,
                }
                for label, count in distribution.items()
            ],
        }

    all_sns = set(rows_by_sn)
    return {
        **summary(all_sns),
        "groups": [
            {"customer": customer, "base": base, **summary(sns)}
            for (customer, base), sns in sorted(groups.items())
        ],
    }


async def _load_sources_uncached(
    date_from: str,
    date_to: str,
    *,
    product_models: list[str] | None = None,
    customers: list[str] | None = None,
    bases: list[str] | None = None,
    full_fault_rows: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, dict[str, Any]]]:
    if current_base_permissions() == ():
        return [], [], {}
    start, end = compact_date(validate_date(date_from)), compact_date(validate_date(date_to))
    if start > end:
        raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期")

    order_rows = await data_gateway.all_orders(max_rows=MAX_EXPORT_ORDERS)
    if len(order_rows) > MAX_EXPORT_ORDERS:
        raise DataGatewayError("订单数量超过维修分析上限，请缩小筛选范围")
    identities = [_order_identity(item) for item in order_rows]
    if any(not identity for identity in identities) or len(set(identities)) != len(identities):
        raise DataGatewayError("订单缺少唯一数据源标识，无法完整分析")
    full_rows: list[dict[str, Any]] = []
    for index in range(0, len(identities), 4000):
        batches = await asyncio.gather(
            *(
                data_gateway.export_rows("orders", identities[offset : offset + 1000], max_rows=1000)
                for offset in range(index, min(index + 4000, len(identities)), 1000)
            ),
            return_exceptions=True,
        )
        for batch in batches:
            if isinstance(batch, BaseException):
                raise batch
            if batch is None:
                raise DataGatewayError("数据源不支持完整订单读取，无法按实际开始日期分析")
            full_rows.extend(batch)
    full_by_id = {str(item.get("_id") or ""): item for item in full_rows}
    if len(full_rows) != len(identities) or set(full_by_id) != set(identities):
        raise DataGatewayError("完整订单数据缺失或重复，请重试")

    models, customer_values, base_values = set(product_models or []), set(customers or []), set(bases or [])
    selected_orders: set[str] = set()
    selected_rows: list[dict[str, Any]] = []
    metadata: dict[str, dict[str, Any]] = {}
    selected_sns: set[str] = set()
    for item in order_rows:
        data = _source(full_by_id[_order_identity(item)])
        order = normalize_order(item.get("aufnr") or data.get("AUFNR"))
        model = str(data.get("MAKTX_TH") or "").strip()
        customer = str(data.get("KID") or "").strip()
        base = str(data.get("LGORT") or "").strip()
        if order and base_allowed(base):
            metadata[order] = data
        if (
            not order
            or not base_allowed(base)
            or not _date_in_range(data.get("ZDATE_STARTED"), start, end)
            or models and model not in models
            or customer_values and customer not in customer_values
            or base_values and base not in base_values
        ):
            continue
        selected_orders.add(order)
        selected_rows.append(data)
    if not selected_orders:
        return [], [], metadata

    selected_faults = await rty_gateway._faults_for_orders(selected_orders)
    selected_sns.update(str(row.get("PCODE") or "").strip() for row in selected_faults)
    selected_sns.discard("")
    if not selected_sns:
        return selected_rows, [], metadata

    if full_fault_rows:
        fetched = await data_gateway.fault_rows_by_host_barcodes(
            sorted(selected_sns), max_rows=MAX_REPAIR_QUALITY_FAULTS
        )
        repairs = [rty_gateway.normalize_fault_row(row) for row in fetched]
    else:
        repairs = await rty_gateway._faults_for_sns(selected_sns)
    if len(repairs) > MAX_REPAIR_QUALITY_FAULTS:
        raise DataGatewayError("维修记录超过维修分析上限，请增加筛选条件")
    # Lifecycle records may reference orders outside the date range, but never
    # expose another base's source rows to a base-restricted user.
    repairs = [
        row for row in repairs
        if str(row.get("PCODE") or "").strip() in selected_sns
        and (current_base_permissions() is None or normalize_order(row.get("AUFNR")) in metadata)
    ]
    return selected_rows, _unique_repairs(repairs), metadata


async def _load_sources(
    date_from: str,
    date_to: str,
    *,
    product_models: list[str] | None = None,
    customers: list[str] | None = None,
    bases: list[str] | None = None,
    full_fault_rows: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, dict[str, Any]]]:
    key = (
        date_from,
        date_to,
        tuple(sorted(product_models or [])),
        tuple(sorted(customers or [])),
        tuple(sorted(bases or [])),
        current_base_permissions(),
        full_fault_rows,
    )
    return await _REPAIR_QUALITY_SOURCE_CACHE.get_or_set(
        key,
        lambda: _load_sources_uncached(
            date_from,
            date_to,
            product_models=product_models,
            customers=customers,
            bases=bases,
            full_fault_rows=full_fault_rows,
        ),
        ttl_seconds=REPAIR_QUALITY_SOURCE_CACHE_TTL_SECONDS,
    )


async def analyze(
    date_from: str,
    date_to: str,
    *,
    product_models: list[str] | None = None,
    customers: list[str] | None = None,
    bases: list[str] | None = None,
) -> dict[str, Any]:
    _, repairs, metadata = await _load_sources(
        date_from, date_to, product_models=product_models, customers=customers, bases=bases
    )
    return aggregate_repairs(repairs, metadata)


async def details(
    date_from: str,
    date_to: str,
    customer: str,
    base: str,
    bucket: str,
    *,
    product_models: list[str] | None = None,
    customers: list[str] | None = None,
    bases: list[str] | None = None,
    page: int = 1,
    page_size: int = 50,
    export_all: bool = False,
) -> dict[str, Any]:
    _, repairs, metadata = await _load_sources(
        date_from, date_to, product_models=product_models, customers=customers, bases=bases
    )
    rows_by_sn, groups = _group_repairs(repairs, metadata)
    sns = sorted(
        sn for sn in groups.get((customer, base), set())
        if bucket == "all"
        or (bucket == "9+" and len(rows_by_sn[sn]) >= 9)
        or (bucket.isdigit() and len(rows_by_sn[sn]) == int(bucket))
    )
    selected = sns if export_all else sns[(page - 1) * page_size : page * page_size]
    items = []
    for sn in selected:
        rows = rows_by_sn[sn]
        orders = sorted({str(row.get("AUFNR") or "").strip() for row in rows} - {""})
        models = sorted({
            str(metadata.get(normalize_order(order), {}).get("MAKTX_TH") or "").strip()
            for order in orders
        } - {""})
        items.append({
            "sn": sn,
            "productionOrders": orders,
            "models": models,
            "repairCount": len(rows),
            "repairs": [
                {
                    "productionOrder": str(row.get("AUFNR") or ""),
                    "salesOrder": str(row.get("VBELN") or ""),
                    "station": str(row.get("ZNGGZ") or ""),
                    "faultCode": str(row.get("ZNGWD") or ""),
                    "description": str(row.get("ZWXWD") or ""),
                    "foundDate": str(row.get("T_FIND") or ""),
                    "repairDate": str(row.get("ZWXDT") or ""),
                    "repairPerson": str(row.get("U_FIX") or row.get("ZUSER") or ""),
                }
                for row in rows
            ],
        })
    return {"items": items, "total": len(sns), "page": page, "pageSize": page_size}


async def build_export(
    date_from: str,
    date_to: str,
    *,
    product_models: list[str] | None = None,
    customers: list[str] | None = None,
    bases: list[str] | None = None,
) -> dict[str, Any]:
    orders, repairs, metadata = await _load_sources(
        date_from,
        date_to,
        product_models=product_models,
        customers=customers,
        bases=bases,
        full_fault_rows=True,
    )
    source = StationPassExport(
        orders=await rty_export._export_orders(orders),
        faults=[rty_export._columns(row, rty_export.FAULT_FIELDS) for row in repairs],
    )
    return {**source.model_dump(), "summary": aggregate_repairs(repairs, metadata)}


async def options() -> dict[str, list[str]]:
    if current_base_permissions() == ():
        return {"productModels": [], "customers": [], "bases": []}
    rows = await data_gateway.all_orders(max_rows=MAX_EXPORT_ORDERS)
    values = {"productModels": set(), "customers": set(), "bases": set()}
    for item in rows:
        row = rty_gateway.normalize_order_row(item)
        data = row["data"]
        base = str(data.get("LGORT") or "").strip()
        if not base_allowed(base):
            continue
        for key, field in (("productModels", "MAKTX_TH"), ("customers", "KID"), ("bases", "LGORT")):
            value = str(data.get(field) or "").strip()
            if value:
                values[key].add(value)
    return {key: sorted(items) for key, items in values.items()}
