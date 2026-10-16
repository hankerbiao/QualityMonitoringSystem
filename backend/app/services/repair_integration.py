"""Repair export aggregation and shared per-order material usage."""

from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from math import isfinite
from time import perf_counter
from typing import Any
from zlib import error as ZlibError

from pydantic import BaseModel, Field
from pymongo.errors import PyMongoError

from app.core.logger import log_info
from app.db.mongodb import get_database
from app.schemas.rty import RepairModelSheet
from app.services.async_ttl_cache import AsyncTTLCache
from app.services.data_gateway_client import DataGatewayError, data_gateway

MATERIAL_CONCURRENCY = 16
MAX_ORDER_POSTINGS = 250_000
MAX_EXPORT_POSTINGS = 1_000_000
MATERIAL_CACHE_SECONDS = 24 * 60 * 60
_ORDER_CACHE = AsyncTTLCache(max_entries=8)
MATERIAL_CACHE_COLLECTION = "repair_material_usage_cache"
MatchedFault = tuple[dict[str, Any], set[tuple[str, str]]]


def text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        if not isfinite(value):
            return ""
        if value.is_integer():
            return str(int(value))
    return str(value).strip()


def identifier(value: Any) -> str:
    value = text(value)
    if value.upper() in {"-", "--", "NULL", "NONE", "NAN", "N/A"}:
        return ""
    return (value.lstrip("0") or "0") if value.isdigit() else value


def quantity(value: Any, *, signed: bool = False) -> Decimal | None:
    if isinstance(value, bool) or not text(value):
        return None
    try:
        result = Decimal(text(value).replace(",", ""))
    except InvalidOperation:
        return None
    return result if result.is_finite() and (signed or result >= 0) else None


def excel_number(value: Decimal) -> int | float:
    return int(value) if value == value.to_integral_value() else float(value)


def rate(count: int | str, denominator: int | float | str) -> float | None:
    if type(count) is int and type(denominator) in {int, float} and denominator > 0:
        return count / denominator
    return None


@dataclass
class OrderUsage:
    quantities: dict[str, Decimal] = field(default_factory=dict)
    descriptions: dict[str, dict[str, None]] = field(default_factory=dict)
    sales: set[str] = field(default_factory=set)
    row_count: int = 0


class _CachedUsage(BaseModel):
    quantities: dict[str, Decimal]
    descriptions: dict[str, dict[str, None]]
    sales: set[str]
    row_count: int = Field(ge=0, le=MAX_ORDER_POSTINGS)


def _cache_id(order: str) -> str:
    return hashlib.sha256(json.dumps(["v2", data_gateway.base_url, order]).encode()).hexdigest()


async def _persistent_usage(order: str) -> OrderUsage | None:
    try:
        doc = await get_database()[MATERIAL_CACHE_COLLECTION].find_one({"_id": _cache_id(order)})
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if not doc or not isinstance(doc.get("expiresAt"), datetime) or doc["expiresAt"] <= now:
            return None
        payload = _CachedUsage.model_validate_json(gzip.decompress(doc["payload"]))
        if any(not value.is_finite() for value in payload.quantities.values()):
            return None
        return OrderUsage(
            quantities=payload.quantities,
            descriptions=payload.descriptions,
            sales=payload.sales,
            row_count=payload.row_count,
        )
    except (
        RuntimeError,
        PyMongoError,
        KeyError,
        TypeError,
        ValueError,
        OSError,
        EOFError,
        InvalidOperation,
        ZlibError,
    ):
        # This is a derived cache. A cache miss or cache outage still reads the gateway.
        return None


async def _store_usage(order: str, usage: OrderUsage) -> None:
    payload = {
        "quantities": {key: str(value) for key, value in usage.quantities.items()},
        "descriptions": usage.descriptions,
        "sales": sorted(usage.sales),
        "row_count": usage.row_count,
    }
    try:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        await get_database()[MATERIAL_CACHE_COLLECTION].update_one(
            {"_id": _cache_id(order)},
            {
                "$set": {
                    "payload": gzip.compress(json.dumps(payload, ensure_ascii=False).encode()),
                    "expiresAt": now + timedelta(seconds=MATERIAL_CACHE_SECONDS),
                }
            },
            upsert=True,
        )
    except (RuntimeError, PyMongoError):
        log_info("Repair export material cache unavailable; gateway result retained")


def _posting_source(item: dict[str, Any]) -> dict[str, Any]:
    raw = item.get("raw")
    raw = raw if isinstance(raw, dict) else item
    return raw["data"] if isinstance(raw.get("data"), dict) else raw


def aggregate_postings(order: str, items: list[dict[str, Any]]) -> OrderUsage:
    result = OrderUsage()
    seen: dict[str, tuple[Any, ...]] = {}
    for item in items:
        raw = _posting_source(item)
        if identifier(raw.get("AUFNR_1")) != order:
            continue
        material = identifier(raw.get("MATNR"))
        amount = quantity(raw.get("MENGE_A"), signed=True)
        identity = text(item.get("id") or raw.get("_source_key") or raw.get("_id"))
        if not identity or not material or amount is None:
            raise DataGatewayError(f"生产订单 {order} 的发料记录缺少ID、料号或有效数量")
        sales = identifier(raw.get("VBELN_EX"))
        description = text(raw.get("MAKTX"))
        signature = (material, amount, sales, description)
        if identity in seen:
            if seen[identity] != signature:
                raise DataGatewayError(f"生产订单 {order} 的发料记录 {identity} 内容冲突")
            continue
        seen[identity] = signature
        result.quantities[material] = result.quantities.get(material, Decimal(0)) + amount
        if description:
            result.descriptions.setdefault(material, {})[description] = None
        if sales:
            result.sales.add(sales)
        result.row_count += 1
    return result


async def load_order_usage(orders: list[str]) -> dict[str, OrderUsage]:
    """Load cached aggregates and fetch missing orders with one indexed BOM query."""
    if not orders:
        return {}
    values = sorted(set(orders))

    async def load() -> dict[str, OrderUsage]:
        started = perf_counter()
        results: dict[str, OrderUsage] = {}
        missing = []
        for index in range(0, len(values), MATERIAL_CONCURRENCY):
            window = values[index : index + MATERIAL_CONCURRENCY]
            cached = await asyncio.gather(*(_persistent_usage(order) for order in window))
            for order, usage in zip(window, cached, strict=True):
                if usage is None:
                    missing.append(order)
                else:
                    results[order] = usage

        if missing:
            items = await data_gateway.export_rows("bom", missing, max_rows=MAX_EXPORT_POSTINGS)
            if items is None:
                raise DataGatewayError("生产数据源不支持 BOM 批量导出")

            missing_set = set(missing)
            postings: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for item in items:
                order = identifier(_posting_source(item).get("AUFNR_1"))
                if order not in missing_set:
                    raise DataGatewayError(f"BOM 批量查询返回未请求的生产订单 {order}")
                postings[order].append(item)

            for order in missing:
                results[order] = aggregate_postings(order, postings.get(order, []))

        total = sum(usage.row_count for usage in results.values())
        if total > MAX_EXPORT_POSTINGS:
            raise DataGatewayError("发料记录超过导出上限，请缩小筛选范围")

        for index in range(0, len(missing), MATERIAL_CONCURRENCY):
            window = missing[index : index + MATERIAL_CONCURRENCY]
            await asyncio.gather(*(_store_usage(order, results[order]) for order in window))

        log_info(
            f"Repair export materials orders={len(values)} fetched={len(missing)} "
            f"cached={len(values) - len(missing)} postings={total} "
            f"elapsed_ms={(perf_counter() - started) * 1000:.1f}"
        )
        return results

    return await _ORDER_CACHE.get_or_set(
        (data_gateway.base_url, tuple(values)), load, ttl_seconds=MATERIAL_CACHE_SECONDS
    )


@dataclass
class RepairGroup:
    count: int = 0
    symptoms: dict[str, None] = field(default_factory=dict)
    descriptions: dict[str, None] = field(default_factory=dict)
    sns: set[str] = field(default_factory=set)
    missing_sn: int = 0


async def build_model_sheets(
    orders: list[dict[str, Any]], faults: list[MatchedFault]
) -> list[RepairModelSheet]:
    by_model: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    order_rows: dict[str, dict[str, Any]] = {}
    for row in orders:
        order, model = identifier(row.get("AUFNR")), text(row.get("MAKTX_TH"))
        if not order or not model:
            raise DataGatewayError("销售订单缺少生产订单或机型，无法整合")
        previous = order_rows.get(order)
        if previous is not None and any(
            identifier(previous.get(key)) != identifier(row.get(key))
            for key in ("MAKTX_TH", "VBELN", "WERKS", "GAMNG")
        ):
            raise DataGatewayError(f"生产订单 {order} 的机型、销售订单、工厂或数量冲突")
        order_rows[order] = row
        by_model[model][order] = row

    groups: dict[str, dict[tuple[str, str], RepairGroup]] = defaultdict(dict)
    for raw, matches in faults:
        material = next(
            (
                value
                for key in ("ZCCLH", "MATNR", "RECORD01REPAIRM")
                if (value := identifier(raw.get(key)))
            ),
            "",
        )
        model_sns: dict[str, set[str]] = defaultdict(set)
        for model, sn in matches:
            model_sns[model].add(text(sn))
        for model, sns in model_sns.items():
            if model not in by_model:
                raise DataGatewayError(f"维修记录的机型 {model} 未关联到选定订单")
            group = groups[model].setdefault((text(raw.get("ZWXWD3")), material), RepairGroup())
            # One repair is one occurrence, even when it maps to multiple head SNs.
            group.count += 1
            if symptom := text(raw.get("ZNGWD3")):
                group.symptoms[symptom] = None
            if (
                (description := text(raw.get("MAKTX")))
                and material
                and (not identifier(raw.get("MATNR")) or identifier(raw.get("MATNR")) == material)
            ):
                group.descriptions[description] = None
            group.sns.update(sn for sn in sns if sn)
            group.missing_sn += int("" in sns)

    # Material denominators include every selected order for the model, not only
    # orders with a repair. Models without a material repair need no BOM reads.
    needed_models = {
        model
        for model, model_groups in groups.items()
        if any(material for _, material in model_groups)
    }
    usage = await load_order_usage([order for model in needed_models for order in by_model[model]])
    sheets = []
    for model, model_orders in sorted(by_model.items()):
        amounts: dict[str, Decimal] = {}
        descriptions: dict[str, dict[str, None]] = {}
        incomplete = False
        production = Decimal(0)
        production_missing = False
        for order, row in model_orders.items():
            amount = quantity(row.get("GAMNG"))
            production_missing |= amount is None
            production += amount or Decimal(0)
            postings = usage.get(order)
            if postings is None:
                continue
            sales = identifier(row.get("VBELN"))
            if sales and postings.sales - {sales}:
                raise DataGatewayError(f"生产订单 {order} 的发料销售订单与选定订单不一致")
            incomplete |= postings.row_count == 0
            for material, amount in postings.quantities.items():
                amounts[material] = amounts.get(material, Decimal(0)) + amount
            for material, labels in postings.descriptions.items():
                descriptions.setdefault(material, {}).update(labels)
        production_value = "缺少整机数量" if production_missing else excel_number(production)
        rows = []
        for (repair, material), group in sorted(groups.get(model, {}).items()):
            labels = {**group.descriptions, **descriptions.get(material, {})}
            material_usage: int | float | str
            if not material:
                material_usage = "未填写物料号"
            elif incomplete:
                material_usage = "发料记录不完整"
            elif material not in amounts:
                material_usage = "未匹配发料记录"
            else:
                material_usage = excel_number(amounts[material])
            sn_count = f"缺少SN（{group.missing_sn}条）" if group.missing_sn else len(group.sns)
            rows.append(
                {
                    "sequence": len(rows) + 1,
                    "model": model,
                    "problem": "\n".join(group.symptoms),
                    "repairAction": repair or "未填写维修维度3",
                    "material": f"{material or '未填写物料号'}*{group.count}",
                    "materialDescription": "\n".join(labels),
                    "materialCount": group.count,
                    "materialUsage": material_usage,
                    "componentFaultRate": rate(group.count, material_usage),
                    "serialCount": sn_count,
                    "productionQuantity": production_value,
                    "machineFaultRate": rate(sn_count, production_value),
                }
            )
        if not rows:
            rows.append(
                {
                    "model": model,
                    "repairAction": "无维修故障记录",
                    "materialCount": 0,
                    "serialCount": 0,
                    "productionQuantity": production_value,
                    "machineFaultRate": rate(0, production_value),
                }
            )
        sheets.append(RepairModelSheet(model=model, rows=rows))
    return sheets
