"""
RTY (整机综合直通率) API 路由
"""
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query, Request

from app.db.mongodb import get_database
from app.schemas.rty import (
    RTYData,
    RTYDataCreate,
    RTYListResponse,
    DefectDetail,
    DefectDetailListResponse,
    InputDetail,
    InputDetailListResponse,
    CycleStatsResponse,
)
from app.schemas.common import Response
from app.models.documents import Collections
from app.core.logger import (
    log_info, log_warning, log_error, log_debug,
    get_audit_logger, get_client_ip
)

router = APIRouter()


def str_to_object_id(id_str: str) -> dict:
    """将字符串ID转换为 MongoDB ObjectId 查询格式"""
    from bson import ObjectId
    return {"_id": ObjectId(id_str)}


def _get_user_info(request: Request) -> tuple:
    """从请求中提取用户信息"""
    user_id = request.headers.get("X-User-ID", "anonymous")
    username = request.headers.get("X-Username", "anonymous")
    client_ip = get_client_ip(request)
    return user_id, username, client_ip


def _get_audit_context(
    request: Request,
    action: str,
    resource: str,
    method: str = "HTTP"
):
    """获取审计上下文 - 安全版本，防止未初始化时报错"""
    audit_logger = get_audit_logger()
    if audit_logger is None:
        from contextlib import nullcontext
        return nullcontext()

    return audit_logger.audit_context(
        action=action,
        resource=resource,
        user_id=request.headers.get("X-User-ID"),
        username=request.headers.get("X-Username", "anonymous"),
        client_ip=get_client_ip(request),
        method=method,
    )


# ============== RTY 数据接口 ==============

@router.get("/list", response_model=Response[List[RTYData]])
async def get_rty_list(
    request: Request,
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

    支持多维度过滤查询:
    - 时间范围 (date_from, date_to)
    - 计算方法 (model)
    - 生产机型 (productModel)
    - 客户 (customer)
    - 基地 (base)
    - 销售订单/生产订单/序列号 (待后端数据完善后启用)
    """
    log_info(f"查询 RTY 列表 - 页码: {page}, 每页: {limit}")

    with _get_audit_context(request, "QUERY", "/api/rty/list", "GET") as ctx:
        db = get_database()

        # 构建查询条件
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

        # 统计方式过滤 (如果实现了不同的计算逻辑)
        if stat_method:
            query["statMethod"] = stat_method

        log_debug(f"查询条件: {query}")

        # 执行查询
        skip = (page - 1) * limit

        cursor = db[Collections.RTY_DATA].find(query).sort("time", -1).skip(skip).limit(limit)
        items = await cursor.to_list(length=limit)

        # 转换为响应格式
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
                # MES 额外字段
                salesOrder=item.get("salesOrder", ""),
                productionOrder=item.get("productionOrder", ""),
                productLine=item.get("productLine", ""),
                orderType=item.get("orderType", ""),
                planStartDate=item.get("planStartDate", ""),
                planEndDate=item.get("planEndDate", ""),
                status=item.get("status", ""),
            ))

        # 获取总数
        total = await db[Collections.RTY_DATA].count_documents(query)

        log_info(f"查询到 {total} 条记录，返回 {len(rty_list)} 条")
        if ctx and hasattr(ctx, 'mark_success'):
            ctx.mark_success(f"查询到 {total} 条记录")

        return Response(
            success=True,
            data=rty_list,
            message=f"查询到 {total} 条记录"
        )


@router.get("/{record_id}", response_model=Response[RTYData])
async def get_rty_by_id(request: Request, record_id: str):
    """
    根据 ID 获取单条 RTY 数据
    """
    log_info(f"查询 RTY 记录: {record_id}")

    with _get_audit_context(request, "QUERY", f"/api/rty/{record_id}", "GET") as ctx:
        from bson import ObjectId

        db = get_database()

        try:
            item = await db[Collections.RTY_DATA].find_one({"_id": ObjectId(record_id)})
        except Exception as e:
            log_warning(f"无效的记录ID格式: {record_id}")
            if ctx and hasattr(ctx, 'mark_failed'):
                ctx.mark_failed(f"无效的记录ID格式: {str(e)}")
            raise HTTPException(status_code=400, detail="Invalid record ID format")

        if not item:
            log_warning(f"记录不存在: {record_id}")
            if ctx and hasattr(ctx, 'mark_failed'):
                ctx.mark_failed(f"记录不存在: {record_id}")
            raise HTTPException(status_code=404, detail="Record not found")

        if ctx and hasattr(ctx, 'mark_success'):
            ctx.mark_success(f"获取记录: {record_id}")

        return Response(
            success=True,
            data=RTYData(
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
            )
        )


@router.post("", response_model=Response[RTYData])
async def create_rty_data(request: Request, data: RTYDataCreate):
    """
    创建 RTY 数据记录
    """
    log_info(f"创建 RTY 数据 - 机型: {data.productModel}, 基地: {data.base}")

    with _get_audit_context(request, "CREATE", "/api/rty", "POST") as ctx:
        db = get_database()

        # 计算 RTY 率 (如果未提供)
        if data.inputCount > 0:
            rty_rate = ((data.inputCount - data.defectCount) / data.inputCount) * 100
            rty_rate = round(rty_rate, 3)
        else:
            rty_rate = 100.0

        document = {
            "time": data.time,
            "model": data.model,
            "productModel": data.productModel,
            "customer": data.customer,
            "base": data.base,
            "defectCount": data.defectCount,
            "inputCount": data.inputCount,
            "rtyRate": data.rtyRate if data.rtyRate else rty_rate,
            "targetRate": data.targetRate,
            # MES 额外字段
            "salesOrder": data.salesOrder,
            "productionOrder": data.productionOrder,
            "productLine": data.productLine,
            "orderType": data.orderType,
            "planStartDate": data.planStartDate,
            "planEndDate": data.planEndDate,
            "status": data.status,
            "createdAt": datetime.utcnow(),
            "updatedAt": datetime.utcnow(),
        }

        result = await db[Collections.RTY_DATA].insert_one(document)

        log_info(f"RTY 记录创建成功 - ID: {result.inserted_id}")
        if ctx and hasattr(ctx, 'mark_success'):
            ctx.mark_success(f"创建记录 ID: {result.inserted_id}")

        return Response(
            success=True,
            data=RTYData(
                id=str(result.inserted_id),
                time=data.time,
                model=data.model,
                productModel=data.productModel,
                customer=data.customer,
                base=data.base,
                defectCount=data.defectCount,
                inputCount=data.inputCount,
                rtyRate=data.rtyRate if data.rtyRate else rty_rate,
                targetRate=data.targetRate,
                salesOrder=data.salesOrder,
                productionOrder=data.productionOrder,
                productLine=data.productLine,
                orderType=data.orderType,
                planStartDate=data.planStartDate,
                planEndDate=data.planEndDate,
                status=data.status,
            ),
            message="创建成功"
        )


@router.put("/{record_id}", response_model=Response[RTYData])
async def update_rty_data(request: Request, record_id: str, data: RTYDataCreate):
    """
    更新 RTY 数据记录
    """
    log_info(f"更新 RTY 数据 - ID: {record_id}")

    with _get_audit_context(request, "UPDATE", f"/api/rty/{record_id}", "PUT") as ctx:
        from bson import ObjectId

        db = get_database()

        try:
            obj_id = ObjectId(record_id)
        except Exception as e:
            log_warning(f"无效的记录ID格式: {record_id}")
            if ctx and hasattr(ctx, 'mark_failed'):
                ctx.mark_failed(f"无效的记录ID格式: {str(e)}")
            raise HTTPException(status_code=400, detail="Invalid record ID format")

        # 计算 RTY 率
        if data.inputCount > 0:
            rty_rate = ((data.inputCount - data.defectCount) / data.inputCount) * 100
            rty_rate = round(rty_rate, 3)
        else:
            rty_rate = 100.0

        update_data = {
            "time": data.time,
            "model": data.model,
            "productModel": data.productModel,
            "customer": data.customer,
            "base": data.base,
            "defectCount": data.defectCount,
            "inputCount": data.inputCount,
            "rtyRate": data.rtyRate if data.rtyRate else rty_rate,
            "targetRate": data.targetRate,
            "updatedAt": datetime.utcnow(),
        }

        result = await db[Collections.RTY_DATA].update_one(
            {"_id": obj_id},
            {"$set": update_data}
        )

        if result.matched_count == 0:
            log_warning(f"记录不存在: {record_id}")
            if ctx and hasattr(ctx, 'mark_failed'):
                ctx.mark_failed(f"记录不存在: {record_id}")
            raise HTTPException(status_code=404, detail="Record not found")

        # 获取更新后的数据
        item = await db[Collections.RTY_DATA].find_one({"_id": obj_id})

        log_info(f"RTY 记录更新成功 - ID: {record_id}")
        if ctx and hasattr(ctx, 'mark_success'):
            ctx.mark_success(f"更新记录 ID: {record_id}")

        return Response(
            success=True,
            data=RTYData(
                id=str(item["_id"]),
                time=item["time"],
                model=item["model"],
                productModel=item["productModel"],
                customer=item["customer"],
                base=item["base"],
                defectCount=item["defectCount"],
                inputCount=item["inputCount"],
                rtyRate=item["rtyRate"],
                targetRate=item["targetRate"],
            ),
            message="更新成功"
        )


@router.delete("/{record_id}", response_model=Response)
async def delete_rty_data(request: Request, record_id: str):
    """
    删除 RTY 数据记录
    """
    log_info(f"删除 RTY 数据 - ID: {record_id}")

    with _get_audit_context(request, "DELETE", f"/api/rty/{record_id}", "DELETE") as ctx:
        from bson import ObjectId

        db = get_database()

        try:
            obj_id = ObjectId(record_id)
        except Exception as e:
            log_warning(f"无效的记录ID格式: {record_id}")
            if ctx and hasattr(ctx, 'mark_failed'):
                ctx.mark_failed(f"无效的记录ID格式: {str(e)}")
            raise HTTPException(status_code=400, detail="Invalid record ID format")

        result = await db[Collections.RTY_DATA].delete_one({"_id": obj_id})

        if result.deleted_count == 0:
            log_warning(f"记录不存在: {record_id}")
            if ctx and hasattr(ctx, 'mark_failed'):
                ctx.mark_failed(f"记录不存在: {record_id}")
            raise HTTPException(status_code=404, detail="Record not found")

        log_info(f"RTY 记录删除成功 - ID: {record_id}")
        if ctx and hasattr(ctx, 'mark_success'):
            ctx.mark_success(f"删除记录 ID: {record_id}")

        return Response(success=True, message="删除成功")


# ============== 故障明细接口 ==============

@router.get("/defect-details/{record_id}", response_model=Response[List[DefectDetail]])
async def get_defect_details(request: Request, record_id: str):
    """
    获取指定 RTY 记录的故障明细
    """
    log_info(f"查询故障明细 - 记录ID: {record_id}")

    with _get_audit_context(request, "QUERY", f"/api/rty/defect-details/{record_id}", "GET") as ctx:
        db = get_database()

        doc = await db[Collections.DEFECT_DETAILS].find_one({"recordId": record_id})

        if not doc:
            log_info(f"无故障明细数据 - 记录ID: {record_id}")
            if ctx and hasattr(ctx, 'mark_success'):
                ctx.mark_success("无故障明细数据")
            return Response(success=True, data=[], message="无故障明细数据")

        details = [
            DefectDetail(
                id=item["id"],
                defectCode=item["defectCode"],
                description=item["description"],
                count=item["count"],
            )
            for item in doc.get("details", [])
        ]

        log_info(f"获取故障明细 {len(details)} 条 - 记录ID: {record_id}")
        if ctx and hasattr(ctx, 'mark_success'):
            ctx.mark_success(f"获取 {len(details)} 条故障明细")

        return Response(success=True, data=details)


@router.post("/defect-details/{record_id}", response_model=Response)
async def create_defect_details(request: Request, record_id: str, details: List[DefectDetail]):
    """
    创建或更新指定 RTY 记录的故障明细
    """
    log_info(f"保存故障明细 - 记录ID: {record_id}, 明细数: {len(details)}")

    with _get_audit_context(request, "CREATE", f"/api/rty/defect-details/{record_id}", "POST") as ctx:
        db = get_database()

        document = {
            "recordId": record_id,
            "details": [
                {
                    "id": d.id,
                    "defectCode": d.defectCode,
                    "description": d.description,
                    "count": d.count,
                }
                for d in details
            ],
            "updatedAt": datetime.utcnow(),
        }

        await db[Collections.DEFECT_DETAILS].update_one(
            {"recordId": record_id},
            {"$set": document},
            upsert=True
        )

        log_info(f"故障明细保存成功 - 记录ID: {record_id}")
        if ctx and hasattr(ctx, 'mark_success'):
            ctx.mark_success(f"保存 {len(details)} 条故障明细")

        return Response(success=True, message="故障明细保存成功")


# ============== 投入明细接口 ==============

@router.get("/input-details/{record_id}", response_model=Response[List[InputDetail]])
async def get_input_details(request: Request, record_id: str):
    """
    获取指定 RTY 记录的投入明细
    """
    log_info(f"查询投入明细 - 记录ID: {record_id}")

    with _get_audit_context(request, "QUERY", f"/api/rty/input-details/{record_id}", "GET") as ctx:
        db = get_database()

        doc = await db[Collections.INPUT_DETAILS].find_one({"recordId": record_id})

        if not doc:
            log_info(f"无投入明细数据 - 记录ID: {record_id}")
            if ctx and hasattr(ctx, 'mark_success'):
                ctx.mark_success("无投入明细数据")
            return Response(success=True, data=[], message="无投入明细数据")

        details = [
            InputDetail(
                id=item["id"],
                workOrder=item["workOrder"],
                productLine=item["productLine"],
                count=item["count"],
            )
            for item in doc.get("details", [])
        ]

        log_info(f"获取投入明细 {len(details)} 条 - 记录ID: {record_id}")
        if ctx and hasattr(ctx, 'mark_success'):
            ctx.mark_success(f"获取 {len(details)} 条投入明细")

        return Response(success=True, data=details)


@router.post("/input-details/{record_id}", response_model=Response)
async def create_input_details(request: Request, record_id: str, details: List[InputDetail]):
    """
    创建或更新指定 RTY 记录的投入明细
    """
    log_info(f"保存投入明细 - 记录ID: {record_id}, 明细数: {len(details)}")

    with _get_audit_context(request, "CREATE", f"/api/rty/input-details/{record_id}", "POST") as ctx:
        db = get_database()

        document = {
            "recordId": record_id,
            "details": [
                {
                    "id": d.id,
                    "workOrder": d.workOrder,
                    "productLine": d.productLine,
                    "count": d.count,
                }
                for d in details
            ],
            "updatedAt": datetime.utcnow(),
        }

        await db[Collections.INPUT_DETAILS].update_one(
            {"recordId": record_id},
            {"$set": document},
            upsert=True
        )

        log_info(f"投入明细保存成功 - 记录ID: {record_id}")
        if ctx and hasattr(ctx, 'mark_success'):
            ctx.mark_success(f"保存 {len(details)} 条投入明细")

        return Response(success=True, message="投入明细保存成功")


# ============== 周期统计接口 ==============

@router.get("/stats/cycle", response_model=Response[CycleStatsResponse])
async def get_cycle_stats(
    request: Request,
    months: int = Query(6, ge=1, le=24, description="统计周期月数"),
    models: Optional[List[str]] = Query(None, description="筛选的机型列表"),
):
    """
    获取周期统计数据
    """
    log_info(f"查询周期统计 - 月数: {months}")

    with _get_audit_context(request, "QUERY", "/api/rty/stats/cycle", "GET") as ctx:
        db = get_database()

        from datetime import timedelta

        # 计算日期范围
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=months * 30)

        # 构建查询
        query = {
            "time": {
                "$gte": start_date.strftime("%Y-%m-%d"),
                "$lte": end_date.strftime("%Y-%m-%d"),
            }
        }

        if models:
            query["productModel"] = {"$in": models}

        # 聚合查询
        pipeline = [
            {"$match": query},
            {
                "$group": {
                    "_id": "$productModel",
                    "totalInput": {"$sum": "$inputCount"},
                    "totalDefect": {"$sum": "$defectCount"},
                }
            }
        ]

        cursor = db[Collections.RTY_DATA].aggregate(pipeline)
        model_stats = await cursor.to_list(length=100)

        # 计算汇总统计
        total_input = 0
        total_defect = 0
        model_rty_map = {}

        for stat in model_stats:
            model = stat["_id"]
            input_count = stat["totalInput"]
            defect_count = stat["totalDefect"]

            total_input += input_count
            total_defect += defect_count

            if input_count > 0:
                rty = ((input_count - defect_count) / input_count) * 100
                model_rty_map[model] = {
                    "input": input_count,
                    "defect": defect_count,
                    "rty": rty,
                    "defectRate": defect_count / input_count,
                }

        # 找出高风险和最佳机型
        highest_risk_model = "无"
        best_model = "无"
        max_defect_rate = -1
        max_rty = -1

        for model, stats in model_rty_map.items():
            if stats["defectRate"] > max_defect_rate:
                max_defect_rate = stats["defectRate"]
                highest_risk_model = model
            if stats["rty"] > max_rty:
                max_rty = stats["rty"]
                best_model = model

        # 计算综合平均 RTY
        avg_rty = 0.0
        if total_input > 0:
            avg_rty = ((total_input - total_defect) / total_input) * 100

        # 按月聚合计算产量最高月份
        monthly_pipeline = [
            {"$match": query},
            {
                "$group": {
                    "_id": {"$substr": ["$time", 0, 7]},
                    "totalInput": {"$sum": "$inputCount"},
                }
            },
            {"$sort": {"totalInput": -1}},
            {"$limit": 1},
        ]

        cursor = db[Collections.RTY_DATA].aggregate(monthly_pipeline)
        monthly_stats = await cursor.to_list(length=1)

        max_input_month = "无"
        if monthly_stats:
            max_input_month = monthly_stats[0]["_id"]

        # 构建趋势数据
        trend_pipeline = [
            {"$match": query},
            {
                "$group": {
                    "_id": {
                        "month": {"$substr": ["$time", 0, 7]},
                        "productModel": "$productModel",
                    },
                    "inputCount": {"$sum": "$inputCount"},
                    "defectCount": {"$sum": "$defectCount"},
                }
            },
            {"$sort": {"_id.month": 1}},
        ]

        cursor = db[Collections.RTY_DATA].aggregate(trend_pipeline)
        trend_raw = await cursor.to_list(length=1000)

        # 整理趋势数据
        trend_map = {}
        for item in trend_raw:
            month = item["_id"]["month"]
            product_model = item["_id"]["productModel"]

            if month not in trend_map:
                trend_map[month] = {"time": month}

            input_count = item["inputCount"]
            defect_count = item["defectCount"]
            rty = ((input_count - defect_count) / input_count * 100) if input_count > 0 else 0

            trend_map[month][f"{product_model}_input"] = input_count
            trend_map[month][f"{product_model}_rty"] = round(rty, 3)

        trend_data = [trend_map[m] for m in sorted(trend_map.keys())]

        stats = CycleStatsResponse(
            totalInput=total_input,
            totalDefect=total_defect,
            avgRty=round(avg_rty, 2),
            maxInputMonth=max_input_month,
            highestRiskModel=highest_risk_model,
            bestModel=best_model,
            trendData=trend_data,
            heatmapData=[],
        )

        log_info(f"周期统计完成 - 累计投入: {total_input}, 平均RTY: {avg_rty:.2f}%")
        if ctx and hasattr(ctx, 'mark_success'):
            ctx.mark_success(f"累计投入: {total_input}, 平均RTY: {avg_rty:.2f}%")

        return Response(success=True, data=stats)


# ============== 批量导入接口 ==============

@router.post("/batch", response_model=Response)
async def batch_import_rty_data(request: Request, data_list: List[RTYDataCreate]):
    """
    批量导入 RTY 数据
    """
    log_info(f"批量导入 RTY 数据 - 数量: {len(data_list)}")

    with _get_audit_context(request, "BATCH_IMPORT", "/api/rty/batch", "POST") as ctx:
        db = get_database()

        if not data_list:
            log_warning("批量导入失败 - 数据列表为空")
            if ctx and hasattr(ctx, 'mark_failed'):
                ctx.mark_failed("数据列表为空")
            raise HTTPException(status_code=400, detail="数据列表不能为空")

        documents = []
        for data in data_list:
            if data.inputCount > 0:
                rty_rate = ((data.inputCount - data.defectCount) / data.inputCount) * 100
                rty_rate = round(rty_rate, 3)
            else:
                rty_rate = 100.0

            documents.append({
                "time": data.time,
                "model": data.model,
                "productModel": data.productModel,
                "customer": data.customer,
                "base": data.base,
                "defectCount": data.defectCount,
                "inputCount": data.inputCount,
                "rtyRate": data.rtyRate if data.rtyRate else rty_rate,
                "targetRate": data.targetRate,
                "createdAt": datetime.utcnow(),
                "updatedAt": datetime.utcnow(),
            })

        result = await db[Collections.RTY_DATA].insert_many(documents)

        log_info(f"批量导入成功 - 导入 {len(result.inserted_ids)} 条记录")
        if ctx and hasattr(ctx, 'mark_success'):
            ctx.mark_success(f"导入 {len(result.inserted_ids)} 条记录")

        return Response(
            success=True,
            message=f"成功导入 {len(result.inserted_ids)} 条记录"
        )


# ============== 统计接口 ==============

@router.get("/stats/summary")
async def get_rty_summary(request: Request):
    """
    获取 RTY 数据统计摘要
    """
    log_info("查询 RTY 统计摘要")

    with _get_audit_context(request, "QUERY", "/api/rty/stats/summary", "GET") as ctx:
        db = get_database()

        # 统计各基地数量
        base_stats = await db[Collections.RTY_DATA].aggregate([
            {"$group": {"_id": "$base", "count": {"$sum": 1}}}
        ]).to_list(length=100)

        # 统计各机型数量
        model_stats = await db[Collections.RTY_DATA].aggregate([
            {"$group": {"_id": "$productModel", "count": {"$sum": 1}}}
        ]).to_list(length=100)

        # 获取最新更新时间
        latest = await db[Collections.RTY_DATA].find_one(sort=[("createdAt", -1)])

        total = await db[Collections.RTY_DATA].count_documents({})
        log_info(f"RTY 统计摘要 - 总记录: {total}")
        if ctx and hasattr(ctx, 'mark_success'):
            ctx.mark_success(f"总记录: {total}")

        return Response(
            success=True,
            data={
                "totalRecords": total,
                "baseStats": [{"base": s["_id"], "count": s["count"]} for s in base_stats],
                "modelStats": [{"model": s["_id"], "count": s["count"]} for s in model_stats],
                "lastUpdated": latest["createdAt"].isoformat() if latest else None,
            }
        )