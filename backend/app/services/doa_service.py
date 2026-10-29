"""DOA dashboard aggregation backed exclusively by the data gateway."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from app.schemas.doa import (
    DoaDashboardResponse,
    DoaDimensionItem,
    DoaFilters,
    DoaRawFilters,
    DoaRepairItem,
    DoaRepairsResponse,
    DoaSummary,
    DoaTrendItem,
    DoaUnmatchedOrder,
)
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.data_gateway_client import DataGatewayError, data_gateway
from app.services.scs_gateway import scs_gateway

DOA_CACHE_TTL_SECONDS = 60.0
DOA_DASHBOARD_CACHE_TTL_SECONDS = 2 * 60 * 60.0
_DOA_ORDERS_CACHE = AsyncTTLCache()
_DOA_SNAPSHOT_CACHE = AsyncTTLCache(max_entries=128)
_DOA_RAW_CACHE = AsyncTTLCache()


def _date(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    for candidate in (text[:10], text.split(" ", 1)[0]):
        try:
            return datetime.strptime(candidate.replace("/", "-"), "%Y-%m-%d").strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _gateway_latest_accepted_at(rows: list[dict[str, Any]]) -> datetime | None:
    values = []
    for row in rows:
        value = str(row.get("accepted_at") or "").strip().replace("/", "-")
        if not value:
            continue
        try:
            values.append(datetime.fromisoformat(value))
        except ValueError:
            continue
    return max(values, default=None)


def _number(value: Any) -> float:
    if value is None or isinstance(value, bool):
        return 0.0
    if isinstance(value, int | float):
        return float(value)
    match = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
    return float(match.group(0)) if match else 0.0


def _rate(repairs: float, shipped: float) -> float | None:
    return round(repairs / shipped * 100, 2) if shipped else None


def _sales_order_key(value: Any) -> str:
    text = str(value or "").strip()
    return text.lstrip("0") or "0" if text.isdigit() else text


def _is_valid_hardware_replacement(change: dict[str, Any]) -> bool:
    return (
        bool(change.get("service_order"))
        and not bool(change.get("is_revoked"))
        and change.get("change_type") in {"换上", "换上-up"}
    )


def _replacement_defect_count(repair: dict[str, Any]) -> float:
    return repair["repair_count"] if repair["has_change"] else 0.0


def _gateway_order(item: dict[str, Any]) -> dict[str, Any]:
    raw = item.get("raw") if isinstance(item.get("raw"), dict) else item
    data = raw.get("data") if isinstance(raw.get("data"), dict) else raw
    return {
        "sales_order": str(data.get("VBELN") or item.get("salesOrder") or "").strip(),
        "customer": str(data.get("NAME1_ZU") or item.get("finalUser") or "").strip(),
        "model": str(data.get("MAKTX_TH") or item.get("productionModel") or "").strip(),
        "shipped_date": _date(item.get("plannedStartDate")),
        "shipped_count": _number(item.get("orderQuantity")),
        "raw": item,
    }


def _sales_order_scopes(orders: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for order in orders:
        grouped.setdefault(_sales_order_key(order["sales_order"]), []).append(order)

    scopes: dict[str, dict[str, Any]] = {}
    for key, rows in grouped.items():
        customers = {row["customer"] for row in rows if row["customer"]}
        models = {row["model"] for row in rows if row["model"]}
        shipment_dates = {row["shipped_date"] for row in rows if row["shipped_date"]}
        scopes[key] = {
            "sales_order": rows[0]["sales_order"],
            "customer": customers.pop() if len(customers) == 1 else "",
            "model": models.pop() if len(models) == 1 else "",
            "shipped_date": shipment_dates.pop() if len(shipment_dates) == 1 else "",
            "shipped_count": sum(row["shipped_count"] for row in rows),
        }
    return scopes


async def _gateway_orders_for_doa() -> list[dict[str, Any]]:
    items = await data_gateway.all_orders()
    return [order for item in items for order in [_gateway_order(item)] if order["sales_order"]]


async def _doa_gateway_orders() -> list[dict[str, Any]]:
    return await _DOA_ORDERS_CACHE.get_or_set(
        "orders",
        _gateway_orders_for_doa,
        ttl_seconds=DOA_CACHE_TTL_SECONDS,
    )


def _accepted_bounds(filters: DoaFilters) -> tuple[str, str]:
    starts = [value for value in (filters.dateFrom, filters.acceptedDateFrom) if value]
    ends = [value for value in (filters.dateTo, filters.acceptedDateTo) if value]
    return max(starts, default=""), min(ends, default="")


async def _eligible_doa(filters: DoaFilters) -> list[dict[str, Any]]:
    return await scs_gateway.all(
        "SCS_DOA",
        company5000="true",
        judgment="是",
    )


def _selected_orders(orders: list[dict[str, Any]], filters: DoaFilters) -> list[dict[str, Any]]:
    start, end = _accepted_bounds(filters)
    customers = set(filters.customers or ([filters.customer] if filters.customer else []))
    models = set(filters.models or ([filters.model] if filters.model else []))
    return [
        row
        for row in orders
        if (not start or (row["shipped_date"] and row["shipped_date"] >= start))
        and (not end or (row["shipped_date"] and row["shipped_date"] <= end))
        and (not customers or (row["customer"] or "未填写") in customers)
        and (not models or (row["model"] or "未填写") in models)
    ]


def _product_model(product: str, models: set[str]) -> str:
    # Longest whole prefix avoids assigning M10 to M1. SCS appends configuration
    # after separators; ambiguous or absent products remain separately visible.
    product = product.strip().casefold()
    matches = [
        model
        for model in models
        if product.startswith(model.casefold())
        and (len(product) == len(model) or not product[len(model)].isalnum())
    ]
    if not matches:
        return "未匹配机型"
    longest = max(map(len, matches))
    best = [model for model in matches if len(model) == longest]
    return best[0] if len(best) == 1 else "未匹配机型"


def _valid_doa(item: dict[str, Any]) -> bool:
    quantity = item.get("repair_count")
    return (
        item.get("judgment") == "是"
        and item.get("status") != "待受理"
        and quantity is not None
        and str(quantity).strip() != ""
    )


def _build_doa_repairs(
    orders: list[dict[str, Any]],
    eligible: list[dict[str, Any]],
    changes: list[dict[str, Any]],
    filters: DoaFilters,
) -> list[dict[str, Any]]:
    by_sales = _sales_order_scopes(orders)
    available_models = {order["model"] for order in orders if order["model"]}
    changed = {row["service_order"] for row in changes if _is_valid_hardware_replacement(row)}
    customers = set(filters.customers or ([filters.customer] if filters.customer else []))
    models = set(filters.models or ([filters.model] if filters.model else []))
    rows = []
    for item in eligible:
        if not _valid_doa(item):
            continue
        order = by_sales.get(_sales_order_key(item["sales_order"]))
        customer = (order["customer"] or "未填写") if order else "未匹配客户"
        model = _product_model(str(item.get("product") or ""), available_models)
        if (customers and customer not in customers) or (models and model not in models):
            continue
        rows.append(
            {
                "id": item["id"],
                "sales_order": item["sales_order"],
                "material_serial": item["host_sn"] or item["part_sn"],
                "accepted_at": item["accepted_at"],
                "planned_at": _date(item.get("planned_at")),
                "gstrs_status": item.get("gstrs_status") or "unmatched",
                "customer": customer,
                "model": model,
                "shipped_date": order["shipped_date"] if order else "",
                "shipped_count": order["shipped_count"] if order else 0,
                "repair_count": _number(item["repair_count"]),
                "missing_quantity": item["repair_count"] in (None, ""),
                "has_change": item["service_order"] in changed,
                "matched_order": bool(order),
                "data": item["raw"],
            }
        )
    return rows


async def _load_doa_snapshot(
    filters: DoaFilters,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    orders, eligible, changes = await asyncio.gather(
        _doa_gateway_orders(),
        _eligible_doa(filters),
        scs_gateway.all("SCS_CHANGE", company5000="true"),
    )
    eligible = [row for row in eligible if _valid_doa(row)]
    if any(not row.get("gstrs_status") for row in eligible):
        raise DataGatewayError(
            "SCS 计划日期回填尚未完成，或网关尚未提供计划日期字段；请先完成同步与回填"
        )
    service_orders = {row["service_order"] for row in eligible}
    changes = [change for change in changes if change["service_order"] in service_orders]
    return orders, eligible, _build_doa_repairs(orders, eligible, changes, filters), changes


async def _doa_snapshot(
    filters: DoaFilters,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    snapshot, _ = await _doa_snapshot_with_expiry(filters)
    return snapshot


async def _doa_snapshot_with_expiry(filters: DoaFilters):
    async def load():
        snapshot = await _load_doa_snapshot(filters)
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=DOA_DASHBOARD_CACHE_TTL_SECONDS)
        return snapshot, expires_at

    return await _DOA_SNAPSHOT_CACHE.get_or_set(
        filters.model_dump_json(),
        load,
        ttl_seconds=DOA_DASHBOARD_CACHE_TTL_SECONDS,
    )


async def _doa_gateway_repairs(filters: DoaFilters) -> list[dict[str, Any]]:
    _, _, repairs, _ = await _doa_snapshot(filters)
    return repairs


def _filter_planned_repairs(
    rows: list[dict[str, Any]], filters: DoaFilters, *, unmatched: bool = False
) -> list[dict[str, Any]]:
    start, end = _accepted_bounds(filters)
    if unmatched:
        return [row for row in rows if row["gstrs_status"] != "matched" or not row["planned_at"]]
    return [
        row
        for row in rows
        if row["gstrs_status"] == "matched"
        and row["planned_at"]
        and (not start or row["planned_at"] >= start)
        and (not end or row["planned_at"] <= end)
    ]


async def build_doa_dashboard(filters: DoaFilters) -> DoaDashboardResponse:
    return await _build_doa_dashboard(filters)


async def _build_doa_dashboard(filters: DoaFilters) -> DoaDashboardResponse:
    (orders, eligible_rows, all_repairs, _), cache_expires_at = await _doa_snapshot_with_expiry(
        filters
    )
    repairs = _filter_planned_repairs(all_repairs, filters)
    unmatched_planned = _filter_planned_repairs(all_repairs, filters, unmatched=True)
    selected_orders = _selected_orders(orders, filters)
    shipped = sum(item["shipped_count"] for item in selected_orders)
    repair_count = sum(item["repair_count"] for item in repairs)
    replacement_count = sum(_replacement_defect_count(item) for item in repairs)
    replacement_record_count = sum(1 for item in repairs if item["has_change"])
    granularity = filters.timeGranularity

    def period(value: Any) -> str:
        text = str(value or "")
        return text[:4] if granularity == "year" else text if granularity == "day" else text[:7]

    dimension_totals: dict[str, dict[str, list[float]]] = {
        "customer": {},
        "model": {},
    }
    for field, totals in dimension_totals.items():
        for item in selected_orders:
            key = str(item.get(field) or "未填写")
            values = totals.setdefault(key, [0.0, 0.0, 0.0])
            values[0] += item["shipped_count"]
        for item in repairs:
            key = str(item.get(field) or "未填写")
            values = totals.setdefault(key, [0.0, 0.0, 0.0])
            values[1] += item["repair_count"]
            values[2] += _replacement_defect_count(item)

    def dimensions(field: str) -> list[DoaDimensionItem]:
        result = []
        for key, (sent, fault, replacement) in sorted(dimension_totals[field].items()):
            result.append(
                DoaDimensionItem(
                    key=key,
                    shippedCount=sent,
                    repairCount=fault,
                    repairRate=_rate(fault, sent),
                    replacementCount=replacement,
                    replacementRate=_rate(replacement, sent),
                )
            )
        return result

    trend_totals: dict[str, list[Any]] = {}
    for item in selected_orders:
        key = period(item.get("shipped_date"))
        if key:
            totals = trend_totals.setdefault(key, [0.0, 0.0, 0.0, set()])
            totals[0] += item["shipped_count"]
    for item in repairs:
        key = period(item.get("planned_at"))
        if key:
            totals = trend_totals.setdefault(key, [0.0, 0.0, 0.0, set()])
            totals[1] += item["repair_count"]
            totals[2] += _replacement_defect_count(item)
            if item.get("material_serial"):
                totals[3].add(item["material_serial"])

    trend = []
    for key, (sent, faults_count, replacement, serials) in sorted(trend_totals.items()):
        trend.append(
            DoaTrendItem(
                period=key,
                shippedCount=sent,
                repairCount=faults_count,
                repairServerCount=len(serials),
                repairRate=_rate(faults_count, sent),
                replacementCount=replacement,
                replacementRate=_rate(replacement, sent),
            )
        )
    unmatched: dict[str, int] = {}
    for item in repairs:
        if not item["matched_order"]:
            sales_order = item["sales_order"] or ""
            unmatched[sales_order] = unmatched.get(sales_order, 0) + 1
    return DoaDashboardResponse(
        filters=filters,
        cacheExpiresAt=cache_expires_at,
        summary=DoaSummary(
            shippedCount=shipped,
            repairCount=repair_count,
            repairRate=_rate(repair_count, shipped),
            replacementCount=replacement_count,
            replacementRate=_rate(replacement_count, shipped),
            replacementRecordCount=replacement_record_count,
            matchedRepairRecords=sum(1 for item in repairs if item["matched_order"]),
            excludedRepairRecords=0,
            unmatchedRepairRecords=sum(1 for item in repairs if not item["matched_order"]),
            missingQuantityRecords=sum(1 for item in repairs if item["missing_quantity"]),
            unmatchedPlannedRecords=len(unmatched_planned),
            unmatchedPlannedQuantity=sum(item["repair_count"] for item in unmatched_planned),
            latestDataAt=_gateway_latest_accepted_at(eligible_rows),
        ),
        trend=trend,
        byCustomer=dimensions("customer"),
        byModel=dimensions("model"),
        unmatchedOrders=[
            DoaUnmatchedOrder(salesOrder=key, recordCount=value)
            for key, value in sorted(unmatched.items())
        ],
    )


async def get_doa_audit(filters: DoaFilters) -> dict[str, Any]:
    orders, eligible, all_repairs, changes = await _doa_snapshot(filters)
    repairs = _filter_planned_repairs(all_repairs, filters)
    scopes = _sales_order_scopes(orders)
    selected_ids = {row["id"] for row in repairs}
    audit_rows = []
    for item in eligible:
        if item["judgment"] != "是":
            continue
        key = _sales_order_key(item["sales_order"])
        if item["id"] not in selected_ids:
            continue
        audit_rows.append(
            {
                "matchStatus": "已匹配" if key in scopes else "未匹配",
                "salesOrder": item["sales_order"],
                "id": item["id"],
                "acceptedAt": item["accepted_at"],
                "plannedAt": item.get("planned_at") or "",
                "gstrsStatus": item.get("gstrs_status") or "",
                "repairCount": item["repair_count"],
                "raw": item["raw"],
            }
        )
    selected_orders = [order["raw"] for order in _selected_orders(orders, filters)]
    ids = [str(order.get("id") or "") for order in selected_orders]
    if any(not value for value in ids):
        raise DataGatewayError("订单缺少原始数据标识，无法导出")
    source_orders = await data_gateway.export_rows("orders", ids) if ids else []
    if source_orders is None:
        raise DataGatewayError("数据源不支持订单原始数据导出")
    source_orders_by_id = {str(row.get("_id") or ""): row for row in source_orders}
    if any(value not in source_orders_by_id for value in ids):
        raise DataGatewayError("订单原始数据不完整，请重新导出", retryable=True)
    audit_ids = {row["id"] for row in audit_rows}
    service_orders = {
        row["service_order"] for row in eligible if row["id"] in audit_ids and row["service_order"]
    }
    return {
        "repairs": audit_rows,
        "orders": [
            {**order, "sourceFields": source_orders_by_id[str(order["id"])]}
            for order in selected_orders
        ],
        "changes": [row["raw"] for row in changes if row["service_order"] in service_orders],
    }


async def get_doa_repairs(
    filters: DoaFilters,
    page: int,
    limit: int,
    replacement_only: bool = False,
    unmatched_only: bool = False,
) -> DoaRepairsResponse:
    rows = _filter_planned_repairs(
        await _doa_gateway_repairs(filters), filters, unmatched=unmatched_only
    )
    if replacement_only:
        rows = [row for row in rows if row["has_change"]]
    total = len(rows)
    selected = rows[(page - 1) * limit : page * limit]
    return DoaRepairsResponse(
        items=[
            DoaRepairItem(
                id=row["id"],
                salesOrder=str(row.get("sales_order") or ""),
                materialSerial=str(row.get("material_serial") or ""),
                acceptedAt=str(row.get("accepted_at") or ""),
                plannedAt=str(row.get("planned_at") or ""),
                gstrsStatus=str(row.get("gstrs_status") or ""),
                customer=str(row.get("customer") or ""),
                model=str(row.get("model") or ""),
                shippedDate=str(row.get("shipped_date") or ""),
                shippedCount=float(row.get("shipped_count") or 0),
                repairCount=float(row.get("repair_count") or 0),
                missingQuantity=row["missing_quantity"],
                data=row.get("data") or {},
            )
            for row in selected
        ],
        total=total,
        totalRepairCount=sum(row["repair_count"] for row in rows),
        page=page,
        limit=limit,
        has_more=page * limit < total,
    )


async def get_doa_orders(filters: DoaFilters, page: int, limit: int) -> dict[str, Any]:
    orders, _, _, _ = await _doa_snapshot(filters)
    rows = _selected_orders(orders, filters)
    selected = rows[(page - 1) * limit : page * limit]
    return {
        "items": [
            {
                "salesOrder": row["sales_order"],
                "productionOrder": str(row["raw"].get("aufnr") or ""),
                "customer": row["customer"],
                "model": row["model"],
                "plannedStartDate": row["shipped_date"] or "",
                "quantity": row["shipped_count"],
            }
            for row in selected
        ],
        "total": len(rows),
        "totalQuantity": sum(row["shipped_count"] for row in rows),
        "page": page,
        "limit": limit,
    }


async def get_doa_options() -> dict[str, list[str]]:
    orders = await data_gateway.all_orders(max_rows=1_000_000)
    normalized = [_gateway_order(item) for item in orders]
    return {
        "customers": sorted({row["customer"] for row in normalized if row["customer"]}),
        "models": sorted({row["model"] for row in normalized if row["model"]}),
    }


def _matches_raw_gateway(item: dict[str, Any], filters: DoaRawFilters) -> bool:
    fields = " ".join(
        str(item.get(key) or "")
        for key in ("service_order", "sales_order", "host_sn", "part_sn", "customer", "product")
    ).lower()
    for value in (
        filters.keyword,
        filters.serviceNumber,
        filters.salesOrder,
        filters.serialNumber,
        filters.customer,
        filters.product,
    ):
        if value and str(value).lower() not in fields:
            return False
    if filters.doaType and item["doa_type"] != filters.doaType:
        return False
    if filters.judgment and item["judgment"] != filters.judgment:
        return False
    return not filters.processingStatus or item["status"] == filters.processingStatus


def _raw_gateway_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "data": {
            "服务单号": item["service_order"],
            "销售订单号": item["sales_order"],
            "曙光S/N": item["host_sn"],
            "备件S/N": item["part_sn"],
            "客户全称": item["customer"],
            "产品/备件名称": item["product"],
            "DOA类型": item["doa_type"],
            "判定结果": item["judgment"],
            "处理状态": item["status"],
            "问题批次数量": item["repair_count"],
            "受理时间": item["accepted_at"],
        },
        "source": "data_gateway",
    }


async def _load_doa_raw(filters: DoaRawFilters) -> list[dict[str, Any]]:
    rows = await scs_gateway.all(
        "SCS_DOA",
        company5000="true",
        doaType=filters.doaType or "",
        status=filters.processingStatus or "",
        judgment=filters.judgment or "",
        acceptedDateFrom=filters.acceptedDateFrom or "",
        acceptedDateTo=filters.acceptedDateTo or "",
    )
    rows = [item for item in rows if _matches_raw_gateway(item, filters)]
    rows.sort(key=lambda item: (item["accepted_at"], item["id"]), reverse=True)
    return rows


async def get_doa_raw(
    page: int = 1, limit: int = 50, filters: DoaRawFilters | None = None
) -> dict[str, Any]:
    filters = filters or DoaRawFilters()
    rows = await _DOA_RAW_CACHE.get_or_set(
        filters.model_dump_json(),
        lambda: _load_doa_raw(filters),
        ttl_seconds=DOA_CACHE_TTL_SECONDS,
    )
    total = len(rows)
    selected = rows[(page - 1) * limit : page * limit]

    def counts(field: str) -> list[dict[str, Any]]:
        values: dict[str, int] = {}
        for item in rows:
            key = str(item.get(field) or "未填写")
            values[key] = values.get(key, 0) + 1
        return [
            {"key": key, "count": count}
            for key, count in sorted(values.items(), key=lambda pair: (-pair[1], pair[0]))
        ]

    return {
        "summary": {
            "total": total,
            "judgmentYes": sum(item["judgment"] == "是" for item in rows),
            "judgmentNo": sum(item["judgment"] == "否" for item in rows),
            "latestAcceptedAt": rows[0]["accepted_at"] if rows else None,
        },
        "trend": [],
        "byType": counts("doa_type"),
        "byProcessingStatus": counts("status"),
        "items": [_raw_gateway_item(item) for item in selected],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "hasMore": page * limit < total,
        },
    }
