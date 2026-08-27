"""Shared RTY sales-order and filter query service."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from fastapi import HTTPException

from app.models.documents import Collections

YEAR_START = "2026-01-01"
YEAR_END = "2026-12-31"
REPAIR_YEAR_START = "20260101"
REPAIR_YEAR_END = "20261231"
MAX_DETAIL_ROW_COUNT = 50_000
MAX_BINDING_ROW_COUNT = 100_000
MAX_CYCLE_SALES_ROW_COUNT = 100_000
COMPOSITE_MODEL_ITEMS: dict[str, frozenset[str]] = {
    "6210 C21 BOX": frozenset({"6410 X21"}),
    "6215 C32": frozenset({"6615 X32"}),
}
OrderScope = Literal["normal", "l6"]
CalculationMethod = Literal["normal", "composite"]
EXCLUDED_ORDER_STATUSES = ("DLID", "RELEASED")
EXCLUDED_ORDER_TYPES = ("C001",)


def split_values(value: str | None) -> list[str]:
    return list(
        dict.fromkeys(item.strip() for item in re.split(r"[,，\n]+", value or "") if item.strip())
    )


def normalize_order(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text.lstrip("0") or "0" if text.isdigit() else text


def order_variants(values: list[str]) -> list[str]:
    """Match SAP compact AUFNR and 12-digit repair AUFNR representations."""
    variants: set[str] = set()
    for value in values:
        normalized = normalize_order(value)
        if not normalized:
            continue
        variants.add(value.strip())
        variants.add(normalized)
        if normalized.isdigit():
            variants.add(normalized.zfill(12))
    return sorted(variants)


def rty_order_scope_match(order_scope: OrderScope = "normal") -> dict[str, Any]:
    match: dict[str, Any] = {
        "data.ZSTAT": {"$nin": EXCLUDED_ORDER_STATUSES},
        "data.AUART": {"$nin": EXCLUDED_ORDER_TYPES},
    }
    match["data.IF_L6"] = "X" if order_scope == "l6" else {"$nin": ["X"]}
    return match


def validate_date(value: str) -> str:
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="日期格式必须为 YYYY-MM-DD") from exc


def _sales_date_match(date_from: str | None, date_to: str | None) -> dict[str, str]:
    lower = max(YEAR_START, validate_date(date_from)) if date_from else YEAR_START
    upper = min(YEAR_END, validate_date(date_to)) if date_to else YEAR_END
    if lower > upper:
        return {"$gte": "9999-12-31", "$lte": "0000-01-01"}
    return {"$gte": lower, "$lte": upper}


async def build_sales_filter(
    db: Any,
    *,
    sales_order: str | None = None,
    production_order: str | None = None,
    serial_number: str | None = None,
    base: str | None = None,
    product_model: str | None = None,
    customer: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    order_scope: OrderScope = "normal",
    calculation_method: CalculationMethod | None = None,
) -> dict[str, Any]:
    """Build one eligible sales-order filter, resolving SN to AUFNR in bulk."""
    match: dict[str, Any] = {
        "gstrs_date": _sales_date_match(date_from, date_to),
        **rty_order_scope_match(order_scope),
    }
    if calculation_method == "composite":
        match["data.MAKTX_TH"] = {"$in": list(COMPOSITE_MODEL_ITEMS)}
    elif calculation_method == "normal":
        match["data.MAKTX_TH"] = {"$nin": list(COMPOSITE_MODEL_ITEMS)}
    for field, value in (("data.VBELN", sales_order), ("aufnr", production_order)):
        values = split_values(value)
        if not values:
            continue
        if field == "aufnr":
            values = order_variants(values)
        match[field] = {"$in": values} if len(values) > 1 else values[0]
    if base and base != "all":
        match["data.LGORT"] = base
    if product_model and product_model != "all":
        if (calculation_method == "composite" and product_model not in COMPOSITE_MODEL_ITEMS) or (
            calculation_method == "normal" and product_model in COMPOSITE_MODEL_ITEMS
        ):
            match["data.MAKTX_TH"] = {"$in": []}
        else:
            match["data.MAKTX_TH"] = product_model
    if customer:
        match["data.KID"] = customer
    if serial_number:
        repairs = (
            await db[Collections.REPAIR_RECORDS_SAP]
            .find({"PCODE": serial_number.strip()}, {"AUFNR": 1})
            .to_list(length=10_000)
        )
        orders = order_variants([str(repair.get("AUFNR") or "") for repair in repairs])
        match["aufnr"] = {"$in": orders} if orders else {"$in": []}
    return match


def group_field(
    sales_order: str | None,
    production_order: str | None,
    base: str | None,
    product_model: str | None,
    customer: str | None,
) -> str:
    if production_order:
        return "aufnr"
    if sales_order:
        return "data.VBELN"
    if customer:
        return "data.KID"
    if product_model and product_model != "all":
        return "data.MAKTX_TH"
    if base and base != "all":
        return "data.LGORT"
    return "data.VBELN"


async def sales_groups(
    db: Any, sales_filter: dict[str, Any], group_by: str, page: int, limit: int
) -> tuple[int, list[dict[str, Any]]]:
    pipeline = [
        {"$match": sales_filter},
        {"$sort": {"gstrs_date": 1, "aufnr": 1}},
        {
            "$group": {
                "_id": f"${group_by}",
                "first": {"$first": "$$ROOT"},
                "input_count": {
                    "$sum": {
                        "$convert": {
                            "input": "$data.WMENG",
                            "to": "double",
                            "onError": 0,
                            "onNull": 0,
                        }
                    }
                },
                "sales_orders": {"$addToSet": "$data.VBELN"},
                "production_orders": {"$addToSet": "$aufnr"},
                "customers": {"$addToSet": "$data.KID"},
            }
        },
        {"$match": {"_id": {"$nin": [None, ""]}}},
        {
            "$facet": {
                "metadata": [{"$count": "total"}],
                "data": [
                    {"$sort": {"_id": 1}},
                    {"$skip": (page - 1) * limit},
                    {"$limit": limit},
                ],
            }
        },
    ]
    result = await db[Collections.SALES_ORDERS_SAP].aggregate(pipeline).to_list(length=1)
    facet = result[0] if result else {"metadata": [], "data": []}
    total = facet["metadata"][0]["total"] if facet.get("metadata") else 0
    return total, facet.get("data", [])


async def option_totals(
    db: Any, field: str, order_scope: OrderScope = "normal"
) -> list[dict[str, Any]]:
    pipeline = [
        {
            "$match": {
                "gstrs_date": {"$gte": YEAR_START, "$lte": YEAR_END},
                field: {"$nin": [None, ""]},
                **rty_order_scope_match(order_scope),
            }
        },
        {
            "$group": {
                "_id": f"${field}",
                "count": {
                    "$sum": {
                        "$convert": {
                            "input": "$data.WMENG",
                            "to": "double",
                            "onError": 0,
                            "onNull": 0,
                        }
                    }
                },
            }
        },
        {"$sort": {"_id": 1}},
    ]
    return list(await db[Collections.SALES_ORDERS_SAP].aggregate(pipeline).to_list(length=10_000))
