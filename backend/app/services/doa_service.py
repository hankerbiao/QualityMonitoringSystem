"""DOA dashboard aggregation backed exclusively by the data gateway."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime
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
)
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.data_gateway_client import DataGatewayError, data_gateway
from app.services.scs_gateway import scs_gateway

DOA_CACHE_TTL_SECONDS = 60.0
_DOA_ORDERS_CACHE = AsyncTTLCache()
_DOA_REPAIRS_CACHE = AsyncTTLCache()
_DOA_DASHBOARD_CACHE = AsyncTTLCache()
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


def _bool(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y", "是"}


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
        "shipped_date": _date(item.get("shipmentDate")),
        "shipped_count": _number(item.get("shipmentQuantity")),
        "is_5000_company": _bool(item.get("is5000Company")),
    }


def _has_shipment_contract(item: dict[str, Any]) -> bool:
    return {"shipmentDate", "shipmentQuantity", "is5000Company"}.issubset(item)


def _gateway_order_matches(order: dict[str, Any], filters: DoaFilters) -> bool:
    date = order["shipped_date"]
    start = _date(filters.dateFrom)
    end = _date(filters.dateTo)
    if start and (not date or date < start):
        return False
    if end and (not date or date > end):
        return False
    return (not filters.customer or order["customer"] == filters.customer) and (
        not filters.model or order["model"] == filters.model
    )


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


async def _gateway_orders_for_doa(filters: DoaFilters) -> list[dict[str, Any]]:
    items = await data_gateway.all_orders(
        shipmentDateFrom=filters.dateFrom or "",
        shipmentDateTo=filters.dateTo or "",
        company5000="true",
        shipmentOnly="true",
    )
    if any(not _has_shipment_contract(item) for item in items):
        raise DataGatewayError(
            "数据网关订单接口必须返回 shipmentDate、shipmentQuantity、is5000Company，"
            "DOA 报修率不能使用计划开始日期或入库数量代替实际发货数据"
        )
    return [
        order
        for item in items
        for order in [_gateway_order(item)]
        if (
            order["is_5000_company"]
            and order["shipped_date"]
            and order["shipped_count"] > 0
            and _gateway_order_matches(order, filters)
            and order["sales_order"]
        )
    ]


async def _doa_gateway_orders(filters: DoaFilters) -> list[dict[str, Any]]:
    key = filters.model_dump_json()
    return await _DOA_ORDERS_CACHE.get_or_set(
        key,
        lambda: _gateway_orders_for_doa(filters),
        ttl_seconds=DOA_CACHE_TTL_SECONDS,
    )


async def _load_doa_gateway_repairs(filters: DoaFilters) -> list[dict[str, Any]]:
    orders = await _doa_gateway_orders(filters)
    by_sales = _sales_order_scopes(orders)
    scs, changes = await asyncio.gather(
        scs_gateway.all(
            "SCS_DOA",
            company5000="true",
            judgment="是",
            acceptedDateFrom=filters.acceptedDateFrom or filters.dateFrom or "",
            acceptedDateTo=filters.acceptedDateTo or filters.dateTo or "",
        ),
        scs_gateway.all("SCS_CHANGE", company5000="true"),
    )
    changed = {row["service_order"] for row in changes if _is_valid_hardware_replacement(row)}
    rows = []
    for item in scs:
        if item["judgment"] != "是":
            continue
        order = by_sales.get(_sales_order_key(item["sales_order"]))
        if not order:
            continue
        rows.append(
            {
                "id": item["id"],
                "sales_order": item["sales_order"],
                "material_serial": item["host_sn"] or item["part_sn"],
                "accepted_at": item["accepted_at"],
                "customer": order["customer"],
                "model": order["model"],
                "shipped_date": order["shipped_date"],
                "shipped_count": order["shipped_count"],
                "repair_count": _number(item["repair_count"]),
                "has_change": item["service_order"] in changed,
                "data": item["raw"],
            }
        )
    return rows


async def _doa_gateway_repairs(filters: DoaFilters) -> list[dict[str, Any]]:
    key = filters.model_dump_json()
    return await _DOA_REPAIRS_CACHE.get_or_set(
        key,
        lambda: _load_doa_gateway_repairs(filters),
        ttl_seconds=DOA_CACHE_TTL_SECONDS,
    )


async def build_doa_dashboard(filters: DoaFilters) -> DoaDashboardResponse:
    key = filters.model_dump_json()
    return await _DOA_DASHBOARD_CACHE.get_or_set(
        key,
        lambda: _build_doa_dashboard(filters),
        ttl_seconds=DOA_CACHE_TTL_SECONDS,
    )


async def _build_doa_dashboard(filters: DoaFilters) -> DoaDashboardResponse:
    orders, repairs, eligible_rows = await asyncio.gather(
        _doa_gateway_orders(filters),
        _doa_gateway_repairs(filters),
        scs_gateway.all(
            "SCS_DOA",
            company5000="true",
            judgment="是",
            acceptedDateFrom=filters.acceptedDateFrom or filters.dateFrom or "",
            acceptedDateTo=filters.acceptedDateTo or filters.dateTo or "",
        ),
    )
    shipped = sum(item["shipped_count"] for item in orders)
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
        for item in orders:
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
    for item in orders:
        key = period(item.get("shipped_date"))
        if key:
            totals = trend_totals.setdefault(key, [0.0, 0.0, 0.0, set()])
            totals[0] += item["shipped_count"]
    for item in repairs:
        key = period(item.get("accepted_at"))
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
    eligible = len(eligible_rows)
    return DoaDashboardResponse(
        filters=filters,
        summary=DoaSummary(
            shippedCount=shipped,
            repairCount=repair_count,
            repairRate=_rate(repair_count, shipped),
            replacementCount=replacement_count,
            replacementRate=_rate(replacement_count, shipped),
            replacementRecordCount=replacement_record_count,
            matchedRepairRecords=len(repairs),
            excludedRepairRecords=max(0, eligible - len(repairs)),
            latestDataAt=_gateway_latest_accepted_at(eligible_rows),
        ),
        trend=trend,
        byCustomer=dimensions("customer"),
        byModel=dimensions("model"),
    )


async def get_doa_repairs(
    filters: DoaFilters, page: int, limit: int, replacement_only: bool = False
) -> DoaRepairsResponse:
    rows = await _doa_gateway_repairs(filters)
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
                customer=str(row.get("customer") or ""),
                model=str(row.get("model") or ""),
                shippedDate=str(row.get("shipped_date") or ""),
                shippedCount=float(row.get("shipped_count") or 0),
                repairCount=float(row.get("repair_count") or 0),
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
