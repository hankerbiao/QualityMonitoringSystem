"""
告警报表数据构建服务

报表与 RTY 看板使用同一套 Data Gateway 数据源和统计口径。
MongoDB 仅用于读取本地配置（例如机型目标直通率）。
"""

import asyncio
from typing import Any

from app.core.timezone import beijing_now
from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.alert_report import AlertContext, AlertReportData, AlertReportSummary
from app.services import rty_export
from app.services.rty_gateway import (
    _fault_sns_by_orders,
    _num,
    _orders,
    details_by_orders,
)
from app.services.rty_shared import normalize_order

# 故障明细展示上限（避免超大上下文返回过多数据）
DEFECT_LIMIT = 1000


def _build_gateway_filters(ctx: AlertContext) -> dict[str, Any]:
    """构建与 RTY API 相同的订单筛选条件。"""
    filters: dict[str, Any] = {
        "salesOrder": ctx.salesOrder or "",
        "productionOrder": ctx.productionOrder or "",
        "serialNumber": ctx.serialNumber or "",
        "base": ctx.base or "",
        "productModel": ctx.productModel or "",
        "customer": ctx.customer or "",
        "dateFrom": ctx.dateFrom[:10] if ctx.dateFrom else "",
        "dateTo": ctx.dateTo[:10] if ctx.dateTo else "",
        "orderScope": "normal",
    }
    return {key: value for key, value in filters.items() if value}


async def build_alert_fault_export(context: AlertContext) -> list[dict[str, Any]]:
    """Read the same complete source columns as RTY, without the report display limit."""
    filters = _build_gateway_filters(context)
    # A signed report can omit either date boundary; preserve its open interval.
    filters.setdefault("dateFrom", "1900-01-01")
    filters.setdefault("dateTo", "9999-12-31")
    _, faults = await rty_export._load_sources(filters)
    return [row for row, _ in faults]


async def _faults_by_model(orders: list[dict[str, Any]]) -> dict[str, set[str]]:
    """按机型复用 RTY 的故障 SN 计算，支持复合机型规则。"""
    groups: dict[str, set[str]] = {}
    for order in orders:
        model = str((order.get("data") or {}).get("MAKTX_TH") or "").strip()
        groups.setdefault(model, set()).add(order["aufnr"])

    maps = await asyncio.gather(
        *(
            _fault_sns_by_orders(order_numbers, model=model or None)
            for model, order_numbers in groups.items()
        )
    )
    result: dict[str, set[str]] = {}
    for fault_map in maps:
        for order, sns in fault_map.items():
            result.setdefault(normalize_order(order), set()).update(sns)
    return result


async def build_alert_report(
    context: AlertContext,
    *,
    targets_override: dict[str, float] | None = None,
) -> AlertReportData:
    """根据告警上下文实时聚合生成报表数据。"""
    db = get_database()

    if targets_override is None:
        # 机型指标仍属于本系统配置，不属于生产业务数据源。
        targets_doc = await db[Collections.CONFIGS].find_one({"key": "model_targets"})
        targets_map: dict[str, float] = (targets_doc or {}).get("targets", {}) or {}
    else:
        targets_map = targets_override

    orders = await _orders(_build_gateway_filters(context))
    order_numbers = {order["aufnr"] for order in orders if order.get("aufnr")}

    input_count = round(sum(_num((order.get("data") or {}).get("WMENG")) for order in orders))
    fault_map = await _faults_by_model(orders)
    defect_sns = set().union(
        *(fault_map.get(normalize_order(order), set()) for order in order_numbers)
    )
    defect_count = len(defect_sns)

    rty_rate = round((input_count - defect_count) / input_count * 100, 2) if input_count else 100.0
    product_model = context.productModel or ""
    target_rate = float(targets_map.get(product_model, 100))
    reached = rty_rate >= target_rate

    defects = []
    if order_numbers:
        defects = (await details_by_orders(order_numbers, product_model or None))[:DEFECT_LIMIT]

    now = beijing_now()
    summary = AlertReportSummary(
        rtyRate=rty_rate,
        targetRate=target_rate,
        defectCount=defect_count,
        inputCount=input_count,
        productModel=product_model,
        base=context.base or "",
        customer=context.customer or "",
        periodFrom=context.dateFrom,
        periodTo=context.dateTo,
        reached=reached,
    )

    return AlertReportData(
        context=context,
        summary=summary,
        defects=defects,
        generatedAt=now.strftime("%Y-%m-%d %H:%M"),
        expiresAt="",  # 由 API 层根据 token 的 exp 填充
    )
