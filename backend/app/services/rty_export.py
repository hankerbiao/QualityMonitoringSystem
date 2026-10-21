"""Source-backed RTY template export; unconfirmed metrics remain unavailable."""

from __future__ import annotations

import asyncio
import gzip
import json
from collections import defaultdict
from collections.abc import AsyncIterator
from decimal import Decimal, InvalidOperation
from math import isfinite
from typing import Any, Literal

from fastapi import HTTPException

from app.base_access import base_allowed, current_base_permissions
from app.schemas.common import Response
from app.schemas.rty import RTYTemplateExport, StationPassExport
from app.services import repair_integration, rty_gateway
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.data_gateway_client import DataGatewayError, data_gateway
from app.services.lrr_normalization import compact_date
from app.services.rty_shared import (
    COMPOSITE_MODEL_ITEMS,
    normalize_order,
    order_variants,
    validate_date,
)

MAX_EXPORT_ORDERS = 100_000
MAX_EXPORT_FAULTS = 250_000
ORDER_DETAIL_CONCURRENCY = 8
# Each paginated query can issue eight requests; four batches fit the
# gateway client's 32-connection pool without unbounded source fan-out.
SOURCE_BATCH_CONCURRENCY = 4
EXPORT_SOURCE_CACHE_TTL_SECONDS = 60 * 60
_SOURCE_CACHE = AsyncTTLCache(max_entries=8)
_RESPONSE_CACHE = AsyncTTLCache(max_entries=8, copy_values=False)
MatchedFault = tuple[dict[str, Any], set[tuple[str, str]]]
ORDER_FIELDS = (
    "VBELN",
    "POSNR",
    "AUFNR",
    "MAKTX_TH",
    "CPXH",
    "IF_L6",
    "ZSTAT",
    "KID",
    "GAMNG",
    "WMENG",
    "GSTRS",
    "ZDATE_STARTED",
    "AUART",
    "WERKS",
    "LGORT",
    "MATNR",
    "MAKTX",
    "NAME1_ZU",
)
FAULT_FIELDS = (
    "FACTORY",
    "VBELN",
    "AUFNR",
    "ZJXMC",
    "PCODE",
    "ZNGGZ",
    "U_FIND",
    "T_FIND",
    "ZNGWD3",
    "ZNGWD",
    "U_FIX",
    "ZWXDT",
    "ZWXWD3",
    "SECFLG",
    "ZBJ",
    "ZZRFL",
    "ZCCLH",
    "SECOND_PART_NO",
    "FIX_REMARKS",
    "MATNR",
    "MAKTX",
    "ZMCOD1",
    "ZRCOD1",
    "ZMCOD2",
    "ZRCOD2",
    "RECORD01REPAIRM",
    "ERROR_CODE",
    "ERROR_MSG",
    "REJUDGE",
    "RET",
    "RPDESC",
    "RNOTE",
    "U_RMA_NAM",
    "RMA_RESULT",
    "AUART",
)


def _source(item: dict[str, Any]) -> dict[str, Any]:
    raw = item.get("raw")
    raw = raw if isinstance(raw, dict) else item
    return raw["data"] if isinstance(raw.get("data"), dict) else raw


def _columns(row: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {
        key: value
        if isinstance(value, (str, int, float, bool))
        and (not isinstance(value, float) or isfinite(value))
        else None
        for key in fields
        for value in [row.get(key)]
    }


def _sum_quantity(rows: list[dict[str, Any]], key: str) -> int | float | None:
    total = Decimal(0)
    for row in rows:
        value = row.get(key)
        if value is None or isinstance(value, bool) or str(value).strip() == "":
            return None
        try:
            number = Decimal(str(value).strip())
        except InvalidOperation:
            return None
        if not number.is_finite() or number < 0:
            return None
        total += number
    return int(total) if total == total.to_integral_value() else float(total)


def _fault_rate(count: int | None, quantity: int | float | None) -> float | None:
    if count is None or quantity is None or quantity <= 0 or count > quantity:
        return None
    return count / quantity


async def _load_orders(
    filters: dict[str, str],
    *,
    product_models: list[str] | None = None,
    bases: list[str] | None = None,
    customers: list[str] | None = None,
) -> list[dict[str, Any]]:
    if current_base_permissions() == ():
        return []
    gateway_filters = {
        key: value
        for key, value in filters.items()
        if value and key not in {"orderScope", "calculationMethod"}
    }
    items = await data_gateway.all_orders(max_rows=MAX_EXPORT_ORDERS, **gateway_filters)
    start = compact_date(validate_date(filters["dateFrom"]))
    end = compact_date(validate_date(filters["dateTo"]))
    selected_models = set(product_models) if product_models else None
    selected_bases = set(bases) if bases else None
    selected_customers = set(customers) if customers else None
    include_empty_customer = bool(selected_customers and "__NO_CUSTOMER_ID__" in selected_customers)
    if selected_customers:
        selected_customers.discard("__NO_CUSTOMER_ID__")

    def customer_matches(value: Any) -> bool:
        normalized = str(value or "").strip()
        return normalized in (selected_customers or set()) or (include_empty_customer and not normalized)

    candidates = []
    for item in items:
        normalized = rty_gateway.normalize_order_row(item)
        planned_date = compact_date(normalized["gstrs_date"])
        if (
            normalized["aufnr"]
            and base_allowed(normalized["data"].get("LGORT"))
            and start <= planned_date <= end
            and (selected_models is None or normalized["data"].get("MAKTX_TH") in selected_models)
            and (selected_bases is None or normalized["data"].get("LGORT") in selected_bases)
            and (selected_customers is None or customer_matches(normalized["data"].get("KID")))
        ):
            candidates.append(item)

    rows = []
    # List raw.data is projected: read full documents by source ID before
    # exporting fields or applying rules that depend on source fields.
    for index in range(0, len(candidates), 1000):
        details = await _full_orders(candidates[index : index + 1000])
        for detail in details:
            if isinstance(detail, BaseException):
                raise detail
            normalized = rty_gateway.normalize_order_row(detail)
            data = dict(_source(detail))
            planned_date = compact_date(data.get("GSTRS") or normalized["gstrs_date"])
            if (
                normalized["aufnr"]
                and base_allowed(data.get("LGORT") or normalized["data"].get("LGORT"))
                and start <= planned_date <= end
                and rty_gateway._eligible(normalized, filters.get("orderScope", "normal"))
                and (selected_models is None or data.get("MAKTX_TH") in selected_models)
                and (selected_bases is None or data.get("LGORT") in selected_bases)
                and (selected_customers is None or customer_matches(data.get("KID")))
            ):
                if not str(data.get("AUFNR") or "").strip():
                    data["AUFNR"] = normalized["aufnr"]
                rows.append(data)
    return rows


async def _full_order(item: dict[str, Any]) -> dict[str, Any]:
    raw = item.get("raw")
    identity = item.get("id") or (raw.get("_id") if isinstance(raw, dict) else None)
    if not identity:
        raise DataGatewayError("订单缺少数据源 ID，无法读取完整导出字段")
    detail = await data_gateway.order_detail(str(identity))
    full_raw = detail.get("raw") if isinstance(detail, dict) else None
    if not isinstance(full_raw, dict) or not isinstance(full_raw.get("data"), dict):
        raise DataGatewayError("订单详情缺少原始数据，无法完整导出")
    order = detail.get("order")
    return {**item, **(order if isinstance(order, dict) else {}), "raw": full_raw}


async def _full_orders(items: list[dict[str, Any]]) -> list[dict[str, Any] | BaseException]:
    identities = []
    for item in items:
        raw = item.get("raw")
        identity = item.get("id") or (raw.get("_id") if isinstance(raw, dict) else None)
        if not identity:
            raise DataGatewayError("订单缺少数据源 ID，无法读取完整导出字段")
        identities.append(str(identity))
    sources = await data_gateway.export_rows("orders", identities, max_rows=1000)
    if sources is None:
        details = []
        for index in range(0, len(items), ORDER_DETAIL_CONCURRENCY):
            details.extend(
                await asyncio.gather(
                    *(
                        _full_order(item)
                        for item in items[index : index + ORDER_DETAIL_CONCURRENCY]
                    ),
                    return_exceptions=True,
                )
            )
        return details
    by_id = {str(raw.get("_id")): raw for raw in sources}
    if len(by_id) != len(sources) or set(by_id) != set(identities):
        raise DataGatewayError("订单原始数据缺失或重复，无法完整导出")
    result = []
    for item, identity in zip(items, identities, strict=True):
        raw = by_id[identity]
        if not isinstance(raw.get("data"), dict):
            raise DataGatewayError("订单详情缺少原始数据，无法完整导出")
        result.append(
            {
                **item,
                "aufnr": raw.get("aufnr") or item.get("aufnr"),
                "plannedStartDate": raw["data"].get("GSTRS") or "",
                "raw": raw,
            }
        )
    return result


async def _read_source_batch(
    path: str, filters: dict[str, str], *, max_rows: int
) -> list[dict[str, Any]]:
    resource, key = (
        ("faults", "productionOrders") if path == "/api/faults" else ("bindings", "headOrder")
    )
    items = await data_gateway.export_rows(resource, filters[key].split(","), max_rows=max_rows)
    if items is not None:
        return items
    return await data_gateway.all_pages("GET", path, filters=filters, max_rows=max_rows)


async def _source_batches(
    path: str, filters: list[dict[str, str]], *, max_rows: int
) -> AsyncIterator[list[dict[str, Any]]]:
    for index in range(0, len(filters), SOURCE_BATCH_CONCURRENCY):
        batches = await asyncio.gather(
            *(
                _read_source_batch(path, batch, max_rows=max_rows)
                for batch in filters[index : index + SOURCE_BATCH_CONCURRENCY]
            ),
            return_exceptions=True,
        )
        # Await the whole window before propagating an error, so no batch
        # keeps reading the source after an export has failed.
        for items in batches:
            if isinstance(items, BaseException):
                raise items
            yield items


async def _child_bindings(
    orders: list[dict[str, Any]],
) -> dict[tuple[str, str], set[tuple[str, str]]]:
    heads: dict[str, set[str]] = defaultdict(set)
    for row in orders:
        model = str(row.get("MAKTX_TH") or "")
        if model in COMPOSITE_MODEL_ITEMS:
            heads[normalize_order(row["AUFNR"])].add(model)
    result: dict[tuple[str, str], set[tuple[str, str]]] = defaultdict(set)
    values = sorted(heads)
    batches = [
        {"headOrder": ",".join(order_variants(values[index : index + 32]))}
        for index in range(0, len(values), 32)
    ]
    async for items in _source_batches("/api/views/ZSGV_ZPP_SERNOLIST", batches, max_rows=100_000):
        for item in items:
            raw = _source(item)
            head_order = normalize_order(raw.get("AUFNR_HEAD"))
            child_order = normalize_order(raw.get("AUFNR_ITEM"))
            child_sn = str(raw.get("ZCODE_ITEM") or "").strip()
            head_sn = str(raw.get("ZCODE_HEAD") or "").strip()
            if child_order and child_sn and head_sn:
                for model in heads.get(head_order, set()):
                    result[(child_order, child_sn)].add((model, head_sn))
    return result


async def _load_sources(
    filters: dict[str, str],
    *,
    product_models: list[str] | None = None,
    bases: list[str] | None = None,
    customers: list[str] | None = None,
) -> tuple[list[dict[str, Any]], list[MatchedFault]]:
    start = validate_date(filters["dateFrom"])
    end = validate_date(filters["dateTo"])
    if start > end:
        raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期")
    key = (
        current_base_permissions(),
        data_gateway.base_url,
        tuple(sorted(filters.items())),
        tuple(sorted(set(product_models or []))),
        tuple(sorted(set(bases or []))),
        tuple(sorted(set(customers or []))),
    )

    async def load() -> bytes:
        orders, faults = await _load_sources_uncached(
            filters, product_models=product_models, bases=bases, customers=customers
        )
        payload = [orders, [[row, sorted(matches)] for row, matches in faults]]
        return gzip.compress(json.dumps(payload, ensure_ascii=False).encode(), compresslevel=1)

    payload = await _SOURCE_CACHE.get_or_set(key, load, ttl_seconds=EXPORT_SOURCE_CACHE_TTL_SECONDS)
    orders, faults = json.loads(gzip.decompress(payload))
    return orders, [(row, {tuple(match) for match in matches}) for row, matches in faults]


async def _load_sources_uncached(
    filters: dict[str, str],
    *,
    product_models: list[str] | None = None,
    bases: list[str] | None = None,
    customers: list[str] | None = None,
) -> tuple[list[dict[str, Any]], list[MatchedFault]]:
    start = validate_date(filters["dateFrom"])
    end = validate_date(filters["dateTo"])
    if start > end:
        raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期")
    orders = await _load_orders(filters, product_models=product_models, bases=bases, customers=customers)
    if not orders:
        return [], []

    order_models: dict[str, set[str]] = defaultdict(set)
    order_types: dict[str, str] = {}
    for row in orders:
        model = str(row.get("MAKTX_TH") or "")
        order = normalize_order(row["AUFNR"])
        order_models[order].add(model)
        order_types.setdefault(order, str(row.get("AUART") or ""))
    children = await _child_bindings(orders)
    lookup_orders = sorted(set(order_models) | {order for order, _ in children})
    faults: list[MatchedFault] = []
    seen_ids: set[str] = set()
    batches = [
        {
            "productionOrders": ",".join(order_variants(lookup_orders[index : index + 50])),
            "timeField": "planned",
        }
        for index in range(0, len(lookup_orders), 50)
    ]
    async for items in _source_batches("/api/faults", batches, max_rows=MAX_EXPORT_FAULTS):
        for item in items:
            raw = _source(item)
            order = normalize_order(raw.get("AUFNR") or item.get("productionOrder"))
            sn = str(raw.get("PCODE") or item.get("hostBarcode") or "").strip()
            matches = {(model, sn) for model in order_models.get(order, set())}
            matches.update(children.get((order, sn), set()))
            # A bound child order can contain unrelated machines.
            if not matches:
                continue
            identity = str(item.get("id") or raw.get("_source_key") or raw.get("_id") or "")
            if identity and identity in seen_ids:
                continue
            if identity:
                seen_ids.add(identity)
            raw = {**raw, "AUART": raw.get("AUART") or order_types.get(order, "")}
            faults.append((_columns(raw, FAULT_FIELDS), matches))
            if len(faults) > MAX_EXPORT_FAULTS:
                raise HTTPException(status_code=413, detail="维修明细超过导出上限，请缩小筛选范围")
    return orders, faults


async def build_template_export(
    filters: dict[str, str],
    *,
    product_models: list[str] | None = None,
    bases: list[str] | None = None,
    customers: list[str] | None = None,
    integrate: bool = False,
) -> RTYTemplateExport:
    orders, faults = await _load_sources(filters, product_models=product_models, bases=bases, customers=customers)
    by_model: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in orders:
        by_model[str(row.get("MAKTX_TH") or "")].append(row)

    defect_sns: dict[str, set[str]] = defaultdict(set)
    top_groups: dict[tuple[str, ...], set[str]] = defaultdict(set)
    for raw, matches in faults:
        for model, head_sn in matches:
            defect_sns[model].add(head_sn)
        if integrate:
            continue
        # Conflicting PNs and material serial numbers cannot identify one part.
        materials = {
            str(raw.get(key) or "").strip()
            for key in ("ZCCLH", "MATNR")
            if str(raw.get(key) or "").strip()
        }
        material = next(iter(materials)) if len(materials) == 1 else ""
        for model, head_sn in matches:
            group = (
                model,
                str(raw.get("ZNGWD3") or ""),
                str(raw.get("ZWXWD3") or ""),
                material,
                str(raw.get("MAKTX") or "")
                if material and material == str(raw.get("MATNR") or "").strip()
                else "",
            )
            top_groups[group].add(head_sn)

    quantities = {model: _sum_quantity(rows, "WMENG") for model, rows in by_model.items()}
    summary = []
    for model in sorted(by_model):
        count = None if "" in defect_sns[model] else len(defect_sns[model])
        rate = _fault_rate(count, quantities[model])
        summary.append(
            {
                "model": model,
                "plannedQuantity": _sum_quantity(by_model[model], "GAMNG"),
                "completedQuantity": quantities[model],
                "defectCount": count,
                "completionRate": 1 - rate if rate is not None else None,
            }
        )
    top_problems = []
    for sequence, (group, sns) in enumerate(
        sorted(top_groups.items(), key=lambda item: (-len(item[1]), item[0])), 1
    ):
        model, problem, action, material, description = group
        count = None if "" in sns else len(sns)
        top_problems.append(
            {
                "sequence": sequence,
                "model": model,
                "problem": problem,
                "repairAction": action,
                "material": material,
                "materialDescription": description,
                "serialCount": count,
                "productionQuantity": quantities[model],
                "machineFaultRate": _fault_rate(count, quantities[model]),
            }
        )
    return RTYTemplateExport(
        summary=summary,
        orders=[_columns(row, ORDER_FIELDS) for row in orders],
        faults=[raw for raw, _ in faults],
        topProblems=top_problems,
        modelSheets=await repair_integration.build_model_sheets(orders, faults)
        if integrate
        else [],
    )


async def build_export_response(
    kind: Literal["template", "source"],
    filters: dict[str, str],
    *,
    product_models: list[str] | None = None,
    bases: list[str] | None = None,
    customers: list[str] | None = None,
) -> bytes:
    """Reuse immutable export JSON briefly within the same filter and access scope."""

    async def load() -> bytes:
        builder = build_template_export if kind == "template" else build_source_export
        data = await builder(
            filters,
            product_models=product_models,
            bases=bases,
            customers=customers,
            integrate=True,
        )
        return Response(success=True, data=data).model_dump_json().encode()

    key = (
        "export-response-v2",
        kind,
        current_base_permissions(),
        data_gateway.base_url,
        tuple(sorted(filters.items())),
        tuple(sorted(set(product_models or []))),
        tuple(sorted(set(bases or []))),
        tuple(sorted(set(customers or []))),
    )
    return await _RESPONSE_CACHE.get_or_set(key, load, ttl_seconds=EXPORT_SOURCE_CACHE_TTL_SECONDS)


async def build_source_export(
    filters: dict[str, str],
    *,
    product_models: list[str] | None = None,
    bases: list[str] | None = None,
    customers: list[str] | None = None,
    integrate: bool = False,
) -> StationPassExport:
    """Load source sheets and optional model statistics without template summary."""
    orders, faults = await _load_sources(filters, product_models=product_models, bases=bases, customers=customers)
    return StationPassExport(
        orders=[_columns(row, ORDER_FIELDS) for row in orders],
        faults=[raw for raw, _ in faults],
        modelSheets=await repair_integration.build_model_sheets(orders, faults)
        if integrate
        else [],
    )
