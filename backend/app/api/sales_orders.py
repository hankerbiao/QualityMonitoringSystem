"""
销售订单双来源同步接口 + 统一查询接口
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth import get_current_user
from app.schemas.sales_order import (
    SalesOrderDocument,
    SalesOrderFilterOptions,
    SalesOrdersQueryResponse,
    SalesOrderStatsResponse,
    SalesOrderSyncRequest,
    SalesOrderSyncResponse,
)
from app.services.data_gateway_client import data_gateway

logger = logging.getLogger(__name__)

router = APIRouter()


def _serialize_order(doc: dict) -> SalesOrderDocument:
    return SalesOrderDocument(
        id=str(doc.get("_id")),
        aufnr=doc.get("aufnr", ""),
        data=doc.get("data") or {},
        source_records=doc.get("source_records") or {},
        sources=doc.get("sources") or [],
        quantity=float(doc.get("quantity") or 0),
        gstrs_date=doc.get("gstrs_date"),
        first_seen_at=doc.get("first_seen_at"),
        last_synced_at=doc.get("last_synced_at"),
        sync_count=doc.get("sync_count", 0),
    )


def _serialize_gateway_order(item: dict) -> SalesOrderDocument:
    """Adapt the gateway's compact order summary to the existing BFF schema."""
    source = str(item.get("source") or "")
    aufnr = str(item.get("aufnr") or "")
    data = {
        "VBELN": item.get("salesOrder") or "",
        "KID": item.get("customerId") or "",
        "NAME1_ZU": item.get("finalUser") or "",
        "MAKTX": item.get("materialDescription") or "",
        "MAKTX_TH": item.get("productionModel") or "",
        "LGORT": item.get("inventoryLocation") or "",
        "GSTRS": item.get("plannedStartDate") or "",
    }
    return SalesOrderDocument(
        id=str(item.get("id") or f"{source}:{aufnr}"),
        aufnr=aufnr,
        data=data,
        source_records={},
        sources=[source] if source else [],
        quantity=float(item.get("orderQuantity") or 0),
        gstrs_date=item.get("plannedStartDate") or None,
        first_seen_at=None,
        last_synced_at=None,
        sync_count=0,
    )


async def _query_gateway_orders(
    *,
    page: int,
    limit: int,
    date_from: str | None,
    date_to: str | None,
    keyword: str | None,
) -> SalesOrdersQueryResponse:
    payload = await data_gateway.orders(
        page=page,
        page_size=min(limit, 100),
        keyword=keyword or "",
        gstrsFrom=date_from or "",
        gstrsTo=date_to or "",
    )
    items = [_serialize_gateway_order(item) for item in payload.get("items", [])]
    stats_payload = await data_gateway.order_stats(
        keyword=keyword or "",
        gstrsFrom=date_from or "",
        gstrsTo=date_to or "",
    )
    total = int(payload.get("total") or 0)
    return SalesOrdersQueryResponse(
        items=items,
        total=total,
        page=int(payload.get("page") or page),
        limit=int(payload.get("pageSize") or limit),
        has_more=(int(payload.get("page") or page) * int(payload.get("pageSize") or limit)) < total,
        stats=SalesOrderStatsResponse(
            total=total,
            total_quantity=float(stats_payload.get("orderQuantity") or 0),
        ),
        filterOptions=SalesOrderFilterOptions(),
    )


@router.post("/sync", response_model=SalesOrderSyncResponse)
async def sync_sales_orders(
    payload: SalesOrderSyncRequest,
    _: Annotated[dict, Depends(get_current_user)],
):
    """
    按 SAP 变更日期范围从 SG、KK 两个来源同步销售订单。

    - 两来源都失败 → 502，不写库
    - 单来源失败 → 成功来源继续入库，partial_success=true
    - MongoDB 写入失败 → 500，不返回伪成功结果
    """
    del payload
    raise HTTPException(status_code=410, detail="销售订单同步已迁移至数据网关，请调用网关同步任务")


@router.get("/query", response_model=SalesOrdersQueryResponse)
async def query_sales_orders(
    _: Annotated[dict, Depends(get_current_user)],
    cp_xh: Annotated[list[str] | None, Query(description="机型 (data.MAKTX_TH)，可多选")] = None,
    lgort: Annotated[list[str] | None, Query(description="基地 (data.LGORT)，可多选")] = None,
    date_from: str | None = Query(None, description="开始日期 YYYY-MM-DD (data.GSTRS)"),
    date_to: str | None = Query(None, description="结束日期 YYYY-MM-DD (data.GSTRS)"),
    keyword: str | None = Query(None, description="订单号 (AUFNR) 模糊搜索"),
    page: int = Query(1, ge=1, description="页码，从 1 开始"),
    limit: int = Query(50, ge=1, le=500, description="每页数量"),
):
    """
    分页筛选所有销售订单。

    支持按机型 (MAKTX_TH)、基地 (LGORT) 精确 / 多选匹配，按 data.GSTRS
    归一化后的日期做时间范围筛选，按订单号 (AUFNR) 模糊搜索。
    结果按 aufnr 升序。
    """
    if not data_gateway.enabled:
        raise HTTPException(status_code=503, detail="DATA_GATEWAY_URL 未配置")
    if cp_xh or lgort:
        raise HTTPException(
            status_code=400, detail="销售订单查询请使用数据网关 productModel/base 参数"
        )
    return await _query_gateway_orders(
        page=page, limit=limit, date_from=date_from, date_to=date_to, keyword=keyword
    )
