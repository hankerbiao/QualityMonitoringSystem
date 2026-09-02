"""Raw LRR data loading from the independent data gateway.

This module only normalizes gateway documents and applies source filters.  LRR
quantities, fault matching, grouping and rates remain in ``api.lrr``.
"""

from __future__ import annotations

import calendar
from typing import Any

from app.services.data_gateway_client import data_gateway
from app.services.rty_queries import order_variants

MAX_BATCH_ORDER_FILTERS = 200


def _raw(item: dict[str, Any]) -> dict[str, Any]:
    raw = item.get("raw")
    return raw if isinstance(raw, dict) else item


def _norm_order(value: Any) -> str:
    text = str(value or "").strip()
    return text.zfill(12) if text.isdigit() else text


def _split_values(value: str | None) -> list[str]:
    return [item.strip() for item in str(value or "").replace("，", ",").split(",") if item.strip()]


def _month_bounds(month: str | None) -> tuple[str, str]:
    value = str(month or "").replace("-", "")
    if len(value) != 6 or not value.isdigit() or not 1 <= int(value[4:]) <= 12:
        return "", ""
    year, month_number = int(value[:4]), int(value[4:])
    return (
        f"{year:04d}-{month_number:02d}-01",
        f"{year:04d}-{month_number:02d}-{calendar.monthrange(year, month_number)[1]:02d}",
    )


def normalize_bom(item: dict[str, Any]) -> dict[str, Any]:
    raw = _raw(item)
    return {
        **raw,
        "AUFNR_1": raw.get("AUFNR_1") or raw.get("AUFNR") or "",
        "VBELN_EX": raw.get("VBELN_EX") or raw.get("VBELN") or "",
        "MENGE_A": raw.get("MENGE_A") if raw.get("MENGE_A") is not None else raw.get("MENGE", 0),
        "MATNR": raw.get("MATNR") or "",
        "LGORT": raw.get("LGORT") or raw.get("WERKS") or "",
        "BUDAT_MKPF": str(raw.get("BUDAT_MKPF") or "")[:8],
    }


def normalize_fault(item: dict[str, Any]) -> dict[str, Any]:
    raw = _raw(item)
    return {
        **raw,
        "_id": item.get("id") or raw.get("_source_key") or raw.get("_id"),
        "AUFNR": raw.get("AUFNR") or item.get("productionOrder") or "",
        "VBELN": raw.get("VBELN") or item.get("salesOrder") or "",
        "PCODE": raw.get("PCODE") or item.get("serialNumber") or item.get("hostBarcode") or "",
        "ZNGWD": raw.get("ZNGWD") or item.get("ngStation") or item.get("errorCode") or "",
        "ZWXWD": raw.get("ZWXWD")
        or item.get("faultDescription")
        or item.get("errorDescription")
        or "",
        "ZDATE_WX": raw.get("ZDATE_WX") or str(item.get("repairAt") or "")[:10].replace("-", ""),
        "ZTIME": raw.get("ZTIME") or "",
        "ZJXMC": raw.get("ZJXMC") or item.get("materialDescription") or "",
    }


async def load_bom(
    *,
    production_order: str | None = None,
    sales_order: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    material_number: str | None = None,
    base: str | None = None,
    customer_id: str | None = None,
    month: str | None = None,
    order_keyword: str | None = None,
) -> list[dict[str, Any]]:
    # Some deployed gateway versions do not apply productionOrder/salesOrder
    # filters on HANA views. Use its indexed keyword search for recall and
    # retain exact order matching below for compatibility with both versions.
    search_terms = _split_values(order_keyword)
    search_terms.extend(_split_values(production_order))
    search_terms.extend(_split_values(sales_order))
    search_terms = list(dict.fromkeys(search_terms))
    date_start, date_end = date_from or "", date_to or ""
    if month and not date_start and not date_end:
        date_start, date_end = _month_bounds(month)
    base_filters = {
        "dateFrom": date_start,
        "dateTo": date_end,
        "materialCode": material_number or "",
    }
    raw_rows: list[dict[str, Any]] = []
    for term in search_terms or [""]:
        filters = {**base_filters, "keyword": term}
        raw_rows.extend(await data_gateway.all_view("ZSGV_ZSD124", **filters))
    seen: set[str] = set()
    rows = []
    for item in raw_rows:
        normalized = normalize_bom(item)
        key = str(normalized.get("id") or normalized.get("_id") or repr(normalized))
        if key not in seen:
            seen.add(key)
            rows.append(normalized)
    order_keywords = [value.lower() for value in _split_values(order_keyword)]
    production_values = {
        _norm_order(value)
        for value in str(production_order or "").replace("，", ",").split(",")
        if value.strip()
    }
    sales_values = {
        str(value).strip().lstrip("0") or "0"
        for value in str(sales_order or "").replace("，", ",").split(",")
        if value.strip()
    }
    for row in rows:
        production = _norm_order(row.get("AUFNR_1"))
        sales = str(row.get("VBELN_EX") or "").strip()
        row["AUFNR_1"] = production
        if production_values and production not in production_values:
            row["_skip"] = True
        if sales_values and (sales.lstrip("0") or "0") not in sales_values:
            row["_skip"] = True
        raw_month = str(row.get("BUDAT_MKPF") or "")[:6]
        if month and raw_month != month.replace("-", ""):
            row["_skip"] = True
        if order_keywords and not any(
            keyword in f"{production} {sales}".lower() for keyword in order_keywords
        ):
            row["_skip"] = True
    rows = [row for row in rows if not row.get("_skip")]
    if not rows:
        return []
    # BOM does not consistently carry customer/base in the source view. Join
    # the gateway's order summaries by normalized production order.
    # The gateway accepts batch order filters, but a full BOM page can contain
    # hundreds of orders and their zero-padded variants. Reading the small
    # order master once avoids exceeding proxy URL limits and keeps the join
    # deterministic across gateway versions.
    orders = await data_gateway.all_orders()
    metadata: dict[str, tuple[str, str]] = {}
    for item in orders:
        raw = _raw(item)
        data = raw.get("data") if isinstance(raw.get("data"), dict) else raw
        key = _norm_order(item.get("aufnr") or data.get("AUFNR"))
        if key:
            metadata[key] = (
                str(
                    data.get("LGORT") or data.get("WERKS") or item.get("inventoryLocation") or ""
                ).strip(),
                str(data.get("KID") or item.get("customerId") or "").strip(),
            )
    result = []
    for row in rows:
        base_value, customer = metadata.get(_norm_order(row.get("AUFNR_1")), ("", ""))
        if base and base.strip() not in {str(row.get("LGORT") or "").strip(), base_value}:
            continue
        if customer_id and customer_id.strip() != customer:
            continue
        row["_base"] = str(row.get("LGORT") or base_value).strip()
        row["_customer_id"] = customer
        result.append(row)
    return result


async def load_faults(
    *,
    production_orders: set[str],
    sales_orders: set[str] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    month: str | None = None,
) -> list[dict[str, Any]]:
    sales_orders = sales_orders or set()
    if not production_orders and not sales_orders:
        return []
    if month and not date_from and not date_to:
        date_from, date_to = _month_bounds(month)
    filters: dict[str, Any] = {
        "dateFrom": date_from or "",
        "dateTo": date_to or "",
    }
    if production_orders and len(production_orders) <= MAX_BATCH_ORDER_FILTERS:
        filters["productionOrders"] = ",".join(order_variants(sorted(production_orders)))
    if sales_orders and len(sales_orders) <= MAX_BATCH_ORDER_FILTERS:
        filters["salesOrders"] = ",".join(sorted(sales_orders))
    return [normalize_fault(item) for item in await data_gateway.all_faults(**filters)]


async def options() -> dict[str, list[str]]:
    orders = await data_gateway.all_orders()
    production = {_norm_order(item.get("aufnr") or _raw(item).get("AUFNR")) for item in orders}
    sales = {
        str(item.get("salesOrder") or _raw(item).get("VBELN") or "").strip().lstrip("0") or "0"
        for item in orders
    }
    bases = set()
    customers = set()
    materials = set()
    for item in orders:
        raw = _raw(item)
        data = raw.get("data") if isinstance(raw.get("data"), dict) else raw
        materials.add(str(data.get("MATNR") or "").strip())
        bases.add(
            str(
                data.get("LGORT") or data.get("WERKS") or item.get("inventoryLocation") or ""
            ).strip()
        )
        customers.add(str(data.get("KID") or item.get("customerId") or "").strip())
    return {
        "productionOrders": sorted(value for value in production if value),
        "salesOrders": sorted(value for value in sales if value),
        "materialNumbers": sorted(value for value in materials if value),
        "bases": sorted(value for value in bases if value),
        "customerIds": sorted(value for value in customers if value),
    }
