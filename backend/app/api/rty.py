"""
RTY (整机综合直通率) API 路由
"""
from typing import Optional, List
from fastapi import APIRouter, Query, Request

from app.db.mongodb import get_database
from app.schemas.rty import RTYData
from app.schemas.common import Response
from app.models.documents import Collections
from app.core.logger import log_info, log_debug

router = APIRouter()


@router.get("/list", response_model=Response[List[RTYData]])
async def get_rty_list(
    stat_method: Optional[str] = Query(None, description="统计方式: 整体直通率/过站直通率"),
    date_from: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD"),
    model: Optional[str] = Query(None, description="计算方法: 普通机型/复合机型/全部"),
    product_model: Optional[str] = Query(None, alias="productModel", description="生产机型"),
    customer: Optional[str] = Query(None, description="客户名称"),
    base: Optional[str] = Query(None, description="基地"),
    sales_order: Optional[str] = Query(None, alias="salesOrder", description="销售订单号"),
    production_order: Optional[str] = Query(None, alias="productionOrder", description="生产订单号"),
    serial_number: Optional[str] = Query(None, alias="serialNumber", description="整机序列号"),
    page: int = Query(1, ge=1, description="页码"),
    limit: int = Query(100, ge=1, le=500, description="每页数量"),
):
    """
    获取 RTY 数据列表
    """
    log_info(f"查询 RTY 列表 - 页码: {page}, 每页: {limit}")

    db = get_database()

    query = {}

    if date_from:
        query["time"] = {"$gte": date_from}
    if date_to:
        if "time" in query:
            query["time"]["$lte"] = date_to
        else:
            query["time"] = {"$lte": date_to}

    if model and model != "all":
        query["model"] = model

    if product_model and product_model != "all":
        query["productModel"] = product_model

    if customer:
        query["customer"] = {"$regex": customer, "$options": "i"}

    if base and base != "all":
        query["base"] = base

    if stat_method:
        query["statMethod"] = stat_method

    log_debug(f"查询条件: {query}")

    skip = (page - 1) * limit

    cursor = db[Collections.RTY_DATA].find(query).sort("time", -1).skip(skip).limit(limit)
    items = await cursor.to_list(length=limit)

    rty_list = []
    for item in items:
        rty_list.append(RTYData(
            id=str(item["_id"]),
            time=item["time"],
            model=item["model"],
            productModel=item["productModel"],
            customer=item.get("customer", ""),
            base=item["base"],
            defectCount=item["defectCount"],
            inputCount=item["inputCount"],
            rtyRate=item["rtyRate"],
            targetRate=item["targetRate"],
            salesOrder=item.get("salesOrder", ""),
            productionOrder=item.get("productionOrder", ""),
            productLine=item.get("productLine", ""),
            orderType=item.get("orderType", ""),
            planStartDate=item.get("planStartDate", ""),
            planEndDate=item.get("planEndDate", ""),
            status=item.get("status", ""),
        ))

    total = await db[Collections.RTY_DATA].count_documents(query)

    log_info(f"查询到 {total} 条记录，返回 {len(rty_list)} 条")

    return Response(
        success=True,
        data=rty_list,
        message=f"查询到 {total} 条记录"
    )