"""
销售订单双来源同步接口 + 统一查询接口
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from app.api.auth import get_current_user
from app.repositories import sales_order_repository as repo
from app.schemas.sales_order import (
    SalesOrderDocument,
    SalesOrderFilterOptions,
    SalesOrdersQueryResponse,
    SalesOrderStatsResponse,
    SalesOrderSyncRequest,
    SalesOrderSyncResponse,
)
from app.services.rty_sync_service import RtySyncService
from app.services.sap_sales_order_service import SapSalesOrderService, SourceFetchResult

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
    service = RtySyncService(sales_service=SapSalesOrderService())
    try:
        sync_result = await service.sync_sales_range(
            payload.start_date, payload.end_date, payload.prodh_list
        )
    except Exception as exc:
        logger.exception("Sales order sync DB write failed")
        raise HTTPException(status_code=500, detail=f"Database write failed: {exc}") from exc
    results: dict[str, SourceFetchResult] = sync_result["results"]

    successful = [s for s in results if results[s].success]
    if not successful:
        # 两个来源都失败：返回 502，不执行数据库写入
        return JSONResponse(
            status_code=502,
            content={
                "detail": {
                    "message": "Both SAP sources failed",
                    "sources": {s: {"success": False, "error": results[s].error} for s in results},
                }
            },
        )

    partial_success = len(successful) < len(results)

    inserted = sync_result["inserted"]
    updated = sync_result["updated"]
    aufnr_sources = sync_result["aufnr_sources"]
    per_source = sync_result["per_source"]

    order_docs = await repo.get_orders_by_aufnrs(list(aufnr_sources.keys()))
    orders = [_serialize_order(d) for d in sorted(order_docs, key=lambda x: x.get("aufnr", ""))]

    total_fetched = sum(s.fetched_count for s in per_source.values())
    total_skipped = sum(s.skipped_count for s in per_source.values())
    total_unique = len(aufnr_sources)

    return SalesOrderSyncResponse(
        success=True,
        partial_success=partial_success,
        date_range={
            "start_date": payload.start_date.isoformat(),
            "end_date": payload.end_date.isoformat(),
        },
        sources=per_source,
        total_fetched=total_fetched,
        total_unique=total_unique,
        total_skipped=total_skipped,
        inserted=inserted,
        updated=updated,
        orders=orders,
    )


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
    docs, total, has_more = await repo.query_sales_orders(
        cp_xh=cp_xh,
        lgort=lgort,
        date_from=date_from,
        date_to=date_to,
        keyword=keyword,
        page=page,
        page_size=limit,
    )
    items = [_serialize_order(d) for d in docs]
    stats = await repo.aggregate_sales_orders(
        cp_xh=cp_xh,
        lgort=lgort,
        date_from=date_from,
        date_to=date_to,
        keyword=keyword,
    )
    options = await repo.list_sales_order_filter_options()
    return SalesOrdersQueryResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
        has_more=has_more,
        stats=SalesOrderStatsResponse(**stats),
        filterOptions=SalesOrderFilterOptions(**options),
    )
