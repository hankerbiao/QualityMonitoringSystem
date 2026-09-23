"""LRR endpoints: gateway loading, pure aggregation, and cache orchestration."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation
from time import perf_counter
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth_permissions import dashboard_dependency
from app.core.logger import audit_log, log_info
from app.schemas.lrr import (
    LRRData,
    LRRFaultDetail,
    LRRFaultDetailsResponse,
    LRRListResponse,
    LRRMaterialRank,
    LRROptions,
    LRRSummary,
    LRRTrendPoint,
)
from app.services import lrr_gateway
from app.services.lrr_list_cache import LRRListQuery, lrr_list_cache
from app.services.lrr_normalization import (
    compact_date,
    month_from_date,
    normalize_production_order,
    normalize_sales_order,
)

router = APIRouter(dependencies=[Depends(dashboard_dependency("lrr"))])
MAX_LRR_DATE_RANGE_DAYS = 93


def _validate_lrr_date_range(start: str | None, end: str | None, label: str) -> None:
    if not start and not end:
        return
    try:
        start_date = date.fromisoformat(start) if start else None
        end_date = date.fromisoformat(end) if end else None
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_QUERY",
                "error": f"{label}必须使用 YYYY-MM-DD 格式",
                "message": f"{label}必须使用 YYYY-MM-DD 格式",
                "retryable": False,
            },
        ) from exc

    if start_date and end_date and start_date > end_date:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_QUERY",
                "error": f"{label}起始日期不能晚于结束日期",
                "message": f"{label}起始日期不能晚于结束日期",
                "retryable": False,
            },
        )
    if start_date and end_date and (end_date - start_date).days + 1 > MAX_LRR_DATE_RANGE_DAYS:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "QUERY_TOO_LARGE",
                "error": f"{label}查询范围不能超过 {MAX_LRR_DATE_RANGE_DAYS} 天，请缩小范围",
                "message": f"{label}查询范围不能超过 {MAX_LRR_DATE_RANGE_DAYS} 天，请缩小范围",
                "retryable": False,
            },
        )


def _quantity(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return Decimal(0)


def _normalized_description(value: Any) -> str:
    return " ".join(str(value or "").split()).casefold()


def aggregate_lrr(
    bom_rows: list[dict[str, Any]],
    fault_rows: list[dict[str, Any]],
    *,
    include_details: bool = True,
) -> tuple[list[LRRData], list[LRRFaultDetail]]:
    groups: dict[str, dict[str, Any]] = {}
    for bom in bom_rows:
        material = str(bom.get("MATNR") or "").strip()
        month = month_from_date(bom.get("GSTRS"))
        if not material or not month:
            continue
        group = groups.setdefault(
            f"{material}:{month}",
            {
                "material": material,
                "month": month,
                "description": str(bom.get("MAKTX") or "").strip(),
                "match_description": str(
                    bom.get("_match_description", bom.get("MAKTX")) or ""
                ).strip(),
                "quantity": Decimal(0),
                "orders": set(),
                "sales": set(),
            },
        )
        group["quantity"] += _quantity(bom.get("MENGE_A"))
        if order := normalize_production_order(bom.get("AUFNR_1")):
            group["orders"].add(order)
        if sale := normalize_sales_order(bom.get("VBELN_EX")):
            group["sales"].add(sale)

    active = {key: value for key, value in groups.items() if value["quantity"] > 0}
    counts: dict[str, int] = defaultdict(int)
    details: list[LRRFaultDetail] = []
    linked: set[tuple[str, str]] = set()
    for fault in fault_rows:
        fault_id = str(fault.get("_id") or id(fault))
        order = normalize_production_order(fault.get("AUFNR"))
        sales = normalize_sales_order(fault.get("VBELN"))
        # Normalized gateway rows expose the fallback material as MATNR, but
        # retain this direct fallback for older/raw repair rows.
        fault_material = (
            str(fault.get("MATNR") or "").strip() or str(fault.get("RECORD01REPAIRM") or "").strip()
        )
        fault_month = compact_date(fault.get("ZDATE_WX"))[:6]
        # Production order is the precise ownership key. A sales order can
        # contain several production orders, so using it as an OR fallback
        # when AUFNR is present can attach a fault from another order.
        link_candidates = (
            (key, group)
            for key, group in active.items()
            if (order in group["orders"] if order else sales in group["sales"])
            and fault_month == group["month"].replace("-", "")
        )
        candidates = list(link_candidates)
        if fault_material:
            candidates = [
                (key, group) for key, group in candidates if group["material"] == fault_material
            ]
        else:
            fault_description = _normalized_description(fault.get("ZJXMC"))
            candidates = [
                (key, group)
                for key, group in candidates
                if group["match_description"]
                and _normalized_description(group["match_description"]) == fault_description
            ]

        # A repair without an exact material number is counted only when its
        # order, month and description resolve to one PN. This prevents a
        # shared description from inflating every matching material's LRR.
        if len(candidates) != 1:
            continue
        key, group = candidates[0]
        if (fault_id, key) in linked:
            continue
        linked.add((fault_id, key))
        counts[key] += int(fault.get("_fault_count", 1))
        if include_details:
            details.append(
                LRRFaultDetail(
                    month=group["month"],
                    materialNumber=group["material"],
                    materialDescription=group["description"],
                    sn=str(fault.get("PCODE") or ""),
                    faultType=str(fault.get("ZNGWD") or ""),
                    faultDesc=str(fault.get("ZWXWD") or ""),
                    ngTime=" ".join(
                        value
                        for value in (
                            str(fault.get("ZDATE_WX") or "").strip(),
                            str(fault.get("ZTIME") or "").strip(),
                        )
                        if value
                    ),
                )
            )

    rows = [
        LRRData(
            id=key,
            month=group["month"],
            materialNumber=group["material"],
            materialDescription=group["description"],
            issuedQuantity=float(group["quantity"]),
            faultCount=counts[key],
            lrrRate=round(float(Decimal(counts[key]) / group["quantity"] * 100), 2),
        )
        for key, group in active.items()
    ]
    return rows, details


def _month_matches_date_range(month: str, date_from: str | None, date_to: str | None) -> bool:
    """Keep monthly rows whose month overlaps the selected NG date range."""
    if not date_from and not date_to:
        return True
    start_month = month_from_date(date_from) if date_from else ""
    end_month = month_from_date(date_to) if date_to else ""
    if date_from and not start_month or date_to and not end_month:
        return False
    return (not start_month or month >= start_month) and (not end_month or month <= end_month)


def _sorted_rows(rows: list[LRRData], query: LRRListQuery) -> list[LRRData]:
    rows = [
        row
        for row in rows
        if _month_matches_date_range(row.month, query.ng_date_from, query.ng_date_to)
    ]
    sort_field = (
        query.sort_by
        if query.sort_by in {"month", "materialNumber", "issuedQuantity", "faultCount", "lrrRate"}
        else "month"
    )
    rows = sorted(
        rows,
        key=lambda row: (getattr(row, sort_field) is None, getattr(row, sort_field) or 0),
        reverse=query.sort_dir == "desc",
    )
    return rows


def _summary(rows: list[LRRData], *, scope: str) -> LRRSummary:
    total_quantity = sum((_quantity(row.issuedQuantity) for row in rows), Decimal(0))
    known_faults = [row.faultCount for row in rows if row.faultCount is not None]
    total_faults = sum(known_faults) if len(known_faults) == len(rows) else None
    return LRRSummary(
        materialCount=len(rows),
        issuedQuantity=float(total_quantity),
        totalFaults=total_faults,
        overallLrr=round(total_faults / float(total_quantity) * 100, 2)
        if total_quantity and total_faults is not None
        else None,
        scope=scope,
    )


def _trend(rows: list[LRRData]) -> list[LRRTrendPoint]:
    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
        bucket = buckets.setdefault(
            row.month, {"quantity": Decimal(0), "faults": 0, "known": True}
        )
        bucket["quantity"] += _quantity(row.issuedQuantity)
        if row.faultCount is None:
            bucket["known"] = False
        else:
            bucket["faults"] += row.faultCount
    points: list[LRRTrendPoint] = []
    for month in sorted(buckets):
        bucket = buckets[month]
        quantity = float(bucket["quantity"])
        faults = bucket["faults"] if bucket["known"] else None
        points.append(
            LRRTrendPoint(
                month=month,
                issuedQuantity=quantity,
                faultCount=faults,
                lrrRate=round(faults / quantity * 100, 2) if faults is not None and quantity else None,
            )
        )
    return points


def _hotspots(rows: list[LRRData], limit: int = 8) -> list[LRRMaterialRank]:
    if any(row.faultCount is None for row in rows):
        return []
    groups: dict[str, dict[str, Any]] = {}
    for row in rows:
        group = groups.setdefault(
            row.materialNumber,
            {"description": "", "quantity": Decimal(0), "faults": 0},
        )
        if row.materialDescription:
            group["description"] = row.materialDescription
        group["quantity"] += _quantity(row.issuedQuantity)
        group["faults"] += row.faultCount or 0
    ranked = []
    for material, group in groups.items():
        quantity = float(group["quantity"])
        faults = int(group["faults"])
        if faults <= 0 or quantity <= 0:
            continue
        ranked.append(
            LRRMaterialRank(
                materialNumber=material,
                materialDescription=group["description"],
                issuedQuantity=quantity,
                faultCount=faults,
                lrrRate=round(faults / quantity * 100, 2),
            )
        )
    ranked.sort(key=lambda item: (-item.faultCount, -(item.lrrRate or 0), item.materialNumber))
    return ranked[:limit]


def _response(rows: list[LRRData], query: LRRListQuery) -> LRRListResponse:
    rows = _sorted_rows(rows, query)
    start = (query.page - 1) * query.limit
    return LRRListResponse(
        items=rows[start : start + query.limit],
        total=len(rows),
        page=query.page,
        limit=query.limit,
        has_more=start + query.limit < len(rows),
        summary=_summary(rows, scope="full"),
        trend=_trend(rows),
        hotspots=_hotspots(rows),
    )


def _usage_response(usage_rows: list[LRRData], query: LRRListQuery) -> LRRListResponse:
    """Return the fast list projection without loading the fault collection."""
    sorted_usage = _sorted_rows(usage_rows, query)
    start = (query.page - 1) * query.limit
    items = [
        row.model_copy(update={"faultCount": None, "lrrRate": None})
        for row in sorted_usage[start : start + query.limit]
    ]
    return LRRListResponse(
        items=items,
        total=len(sorted_usage),
        page=query.page,
        limit=query.limit,
        has_more=start + query.limit < len(sorted_usage),
        summary=_summary(items, scope="usage"),
    )


def _requires_full_fault_sort(query: LRRListQuery) -> bool:
    """Fault-derived sort keys require counts for every material/month row."""
    return query.sort_by in {"faultCount", "lrrRate"}


def _has_filter_criteria(query: LRRListQuery) -> bool:
    """Only calculate faults after the user has narrowed the LRR scope."""
    return any(
        value
        for value in (
            query.planned_date_from,
            query.planned_date_to,
            query.ng_date_from,
            query.ng_date_to,
            query.material_number,
            query.product_model,
            query.base,
            query.customer_id,
        )
    )


async def _load(query: LRRListQuery) -> LRRListResponse:
    started = perf_counter()
    bom = await lrr_gateway.load_bom(
        material_number=query.material_number,
        product_model=query.product_model,
        base=query.base,
        customer_id=query.customer_id,
        planned_date_from=query.planned_date_from,
        planned_date_to=query.planned_date_to,
    )
    usage_rows = aggregate_lrr(bom, [], include_details=False)[0]
    if _has_filter_criteria(query) or _requires_full_fault_sort(query):
        faults = await lrr_gateway.load_faults(
            production_orders={str(row.get("AUFNR_1") or "") for row in bom},
            sales_orders={str(row.get("VBELN_EX") or "") for row in bom},
            date_from=query.ng_date_from,
            date_to=query.ng_date_to,
        )
        rows = aggregate_lrr(bom, faults, include_details=False)[0]
        response = _response(rows, query)
        fault_scope = "full"
    else:
        # The unfiltered warm-cache path stays lightweight. Filtered queries
        # take the full branch above so the dashboard can show fault counts and
        # rates immediately after the user submits conditions.
        response = _usage_response(usage_rows, query)
        fault_scope = "lazy"
    # The rich view may ignore a multi-material filter on older gateway
    # deployments and turn a small description lookup into another full scan.
    # Keep the fast list path bounded; detail/export requests can still use the
    # richer view when the user explicitly asks for fault data.
    missing = [row.materialNumber for row in response.items if not row.materialDescription]
    if missing and fault_scope == "full":
        descriptions = await lrr_gateway.material_descriptions(missing)
        for row in response.items:
            if not row.materialDescription:
                row.materialDescription = descriptions.get(row.materialNumber, "")
    log_info(
        f"LRR gateway query={query.fingerprint[:12]} fault_scope={fault_scope} "
        f"bom_rows={len(bom)} total_ms={(perf_counter() - started) * 1000:.1f}"
    )
    return response


async def warm_default_lrr_list_cache() -> None:
    query = LRRListQuery()
    try:
        await lrr_list_cache.get_or_load(query, lambda: _load(query), refresh=True)
    except Exception:
        log_info("LRR 默认缓存预热跳过（网关超时或异常）")


@router.get("/list", response_model=LRRListResponse)
@audit_log("QUERY", "lrr_list")
async def get_lrr_list(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    plannedDateFrom: str | None = None,
    plannedDateTo: str | None = None,
    ngDateFrom: str | None = None,
    ngDateTo: str | None = None,
    materialNumber: str | None = None,
    productModel: str | None = None,
    base: str | None = None,
    customerId: str | None = None,
    sortBy: str = "month",
    sortDir: str = "asc",
):
    del request
    _validate_lrr_date_range(plannedDateFrom, plannedDateTo, "计划日期")
    _validate_lrr_date_range(ngDateFrom, ngDateTo, "故障日期")
    query = LRRListQuery(
        page=page,
        limit=limit,
        planned_date_from=plannedDateFrom,
        planned_date_to=plannedDateTo,
        ng_date_from=ngDateFrom,
        ng_date_to=ngDateTo,
        material_number=materialNumber,
        product_model=productModel,
        base=base,
        customer_id=customerId,
        sort_by=sortBy,
        sort_dir=sortDir,
    )
    return (await lrr_list_cache.get_or_load(query, lambda: _load(query)))[0]


@router.get("/options", response_model=LRROptions)
@audit_log("QUERY", "lrr_options")
async def get_lrr_options(request: Request):
    del request
    return LRROptions(**(await lrr_gateway.options()))


@router.get("/fault-details", response_model=LRRFaultDetailsResponse)
@audit_log("QUERY", "lrr_fault_details")
async def get_lrr_fault_details(
    request: Request,
    plannedDateFrom: str | None = None,
    plannedDateTo: str | None = None,
    ngDateFrom: str | None = None,
    ngDateTo: str | None = None,
    materialNumber: str | None = None,
    productModel: str | None = None,
    base: str | None = None,
    customerId: str | None = None,
    month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    limit: int = Query(50000, ge=1, le=50000),
):
    del request
    _validate_lrr_date_range(plannedDateFrom, plannedDateTo, "计划日期")
    _validate_lrr_date_range(ngDateFrom, ngDateTo, "故障日期")
    bom = await lrr_gateway.load_bom(
        material_number=materialNumber,
        product_model=productModel,
        base=base,
        customer_id=customerId,
        month=month,
        planned_date_from=plannedDateFrom,
        planned_date_to=plannedDateTo,
    )
    faults = await lrr_gateway.load_faults(
        production_orders={str(row.get("AUFNR_1") or "") for row in bom},
        sales_orders={str(row.get("VBELN_EX") or "") for row in bom},
        date_from=ngDateFrom,
        date_to=ngDateTo,
    )
    details = aggregate_lrr(bom, faults)[1]
    return LRRFaultDetailsResponse(
        items=details[:limit], total=len(details), truncated=len(details) > limit
    )
