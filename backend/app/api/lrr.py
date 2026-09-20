"""LRR endpoints: gateway loading, pure aggregation, and cache orchestration."""

from __future__ import annotations

import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from time import perf_counter
from typing import Any

from fastapi import APIRouter, Query, Request

from app.core.logger import audit_log, log_info
from app.schemas.lrr import (
    LRRData,
    LRRFaultDetail,
    LRRFaultDetailsResponse,
    LRRListResponse,
    LRROptions,
    LRRSummary,
)
from app.services import lrr_gateway
from app.services.lrr_list_cache import LRRListQuery, lrr_list_cache

router = APIRouter()


def normalize_production_order(value: Any) -> str:
    value = str(value or "").strip()
    return value.zfill(12) if value and value.isdigit() else value


def normalize_sales_order(value: Any) -> str:
    value = str(value or "").strip().rsplit("--", 1)[0]
    return value.lstrip("0") or "0" if value.isdigit() else value


def _quantity(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return Decimal(0)


def _normalized_description(value: Any) -> str:
    return " ".join(str(value or "").split()).casefold()


def _month_from_date(value: Any) -> str:
    compact = re.sub(r"\D", "", str(value or ""))
    if len(compact) < 6 or not compact[:6].isdigit():
        return ""
    month = int(compact[4:6])
    return f"{compact[:4]}-{month:02d}" if 1 <= month <= 12 else ""


def aggregate_lrr(
    bom_rows: list[dict[str, Any]],
    fault_rows: list[dict[str, Any]],
    *,
    include_details: bool = True,
) -> tuple[list[LRRData], list[LRRFaultDetail]]:
    groups: dict[str, dict[str, Any]] = {}
    for bom in bom_rows:
        material = str(bom.get("MATNR") or "").strip()
        month = _month_from_date(bom.get("GSTRS"))
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
        order = normalize_production_order(fault.get("mfg_order") or fault.get("AUFNR"))
        sales = normalize_sales_order(fault.get("sale_no") or fault.get("VBELN"))
        fault_material = str(fault.get("MATNR") or "").strip()
        compact_date = re.sub(
            r"\D", "", str(fault.get("repair_time") or fault.get("ZDATE_WX") or "")
        )
        fault_month = compact_date[:6]
        # Production order is the precise ownership key. A sales order can
        # contain several production orders, so using it as an OR fallback
        # when AUFNR is present can attach a fault from another order.
        link_candidates = (
            (key, group)
            for key, group in active.items()
            if (order in group["orders"] if order else sales in group["sales"])
        )
        candidates = list(link_candidates)
        if fault_material:
            candidates = [
                (key, group) for key, group in candidates if group["material"] == fault_material
            ]
        else:
            fault_description = _normalized_description(
                fault.get("ZJXMC") or fault.get("materialDescription")
            )
            candidates = [
                (key, group)
                for key, group in candidates
                if group["match_description"]
                and _normalized_description(group["match_description"]) == fault_description
            ]

        # Planned-date filters select BOM orders by GSTRS. A repair can happen
        # in a later month, so do not discard a uniquely identified order
        # merely because its NG month differs from the BOM month. If one order
        # spans multiple BOM months, use the NG month only as a tie-breaker.
        if len(candidates) > 1 and fault_month:
            month_candidates = [
                (key, group)
                for key, group in candidates
                if fault_month == group["month"].replace("-", "")
            ]
            if len(month_candidates) == 1:
                candidates = month_candidates

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
                    sn=str(fault.get("PCODE") or fault.get("sn") or ""),
                    faultType=str(
                        fault.get("ZNGWD")
                        or fault.get("ZNGGZ")
                        or fault.get("fault_category")
                        or ""
                    ),
                    faultDesc=str(fault.get("ZWXWD") or fault.get("fault_desc") or ""),
                    ngTime=" ".join(
                        value
                        for value in (
                            str(fault.get("ZDATE_WX") or fault.get("repair_time") or "").strip(),
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


def _response(rows: list[LRRData], query: LRRListQuery) -> LRRListResponse:
    sort_field = (
        query.sort_by
        if query.sort_by in {"materialNumber", "issuedQuantity", "faultCount", "lrrRate"}
        else "lrrRate"
    )
    rows = sorted(
        rows,
        key=lambda row: (getattr(row, sort_field) is None, getattr(row, sort_field) or 0),
        reverse=query.sort_dir == "desc",
    )
    start = (query.page - 1) * query.limit
    total_quantity = sum((_quantity(row.issuedQuantity) for row in rows), Decimal(0))
    return LRRListResponse(
        items=rows[start : start + query.limit],
        total=len(rows),
        page=query.page,
        limit=query.limit,
        has_more=start + query.limit < len(rows),
        summary=LRRSummary(
            materialCount=len(rows),
            issuedQuantity=float(total_quantity),
            totalFaults=sum(row.faultCount for row in rows),
            overallLrr=round(sum(row.faultCount for row in rows) / float(total_quantity) * 100, 2)
            if total_quantity
            else None,
        ),
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
    faults = await lrr_gateway.load_faults(
        production_orders={str(row.get("AUFNR_1") or "") for row in bom},
        sales_orders={str(row.get("VBELN_EX") or "") for row in bom},
        date_from=query.ng_date_from,
        date_to=query.ng_date_to,
    )
    rows = aggregate_lrr(bom, faults, include_details=False)[0]
    response = _response(rows, query)
    # The stream projection used for the large BOM scan may omit MAKTX. Fill
    # only the requested page's PN values from the richer paginated view.
    missing = [row.materialNumber for row in response.items if not row.materialDescription]
    if missing:
        descriptions = await lrr_gateway.material_descriptions(missing)
        for row in response.items:
            if not row.materialDescription:
                row.materialDescription = descriptions.get(row.materialNumber, "")
    log_info(
        f"LRR gateway query={query.fingerprint[:12]} total_ms={(perf_counter() - started) * 1000:.1f}"
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
    sortBy: str = "lrrRate",
    sortDir: str = "desc",
):
    del request
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
