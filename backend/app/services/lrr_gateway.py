"""Raw LRR data loading from the independent data gateway.

This module only normalizes gateway documents and applies source filters.  LRR
quantities, fault matching, grouping and rates remain in ``api.lrr``.
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta
from time import perf_counter
from typing import Any

from app.core.logger import log_info
from app.services.data_gateway_client import DataGatewayError, data_gateway
from app.services.lrr_normalization import (
    compact_date,
    month_bounds,
    month_from_date,
    normalize_production_order,
    normalize_sales_order,
    source_data,
)
from app.services.rty_shared import order_variants

MAX_BATCH_ORDER_FILTERS = 200
MAX_BATCH_SN_FILTERS = 1_000
MAX_BATCH_FULL_FAULT_FILTERS = 100
MATERIAL_DAILY_SPLIT_MAX_DAYS = 62


def _norm_material_number(value: Any) -> str:
    """Convert a displayed SAP PN back to its 18-character internal value."""
    text = str(value or "").strip()
    return text.zfill(18) if text.isdigit() and len(text) <= 18 else text


def _split_values(value: str | None) -> list[str]:
    return [item.strip() for item in str(value or "").replace("，", ",").split(",") if item.strip()]


def normalize_bom(item: dict[str, Any]) -> dict[str, Any]:
    data = source_data(item)
    return {
        **data,
        "_id": item.get("id") or data.get("_id"),
        "AUFNR_1": data.get("AUFNR_1", ""),
        "VBELN_EX": data.get("VBELN_EX", ""),
        "MENGE_A": data.get("MENGE_A", 0),
        "MATNR": data.get("MATNR", ""),
        "MAKTX": data.get("MAKTX", ""),
        "LGORT": data.get("LGORT", ""),
        "GSTRS": str(data.get("GSTRS", ""))[:10],
        "BUDAT_MKPF": str(data.get("BUDAT_MKPF", ""))[:8],
    }


def normalize_fault(item: dict[str, Any]) -> dict[str, Any]:
    data = source_data(item)
    # Some repair records store the replaced material in RECORD01REPAIRM
    # instead of MATNR. Keep MATNR as the canonical field for LRR matching,
    # but only fall back when MATNR is genuinely empty.
    material_number = (
        str(data.get("MATNR") or "").strip() or str(data.get("RECORD01REPAIRM") or "").strip()
    )
    return {
        **data,
        "_id": item.get("id") or data.get("_id"),
        "AUFNR": data.get("AUFNR", ""),
        "VBELN": data.get("VBELN", ""),
        "PCODE": data.get("PCODE", ""),
        "ZNGGZ": data.get("ZNGGZ", ""),
        "ZNGWD": data.get("ZNGWD", ""),
        "ZWXWD": data.get("ZWXWD", ""),
        "ZDATE_WX": data.get("ZDATE_WX", ""),
        "ZTIME": data.get("ZTIME", ""),
        "GSTRS": data.get("GSTRS", data.get("plannedStartDate", "")),
        "ZJXMC": data.get("ZJXMC", ""),
        "MATNR": material_number,
    }


def normalize_fault_lookup(item: dict[str, Any]) -> dict[str, Any]:
    """Adapt the lookup endpoint's link envelope to the SAP fault contract."""
    data = source_data(item)
    if any(field in data for field in ("AUFNR", "VBELN", "PCODE")):
        return normalize_fault(item)
    return normalize_fault(
        {
            **data,
            "id": item.get("id"),
            "AUFNR": item.get("productionOrder", ""),
            "VBELN": item.get("salesOrder", ""),
            "PCODE": item.get("serialNumber", ""),
        }
    )


def _fault_source_key(row: dict[str, Any]) -> str:
    return str(row.get("_source_key") or row.get("_id") or "").strip()


def _merge_full_fault_rows(
    rows: list[dict[str, Any]], full_rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    full_by_key = {key: row for row in full_rows if (key := _fault_source_key(row))}
    return [full_by_key.get(_fault_source_key(row), row) for row in rows]


async def load_bom(
    *,
    production_order: str | None = None,
    sales_order: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    material_number: str | None = None,
    product_model: str | None = None,
    base: str | None = None,
    customer_ids: tuple[str, ...] = (),
    month: str | None = None,
    planned_date_from: str | None = None,
    planned_date_to: str | None = None,
    order_keyword: str | None = None,
) -> list[dict[str, Any]]:
    # Some deployed gateway versions do not apply productionOrder/salesOrder
    # filters on HANA views. Use its indexed keyword search for recall and
    # retain exact order matching below for compatibility with both versions.
    search_terms = _split_values(order_keyword)
    search_terms.extend(_split_values(production_order))
    search_terms.extend(_split_values(sales_order))
    search_terms = list(dict.fromkeys(search_terms))
    date_start, date_end = date_from or planned_date_from or "", date_to or planned_date_to or ""
    requested_month = month_from_date(month)
    requested_date_from = compact_date(planned_date_from)
    requested_date_to = compact_date(planned_date_to)
    base_filters = {
        "dateFrom": date_start,
        "dateTo": date_end,
        "timeField": "planned",
        "materialCode": _norm_material_number(material_number),
    }
    raw_rows: list[dict[str, Any]] = []
    # A material-specific range is selective but the gateway can still scan
    # the whole date interval before applying the material index. Daily
    # requests keep each source scan narrow and run concurrently. Restrict
    # this optimization to short PN-scoped ranges so broad model queries do
    # not turn into hundreds of gateway requests.
    terms = search_terms or [""]
    daily_dates: list[date] = []
    if material_number and date_start and date_end:
        try:
            start = date.fromisoformat(date_start)
            end = date.fromisoformat(date_end)
        except ValueError:
            start = end = None
        if start and end and start < end:
            span_days = (end - start).days + 1
            if span_days <= MATERIAL_DAILY_SPLIT_MAX_DAYS:
                daily_dates = [start + timedelta(days=index) for index in range(span_days)]

    if daily_dates:
        semaphore = asyncio.Semaphore(16)

        async def read_day(day: date, term: str) -> list[dict[str, Any]]:
            async with semaphore:
                return await data_gateway.all_bom_rows(
                    **{
                        **base_filters,
                        "dateFrom": day.isoformat(),
                        "dateTo": day.isoformat(),
                        "keyword": term,
                    }
                )

        requests = [read_day(day, term) for term in terms for day in daily_dates]
    else:
        requests = [
            data_gateway.all_bom_rows(
                **{**base_filters, "dateFrom": date_start, "dateTo": date_end, "keyword": term},
            )
            for term in terms
        ]
    bom_stream_started_at = perf_counter()
    batches = await asyncio.gather(*requests)
    bom_stream_ms = (perf_counter() - bom_stream_started_at) * 1000
    for batch in batches:
        raw_rows.extend(batch)

    # The low-overhead stream intentionally uses a narrow projection on some
    # gateway versions and therefore has no material description. A PN-scoped
    # description lookup stays bounded: one description per material, not every
    # historical posting of that material.
    if (
        material_number
        and raw_rows
        and not any(normalize_bom(item).get("MAKTX") for item in raw_rows)
    ):
        materials = list(
            dict.fromkeys(str(normalize_bom(item).get("MATNR") or "").strip() for item in raw_rows)
        )
        descriptions = await material_descriptions([value for value in materials if value])
        for item in raw_rows:
            material = str(normalize_bom(item).get("MATNR") or "").strip()
            description = descriptions.get(material, "")
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
        normalize_production_order(value) for value in _split_values(production_order)
    }
    sales_values = {normalize_sales_order(value) for value in _split_values(sales_order)}
    for row in rows:
        production = normalize_production_order(row.get("AUFNR_1"))
        sales = str(row.get("VBELN_EX") or "").strip()
        row["AUFNR_1"] = production
        if production_values and production not in production_values:
            row["_skip"] = True
        if sales_values and normalize_sales_order(sales) not in sales_values:
            row["_skip"] = True
        row_month = month_from_date(row.get("GSTRS"))
        if requested_month and row_month != requested_month:
            row["_skip"] = True
        planned_date = compact_date(row.get("GSTRS"))
        if requested_date_from and (not planned_date or planned_date < requested_date_from):
            row["_skip"] = True
        if requested_date_to and (not planned_date or planned_date > requested_date_to):
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
    metadata: dict[str, tuple[str, str, str]] = {}
    for item in orders:
        key = normalize_production_order(item.get("aufnr"))
        if key:
            metadata[key] = (
                str(item.get("inventoryLocation", "")).strip(),
                str(item.get("customerId", "")).strip(),
                str(item.get("productionModel", "")).strip(),
            )
    result = []
    for row in rows:
        metadata_values = metadata.get(normalize_production_order(row.get("AUFNR_1")))
        if metadata_values is None:
            base_value, customer, model = "", "", ""
        else:
            base_value, customer, model = metadata_values
        if base and base.strip() not in {str(row.get("LGORT") or "").strip(), base_value}:
            continue
        if customer_ids and customer not in customer_ids:
            continue
        if product_model and product_model.strip() != model:
            continue
        row["_base"] = str(row.get("LGORT") or base_value).strip()
        row["_customer_id"] = customer
        row["_product_model"] = model
        result.append(row)
    log_info(
        "LRR gateway BOM timings "
        f"bom_stream_ms={bom_stream_ms:.1f} metadata_load_ms={metadata_load_ms:.1f} "
        f"bom_rows={len(result)}"
    )
    return result


def _chunked(values: list[str], size: int) -> list[list[str]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def _descriptions_from_rows(rows: list[dict[str, Any]]) -> dict[str, str]:
    found: dict[str, str] = {}
    for row in rows:
        normalized = normalize_bom(row)
        material = str(normalized.get("MATNR") or "").strip()
        description = str(normalized.get("MAKTX") or "").strip()
        if material and description and material not in found:
            found[material] = description
    return found


async def _descriptions_from_pages(materials: list[str]) -> dict[str, str]:
    """Read one described posting per PN from the full view.

    Used only when a gateway stream omits MAKTX. Stop as soon as the PN is
    described, and stop immediately if a page does not contain that PN. Older
    gateways can ignore a material filter; continuing would page the full
    posting history.
    """
    found: dict[str, str] = {}
    for material in materials:
        for page in range(1, 4):
            payload = await data_gateway.view(
                "ZSGV_ZSD124",
                page=page,
                page_size=100,
                materialCode=material,
            )
            items = payload.get("items") if isinstance(payload, dict) else None
            if not isinstance(items, list) or not items:
                break
            page_rows = [item for item in items if isinstance(item, dict)]
            descriptions = _descriptions_from_rows(page_rows)
            if material in descriptions:
                found[material] = descriptions[material]
                break
            page_materials = {
                str(normalize_bom(item).get("MATNR") or "").strip() for item in page_rows
            }
            if material not in page_materials:
                break
    return found


async def _descriptions_for_codes(materials: list[str]) -> tuple[dict[str, str], bool]:
    rows = await data_gateway.all_bom_rows(materialCode=",".join(materials))
    found = _descriptions_from_rows(rows)
    if rows and not found:
        return await _descriptions_from_pages(materials), True
    return found, False


async def material_descriptions(material_numbers: list[str]) -> dict[str, str]:
    """Load one description per PN without paging every historical posting."""
    materials = list(
        dict.fromkeys(
            str(value or "").strip() for value in material_numbers if str(value or "").strip()
        )
    )
    if not materials:
        return {}
    result: dict[str, str] = {}
    try:
        for chunk in _chunked(materials, 20):
            found, used_pages = await _descriptions_for_codes(chunk)
            for material in chunk:
                if description := found.get(material):
                    result[material] = description
            omitted = [material for material in chunk if material not in result]
            # A chunk can hit the gateway row cap before every PN appears.
            # Retry those PN values alone instead of reading the whole chunk again.
            # Paging already visits each requested PN, so it must not be repeated.
            if omitted and found and not used_pages and len(chunk) > 1:
                for material in omitted:
                    single, _used_pages = await _descriptions_for_codes([material])
                    if description := single.get(material):
                        result[material] = description
    except DataGatewayError:
        return result
    return result


async def load_faults(
    *,
    production_orders: set[str],
    sales_orders: set[str] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    month: str | None = None,
    include_details: bool = True,
) -> list[dict[str, Any]]:
    sales_orders = sales_orders or set()
    if not production_orders and not sales_orders:
        return []
    if month and not date_from and not date_to:
        date_from, date_to = month_bounds(month)
    date_start, date_end = date_from or "", date_to or ""
    # A broad GET would page through the complete repair collection. Indexed
    # POST lookups keep the query selective even when thousands of BOM orders
    # are involved.
    semaphore = asyncio.Semaphore(12)

    async def fetch_by_production_order(chunk: list[str]) -> list[dict[str, Any]]:
        async with semaphore:
            return await data_gateway.fault_lookup(
                production_orders=chunk,
                date_from=date_start,
                date_to=date_end,
                time_field="planned",
            )

    async def fetch_by_sales_order(chunk: list[str]) -> list[dict[str, Any]]:
        async with semaphore:
            return await data_gateway.fault_lookup(
                sales_orders=chunk,
                date_from=date_start,
                date_to=date_end,
                time_field="planned",
            )

    lookup_requests = []
    variants = order_variants(sorted(production_orders))
    lookup_requests.extend(
        fetch_by_production_order(variants[index : index + MAX_BATCH_ORDER_FILTERS])
        for index in range(0, len(variants), MAX_BATCH_ORDER_FILTERS)
    )
    sales = sorted(filter(None, {normalize_sales_order(value) for value in sales_orders}))
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
    links = [normalize_fault_lookup(item) for batch in batches for item in batch]
    sns = sorted({str(row.get("PCODE") or "").strip() for row in links if row.get("PCODE")})
    if not sns:
        return links

    async def fetch_details(chunk: list[str]) -> list[dict[str, Any]]:
        async with semaphore:
            return await data_gateway.fault_rows_by_sns(
                chunk,
                date_from=date_start,
                date_to=date_end,
                time_field="planned",
            )

    detail_batches = await asyncio.gather(
        *(
            fetch_details(sns[index : index + MAX_BATCH_SN_FILTERS])
            for index in range(0, len(sns), MAX_BATCH_SN_FILTERS)
        )
    )
    details = [normalize_fault(item) for batch in detail_batches for item in batch]
    missing_full_rows = (
        sorted(
            {
                str(row.get("PCODE") or "").strip()
                for row in details
                if _fault_source_key(row) and (not row.get("ZNGWD") or not row.get("ZWXWD"))
            }
        )
        if include_details
        else []
    )
    if missing_full_rows:
        full_detail_batches = await asyncio.gather(
            *(
                data_gateway.fault_rows_by_host_barcodes(
                    missing_full_rows[index : index + MAX_BATCH_FULL_FAULT_FILTERS],
                    date_from=date_start,
                    date_to=date_end,
                    time_field="planned",
                )
                for index in range(0, len(missing_full_rows), MAX_BATCH_FULL_FAULT_FILTERS)
            )
        )
        full_details = [normalize_fault(item) for batch in full_detail_batches for item in batch]
        details = _merge_full_fault_rows(details, full_details)
    resolved_sns = {str(row.get("PCODE") or "").strip() for row in details}
    # Keep lookup-only rows when the detailed source has no matching SN,
    # so a transiently incomplete detail index does not undercount LRR.
    return details + [
        row for row in links if str(row.get("PCODE") or "").strip() not in resolved_sns
    ]


async def options() -> dict[str, list[str]]:
    orders = await data_gateway.all_orders()
    production = {normalize_production_order(item.get("aufnr")) for item in orders}
    sales = {normalize_sales_order(item.get("salesOrder")) for item in orders}
    bases = set()
    customers = set()
    materials = set()
    models = set()
    for item in orders:
        data = source_data(item)
        materials.add(str(data.get("MATNR", "")).strip())
        models.add(str(item.get("productionModel", "")).strip())
        bases.add(str(item.get("inventoryLocation", "")).strip())
        customers.add(str(item.get("customerId", "")).strip())
    return {
        "productionOrders": sorted(value for value in production if value),
        "salesOrders": sorted(value for value in sales if value),
        "materialNumbers": sorted(value for value in materials if value),
        "productModels": sorted(value for value in models if value),
        "bases": sorted(value for value in bases if value),
        "customerIds": sorted(value for value in customers if value),
    }
