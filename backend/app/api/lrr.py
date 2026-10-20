"""LRR endpoints: gateway loading, pure aggregation, and cache orchestration."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from contextlib import suppress
from dataclasses import replace
from datetime import date
from decimal import Decimal, InvalidOperation
from time import perf_counter
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from app.auth_permissions import dashboard_dependency
from app.base_access import current_base_permissions
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
    normalize_material_number,
    normalize_production_order,
    normalize_sales_order,
)

router = APIRouter(dependencies=[Depends(dashboard_dependency("lrr"))])
MAX_LRR_DATE_RANGE_DAYS = 366
MAX_LRR_UNFILTERED_MONTHS = 2
LRR_SCOPE_FILTER_MESSAGE = "查询周期超过 2 个月，请至少增加物料号、机型、基地或客户 ID 筛选条件"
LRR_BOM_SCOPE_MESSAGE = "LRR 查询必须包含计划日期范围或物料 PN，未限定范围的查询已禁用"


def _validate_lrr_date_range(
    start: str | None,
    end: str | None,
    label: str,
    *,
    require_scope_filter: bool = False,
) -> None:
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
    if (
        require_scope_filter
        and start_date
        and end_date
        and (end_date.year - start_date.year) * 12 + end_date.month - start_date.month + 1
        > MAX_LRR_UNFILTERED_MONTHS
    ):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "QUERY_TOO_LARGE",
                "error": LRR_SCOPE_FILTER_MESSAGE,
                "message": LRR_SCOPE_FILTER_MESSAGE,
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


def _has_lrr_scope_filter(
    material_number: str | None,
    product_models: list[str] | None,
    bases: list[str] | None,
    customer_ids: list[str] | None,
) -> bool:
    return any(
        (
            str(material_number or "").strip(),
            any(str(value).strip() for value in product_models or []),
            any(str(value).strip() for value in bases or []),
            any(str(value or "").strip() for value in customer_ids or []),
        )
    )


def _has_bounded_bom_scope(
    material_number: str | None,
    planned_date_from: str | None,
    planned_date_to: str | None,
) -> bool:
    """Require a predicate that the BOM source can apply before reading rows."""
    return any(
        str(value or "").strip()
        for value in (material_number, planned_date_from, planned_date_to)
    )


def _require_bounded_bom_scope(
    material_number: str | None,
    planned_date_from: str | None,
    planned_date_to: str | None,
) -> None:
    if _has_bounded_bom_scope(material_number, planned_date_from, planned_date_to):
        return
    raise HTTPException(
        status_code=422,
        detail={
            "code": "QUERY_TOO_LARGE",
            "error": LRR_BOM_SCOPE_MESSAGE,
            "message": LRR_BOM_SCOPE_MESSAGE,
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
    for fault in fault_rows:
        order = normalize_production_order(fault.get("AUFNR"))
        sales = normalize_sales_order(fault.get("VBELN"))
        # Both material fields identify affected PNs. A set also prevents the
        # same PN in padded/unpadded form from counting twice for one repair.
        fault_materials = {
            normalize_material_number(value)
            for field in ("MATNR", "RECORD01REPAIRM")
            if (value := str(fault.get(field) or "").strip())
        }
        # LRR numerator uses the repair record's planned production date,
        # matching the BOM denominator's GSTRS month. ZDATE_WX is actual
        # repair time and is intentionally not used for period attribution.
        fault_month = compact_date(fault.get("GSTRS"))[:6]
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
        if fault_materials:
            candidates = [
                (key, group)
                for key, group in candidates
                if normalize_material_number(group["material"]) in fault_materials
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
        if not fault_materials and len(candidates) != 1:
            continue
        for key, group in candidates:
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
                    ),
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


def _full_response(rows: list[LRRData], query: LRRListQuery) -> LRRListResponse:
    rows = _sorted_rows(rows, query)
    return LRRListResponse(
        items=rows,
        total=len(rows),
        page=1,
        limit=len(rows),
        has_more=False,
        summary=_summary(rows, scope="full"),
        trend=_trend(rows),
        hotspots=_hotspots(rows),
    )


def _paginate_response(response: LRRListResponse, query: LRRListQuery) -> LRRListResponse:
    start = (query.page - 1) * query.limit
    return response.model_copy(
        update={
            "items": response.items[start : start + query.limit],
            "page": query.page,
            "limit": query.limit,
            "has_more": start + query.limit < response.total,
        }
    )


def _response(rows: list[LRRData], query: LRRListQuery) -> LRRListResponse:
    return _paginate_response(_full_response(rows, query), query)


def _full_usage_response(usage_rows: list[LRRData], query: LRRListQuery) -> LRRListResponse:
    """Return the fast list projection without loading the fault collection."""
    sorted_usage = _sorted_rows(usage_rows, query)
    items = [
        row.model_copy(update={"faultCount": None, "lrrRate": None})
        for row in sorted_usage
    ]
    return LRRListResponse(
        items=items,
        total=len(sorted_usage),
        page=1,
        limit=len(items),
        has_more=False,
        summary=_summary(items, scope="usage"),
    )


def _usage_response(usage_rows: list[LRRData], query: LRRListQuery) -> LRRListResponse:
    response = _paginate_response(_full_usage_response(usage_rows, query), query)
    return response.model_copy(update={"summary": _summary(response.items, scope="usage")})


def _canonical_lrr_cache_query(query: LRRListQuery) -> LRRListQuery:
    # Cache the complete filtered result once; API pagination is applied after
    # the cache lookup so page 2 does not repeat the gateway aggregation.
    return replace(query, page=1, limit=0)


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
            query.product_models,
            query.bases,
            query.product_model,
            query.base,
            query.customer_ids,
        )
    )


async def _load(query: LRRListQuery) -> LRRListResponse:
    started = perf_counter()
    bom = await lrr_gateway.load_bom(
        material_number=query.material_number,
        product_models=[*query.product_models, *([query.product_model] if query.product_model else [])],
        bases=[*query.bases, *([query.base] if query.base else [])],
        customer_ids=query.customer_ids,
        planned_date_from=query.planned_date_from,
        planned_date_to=query.planned_date_to,
    )
    usage_rows = aggregate_lrr(bom, [], include_details=False)[0]
    if _has_filter_criteria(query) or _requires_full_fault_sort(query):
        faults = await lrr_gateway.load_faults(
            production_orders={str(row.get("AUFNR_1") or "") for row in bom},
            sales_orders={str(row.get("VBELN_EX") or "") for row in bom},
            # LRR only links repairs from the BOM's planned month. When the
            # user has not specified a narrower NG range, this bounds the
            # source lookup to the selected planned period.
            date_from=query.ng_date_from or query.planned_date_from,
            date_to=query.ng_date_to or query.planned_date_to,
            include_details=False,
        )
        rows = aggregate_lrr(bom, faults, include_details=False)[0]
        response = _full_response(rows, query)
        fault_scope = "full"
    else:
        # The unfiltered warm-cache path stays lightweight. Filtered queries
        # take the full branch above so the dashboard can show fault counts and
        # rates immediately after the user submits conditions.
        response = _full_usage_response(usage_rows, query)
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


async def _wait_for_request_disconnect(request: Request) -> None:
    while not await request.is_disconnected():
        await asyncio.sleep(0.2)


async def _load_lrr_list_for_request(
    request: Request, query: LRRListQuery
) -> tuple[LRRListResponse | None, str | None]:
    load_task = asyncio.create_task(
        lrr_list_cache.get_or_load(query, lambda: _load(query))
    )
    if getattr(request, "_receive", None) is None:
        response, state = await load_task
        return response, state

    disconnect_task = asyncio.create_task(_wait_for_request_disconnect(request))
    try:
        done, _ = await asyncio.wait(
            {load_task, disconnect_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        if load_task in done:
            response, state = await load_task
            return response, state
        load_task.cancel()
        with suppress(asyncio.CancelledError):
            await load_task
        return None, None
    finally:
        disconnect_task.cancel()
        with suppress(asyncio.CancelledError):
            await disconnect_task


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
    productModel: Annotated[list[str] | None, Query()] = None,
    base: Annotated[list[str] | None, Query()] = None,
    customerId: Annotated[list[str] | None, Query()] = None,
    sortBy: str = "month",
    sortDir: str = "asc",
):
    _require_bounded_bom_scope(materialNumber, plannedDateFrom, plannedDateTo)
    has_scope_filter = _has_lrr_scope_filter(materialNumber, productModel, base, customerId)
    _validate_lrr_date_range(
        plannedDateFrom,
        plannedDateTo,
        "计划日期",
        require_scope_filter=not has_scope_filter,
    )
    _validate_lrr_date_range(
        ngDateFrom,
        ngDateTo,
        "故障日期",
        require_scope_filter=not has_scope_filter,
    )
    query = LRRListQuery(
        page=page,
        limit=limit,
        planned_date_from=plannedDateFrom,
        planned_date_to=plannedDateTo,
        ng_date_from=ngDateFrom,
        ng_date_to=ngDateTo,
        material_number=materialNumber,
        product_models=tuple(sorted(set(productModel or []))),
        bases=tuple(sorted(set(base or []))),
        base_permissions=current_base_permissions(),
        customer_ids=tuple(sorted(set(customerId or []))),
        sort_by=sortBy,
        sort_dir=sortDir,
    )
    cached_query = _canonical_lrr_cache_query(query)
    response, _ = await _load_lrr_list_for_request(request, cached_query)
    if response is None:
        return Response(status_code=499)
    return _paginate_response(response, query)


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
    productModel: Annotated[list[str] | None, Query()] = None,
    base: Annotated[list[str] | None, Query()] = None,
    customerId: Annotated[list[str] | None, Query()] = None,
    month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
    limit: int = Query(50000, ge=1, le=50000),
):
    del request
    _require_bounded_bom_scope(materialNumber, plannedDateFrom, plannedDateTo)
    has_scope_filter = _has_lrr_scope_filter(materialNumber, productModel, base, customerId)
    _validate_lrr_date_range(
        plannedDateFrom,
        plannedDateTo,
        "计划日期",
        require_scope_filter=not has_scope_filter,
    )
    _validate_lrr_date_range(
        ngDateFrom,
        ngDateTo,
        "故障日期",
        require_scope_filter=not has_scope_filter,
    )
    bom = await lrr_gateway.load_bom(
        material_number=materialNumber,
        product_models=productModel,
        bases=base,
        customer_ids=tuple(sorted(set(customerId or []))),
        month=month,
        planned_date_from=plannedDateFrom,
        planned_date_to=plannedDateTo,
    )
    faults = await lrr_gateway.load_faults(
        production_orders={str(row.get("AUFNR_1") or "") for row in bom},
        sales_orders={str(row.get("VBELN_EX") or "") for row in bom},
        # Keep detail/export records on the same planned-production period as
        # the list aggregation. An explicit NG range remains an override for
        # compatibility with the API contract.
        date_from=ngDateFrom or plannedDateFrom,
        date_to=ngDateTo or plannedDateTo,
    )
    details = aggregate_lrr(bom, faults)[1]
    return LRRFaultDetailsResponse(
        items=details[:limit], total=len(details), truncated=len(details) > limit
    )
