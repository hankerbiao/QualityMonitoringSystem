"""Raw LRR data loading from the independent data gateway.

This module only normalizes gateway documents and applies source filters.  LRR
quantities, fault matching, grouping and rates remain in ``api.lrr``.
"""

from __future__ import annotations

import asyncio
import calendar
from time import perf_counter
from typing import Any

from app.core.logger import log_info
from app.services.data_gateway_client import data_gateway
from app.services.rty_shared import order_variants

MAX_BATCH_ORDER_FILTERS = 200
MAX_BATCH_SN_FILTERS = 1_000


def _raw(item: dict[str, Any]) -> dict[str, Any]:
    raw = item.get("raw")
    return raw if isinstance(raw, dict) else item


def _norm_order(value: Any) -> str:
    text = str(value or "").strip()
    return text.zfill(12) if text.isdigit() else text


def _norm_sales_order(value: Any) -> str:
    text = str(value or "").strip().rsplit("--", 1)[0]
    return text.lstrip("0") or "0" if text.isdigit() else text


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
    # The BOM stream projection omits MAKTX in some gateway deployments,
    # while the paginated view may expose one of these aliases.
    material_description = next(
        (
            str(raw.get(field) or item.get(field) or "").strip()
            for field in ("MAKTX", "materialDescription", "materialDesc", "description")
            if raw.get(field) or item.get(field)
        ),
        "",
    )
    return {
        **raw,
        "AUFNR_1": raw.get("AUFNR_1") or raw.get("AUFNR") or "",
        "VBELN_EX": raw.get("VBELN_EX") or raw.get("VBELN") or "",
        "MENGE_A": raw.get("MENGE_A") if raw.get("MENGE_A") is not None else raw.get("MENGE", 0),
        "MATNR": raw.get("MATNR") or "",
        "MAKTX": material_description,
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
        "ZNGGZ": raw.get("ZNGGZ") or item.get("ngStation") or "",
        "ZNGWD": (
            raw.get("ZNGWD")
            or raw.get("ZMCOD1")
            or raw.get("ERROR_CODE")
            or item.get("errorCode")
            or ""
        ),
        "ZWXWD": raw.get("ZWXWD")
        or raw.get("ZGZMS")
        or raw.get("ERROR_MSG")
        or raw.get("RPDESC")
        or item.get("faultDescription")
        or item.get("errorDescription")
        or "",
        "ZDATE_WX": raw.get("ZDATE_WX") or str(item.get("repairAt") or "")[:10].replace("-", ""),
        "ZTIME": raw.get("ZTIME") or "",
        "ZJXMC": raw.get("ZJXMC") or raw.get("MAKTX") or item.get("materialDescription") or "",
        "MATNR": raw.get("MATNR") or item.get("materialNumber") or "",
    }


def _deduplicate_faults(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Discard mirrored repair records from padded and unpadded SAP orders."""
    seen: set[tuple[str, ...]] = set()
    result = []
    for row in rows:
        key = tuple(
            str(row.get(field) or "").strip().lstrip("0") or "0"
            if field in {"AUFNR", "VBELN"}
            else str(row.get(field) or "").strip()
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
    # Keep each logical filter as one request so the gateway can stream the
    # indexed range sequentially; splitting a broad range multiplies Mongo
    # cursor setup and response headers without reducing the raw row count.
    terms = search_terms or [""]
    chunks = [(date_start, date_end)]
    requests = [
        data_gateway.all_bom_rows(
            **{**base_filters, "dateFrom": chunk_start, "dateTo": chunk_end, "keyword": term},
        )
        for term in terms
        for chunk_start, chunk_end in chunks
    ]
    bom_stream_started_at = perf_counter()
    batches = await asyncio.gather(*requests)
    bom_stream_ms = (perf_counter() - bom_stream_started_at) * 1000
    for batch in batches:
        raw_rows.extend(batch)

    # The low-overhead stream intentionally uses a narrow projection on some
    # gateway versions and therefore has no material description. A PN-scoped
    # detail request is small enough to use the regular view, whose projection
    # includes MAKTX, so the detail modal remains informative.
    if material_number and raw_rows and not any(
        normalize_bom(item).get("MAKTX") for item in raw_rows
    ):
        paged_rows = await data_gateway.all_pages(
            "GET",
            "/api/views/ZSGV_ZSD124",
            filters={**base_filters, "keyword": ""},
            max_rows=1_000_000,
        )
        if paged_rows:
            descriptions_by_key = {
                str(item.get("id") or item.get("_id") or ""): str(
                    normalize_bom(item).get("MAKTX") or ""
                ).strip()
                for item in paged_rows
                if item.get("id") or item.get("_id")
            }
            descriptions_by_material: dict[str, str] = {}
            for item in paged_rows:
                normalized = normalize_bom(item)
                material = str(normalized.get("MATNR") or "").strip()
                description = str(normalized.get("MAKTX") or "").strip()
                if material and description and material not in descriptions_by_material:
                    descriptions_by_material[material] = description
            # Keep the streamed row as the source of matching semantics, but
            # attach the richer description for presentation.
            for item in raw_rows:
                key = str(item.get("id") or item.get("_id") or "")
                material = str(item.get("MATNR") or "").strip()
                description = descriptions_by_key.get(key) or descriptions_by_material.get(
                    material, ""
                )
                if description:
                    item["_match_description"] = str(item.get("MAKTX") or "").strip()
                    item["MAKTX"] = description
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
    metadata_started_at = perf_counter()
    orders = await data_gateway.all_orders()
    metadata_load_ms = (perf_counter() - metadata_started_at) * 1000
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
    log_info(
        "LRR gateway BOM timings "
        f"bom_stream_ms={bom_stream_ms:.1f} metadata_load_ms={metadata_load_ms:.1f} "
        f"bom_rows={len(result)}"
    )
    return result


async def material_descriptions(material_numbers: list[str]) -> dict[str, str]:
    """Load descriptions for a bounded set of PN values from the full view."""
    materials = list(dict.fromkeys(str(value or "").strip() for value in material_numbers))
    materials = [value for value in materials if value]
    if not materials:
        return {}
    rows = await data_gateway.all_pages(
        "GET",
        "/api/views/ZSGV_ZSD124",
        filters={"materialCode": ",".join(materials), "keyword": ""},
        max_rows=1_000_000,
    )
    result: dict[str, str] = {}
    for row in rows:
        normalized = normalize_bom(row)
        material = str(normalized.get("MATNR") or "").strip()
        description = str(normalized.get("MAKTX") or "").strip()
        if material and description and material not in result:
            result[material] = description
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
    date_start, date_end = date_from or "", date_to or ""
    # A broad GET would page through the complete repair collection. Indexed
    # POST lookups keep the query selective even when thousands of BOM orders
    # are involved.
    semaphore = asyncio.Semaphore(12)

    async def fetch_by_production_order(chunk: list[str]) -> list[dict[str, Any]]:
        async with semaphore:
            return await data_gateway.fault_lookup(
                production_orders=chunk, date_from=date_start, date_to=date_end
            )

    async def fetch_by_sales_order(chunk: list[str]) -> list[dict[str, Any]]:
        async with semaphore:
            return await data_gateway.fault_lookup(
                sales_orders=chunk, date_from=date_start, date_to=date_end
            )

    lookup_requests = []
    variants = order_variants(sorted(production_orders))
    lookup_requests.extend(
        fetch_by_production_order(variants[index : index + MAX_BATCH_ORDER_FILTERS])
        for index in range(0, len(variants), MAX_BATCH_ORDER_FILTERS)
    )
    sales = sorted({_norm_sales_order(value) for value in sales_orders if _norm_sales_order(value)})
    lookup_requests.extend(
        fetch_by_sales_order(sales[index : index + MAX_BATCH_ORDER_FILTERS])
        for index in range(0, len(sales), MAX_BATCH_ORDER_FILTERS)
    )
    # The gateway's indexed sales-order lookup is not consistent across
    # deployments: some indexes store the SAP-padded value, others the
    # normalized value. Query both forms when they differ.
    padded_sales = sorted(
        {
            str(value).strip().rsplit("--", 1)[0]
            for value in sales_orders
            if str(value).strip().rsplit("--", 1)[0]
            and str(value).strip().rsplit("--", 1)[0] not in sales
        }
    )
    lookup_requests.extend(
        fetch_by_sales_order(padded_sales[index : index + MAX_BATCH_ORDER_FILTERS])
        for index in range(0, len(padded_sales), MAX_BATCH_ORDER_FILTERS)
    )
    batches = await asyncio.gather(*lookup_requests)
    links = [normalize_fault(item) for batch in batches for item in batch]
    sns = sorted({str(row.get("PCODE") or "").strip() for row in links if row.get("PCODE")})
    if not sns:
        return _deduplicate_faults(links)

    async def fetch_details(chunk: list[str]) -> list[dict[str, Any]]:
        async with semaphore:
            return await data_gateway.fault_rows_by_sns(
                chunk, date_from=date_start, date_to=date_end
            )

    detail_batches = await asyncio.gather(
        *(
            fetch_details(sns[index : index + MAX_BATCH_SN_FILTERS])
            for index in range(0, len(sns), MAX_BATCH_SN_FILTERS)
        )
    )
    details = [normalize_fault(item) for batch in detail_batches for item in batch]
    resolved_sns = {str(row.get("PCODE") or "").strip() for row in details}
    # Keep lookup-only rows when the detailed source has no matching SN,
    # so a transiently incomplete detail index does not undercount LRR.
    return _deduplicate_faults(
        details + [row for row in links if str(row.get("PCODE") or "").strip() not in resolved_sns]
    )


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
