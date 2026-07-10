"""
RTY (整机综合直通率) API 路由
"""
from fastapi import APIRouter, Query, Request

from app.core.logger import audit_log, log_info
from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.common import Response
from app.schemas.rty import DefectDetail, RTYData, SalesOrderSummary

router = APIRouter()


@router.get("/list", response_model=Response[list[RTYData]])
@audit_log("QUERY", "rty_list")
async def get_rty_list(
    request: Request,
    page: int = Query(1, ge=1, description="页码"),
    limit: int = Query(100, ge=1, le=500, description="每页数量"),
    salesOrder: str | None = Query(None, description="销售订单号 (sale_no)"),
    productionOrder: str | None = Query(None, description="生产订单号 (mfg_order)"),
    serialNumber: str | None = Query(None, description="整机序列号 (sn)"),
    base: str | None = Query(None, description="基地 (factory)"),
    productModel: str | None = Query(None, description="生产机型 (product_family)"),
    aggregateBy: str | None = Query(None, description="聚合方式: mfg_order/product_model/base"),
):
    """
    获取机器信息列表：
    - aggregateBy=product_model: 按生产机型聚合（SN去重）
    - aggregateBy=mfg_order: 按生产订单聚合
    - aggregateBy=base: 按基地聚合
    - 无筛选条件且无aggregateBy: 按生产订单聚合
    - 有其他筛选条件（base/serialNumber）: 逐条展示
    """
    db = get_database()

    targets_doc = await db[Collections.CONFIGS].find_one({"key": "model_targets"})
    targets_map: dict[str, float] = (targets_doc or {}).get("targets", {}) or {}

    query_filter: dict = {}
    if salesOrder:
        query_filter["sale_no"] = salesOrder
    if productionOrder:
        query_filter["mfg_order"] = productionOrder
    if serialNumber:
        query_filter["sn"] = serialNumber
    if base:
        query_filter["factory"] = base
    if productModel:
        query_filter["product_family"] = productModel

    has_order_filter = productionOrder or salesOrder
    has_product_model_filter = productModel and productModel != "all"

    if aggregateBy in ("mfg_order", "product_model", "base"):
        group_by = aggregateBy
    elif has_order_filter:
        group_by = "mfg_order"
    elif has_product_model_filter:
        group_by = "product_family"
    else:
        group_by = "mfg_order"

    if has_order_filter or has_product_model_filter or aggregateBy in ("mfg_order", "product_model", "base") or not query_filter:
        pipeline: list[dict] = []
        if query_filter:
            pipeline.append({"$match": query_filter})

        pipeline.extend([
            {"$group": {
                "_id": f"${group_by}",
                "first_doc": {"$first": "$$ROOT"},
                "sns": {"$addToSet": "$sn"},
            }},
            {"$match": {"_id": {"$ne": None}, "_id": {"$ne": ""}}},
            {"$sort": {"_id": 1}},
        ])

        cursor = db[Collections.MACHINE_INFO].aggregate(pipeline)
        group_docs = await cursor.to_list(length=10000)

        rty_list: list[RTYData] = []
        for doc in group_docs:
            m = doc["first_doc"]
            sns = [s for s in doc["sns"] if s]
            input_count = len(sns)
            defect_count = 0

            if sns:
                defect_pipe = [
                    {"$match": {"sn": {"$in": sns}}},
                    {"$group": {"_id": "$sn"}},
                ]
                async for _d in db[Collections.FAULT_INFO].aggregate(defect_pipe):
                    defect_count += 1

            rty_rate = round((input_count - defect_count) / input_count * 100, 2) if input_count > 0 else 100.0
            product_model = m.get("product_family") or ""

            rty_list.append(RTYData(
                id=doc["_id"] or "unknown",
                time=(m.get("actual_start_time") or "")[:10],
                model=product_model,
                productModel=product_model,
                customer=m.get("customer_id") or "",
                base=m.get("factory") or "",
                defectCount=defect_count,
                inputCount=input_count,
                rtyRate=rty_rate,
                targetRate=float(targets_map.get(product_model, 100)),
                salesOrder=m.get("sale_no") or "",
                productionOrder=m.get("mfg_order") or "",
                productLine=m.get("s_MFGLINENAME") or "",
                orderType=m.get("ordertypename") or "",
                planStartDate=m.get("plannedstartdate") or "",
                planEndDate=m.get("s_Mes_Planendtime") or "",
                serialNumbers=sns[:100],
                status="",
            ))

        agg_name = {"mfg_order": "生产订单", "product_model": "生产机型", "base": "基地"}.get(group_by, group_by)
        log_info(f"聚合模式: 按 {agg_name} 聚合，共 {len(rty_list)} 条")
        return Response(success=True, data=rty_list, message=f"共 {len(rty_list)} 条")

    total = await db[Collections.MACHINE_INFO].count_documents(query_filter)
    skip = (page - 1) * limit
    cursor = (
        db[Collections.MACHINE_INFO]
        .find(query_filter)
        .sort("actual_start_time", -1)
        .skip(skip)
        .limit(limit)
    )
    machines = await cursor.to_list(length=limit)

    sns = [m["sn"] for m in machines if m.get("sn")]
    defect_sns: set[str] = set()
    if sns:
        pipe = [{"$match": {"sn": {"$in": sns}}}, {"$group": {"_id": "$sn"}}]
        async for d in db[Collections.FAULT_INFO].aggregate(pipe):
            defect_sns.add(d["_id"])

    rty_list: list[RTYData] = []
    for m in machines:
        sn = m.get("sn") or ""
        product_model = m.get("product_family") or ""
        defect_count = 1 if sn in defect_sns else 0
        rty_rate = round((1 - defect_count) * 100, 2)

        rty_list.append(RTYData(
            id=str(m.get("_id")),
            time=(m.get("actual_start_time") or "")[:10],
            model=product_model,
            productModel=product_model,
            customer=m.get("customer_id") or "",
            base=m.get("factory") or "",
            defectCount=defect_count,
            inputCount=1,
            rtyRate=rty_rate,
            targetRate=float(targets_map.get(product_model, 100)),
            salesOrder=m.get("sale_no") or "",
            productionOrder=m.get("mfg_order") or "",
            productLine=m.get("s_MFGLINENAME") or "",
            orderType=m.get("ordertypename") or "",
            planStartDate=m.get("plannedstartdate") or "",
            planEndDate=m.get("s_Mes_Planendtime") or "",
            serialNumbers=[sn] if sn else [],
            status="",
        ))

    log_info(f"查询到 {total} 台机器，本页返回 {len(rty_list)} 条")
    return Response(success=True, data=rty_list, message=f"查询到 {total} 台机器")


@router.get("/defects", response_model=Response[list[DefectDetail]])
async def get_defect_details(
    sns: str = Query(..., description="机器序列号列表，逗号分隔"),
):
    """
    获取故障明细（按 SN 查询 fault_info）
    """
    sn_list = [s.strip() for s in sns.split(",") if s.strip()]
    if not sn_list:
        return Response(success=True, data=[], message="无 SN 参数")

    db = get_database()
    pipeline = [
        {"$match": {"sn": {"$in": sn_list}}},
        {"$sort": {"repair_time": -1}},
    ]
    cursor = db[Collections.FAULT_INFO].aggregate(pipeline)
    items = await cursor.to_list(length=5000)

    defect_list = [
        DefectDetail(
            id=str(item["_id"]),
            defectCode=item.get("fault_category") or "未知",
            description=item.get("fault_desc") or "",
            count=1,
            sn=item.get("sn") or "",
            repairTime=item.get("repair_time") or "",
            repairPerson=item.get("repair_person") or "",
        )
        for item in items
    ]

    return Response(success=True, data=defect_list, message=f"查询到 {len(defect_list)} 条故障记录")


@router.get("/defects/by-order", response_model=Response[list[DefectDetail]])
async def get_defect_details_by_order(
    productionOrder: str = Query(..., description="生产订单号"),
):
    """
    获取故障明细（按生产订单查询 machine_info + fault_info）
    """
    log_info(f"按生产订单查询故障明细: {productionOrder}")

    db = get_database()

    sn_pipeline = [
        {"$match": {"mfg_order": productionOrder}},
        {"$group": {"_id": "$sn"}},
    ]
    cursor = db[Collections.MACHINE_INFO].aggregate(sn_pipeline)
    sn_docs = await cursor.to_list(length=5000)
    sn_list = [doc["_id"] for doc in sn_docs if doc.get("_id")]

    if not sn_list:
        return Response(success=True, data=[], message=f"生产订单 {productionOrder} 未找到机器数据")

    defect_pipeline = [
        {"$match": {"sn": {"$in": sn_list}}},
        {"$sort": {"repair_time": -1}},
    ]
    cursor = db[Collections.FAULT_INFO].aggregate(defect_pipeline)
    items = await cursor.to_list(length=5000)

    defect_list = [
        DefectDetail(
            id=str(item["_id"]),
            defectCode=item.get("fault_category") or "未知",
            description=item.get("fault_desc") or "",
            count=1,
            sn=item.get("sn") or "",
            repairTime=item.get("repair_time") or "",
            repairPerson=item.get("repair_person") or "",
        )
        for item in items
    ]

    return Response(success=True, data=defect_list, message=f"查询到 {len(defect_list)} 条故障记录")


@router.get("/sales-order-summary", response_model=Response[list[SalesOrderSummary]])
async def get_sales_order_summary(
    salesOrders: str = Query(..., description="销售订单号列表，逗号分隔"),
):
    """
    按销售订单汇总：返回每个销售订单的总览数据
    - inputCount: 该订单下机器总数
    - defectCount: 去重故障SN数量
    - rtyRate: 直通率
    """
    order_list = [o.strip() for o in salesOrders.split(",") if o.strip()]
    if not order_list:
        return Response(success=True, data=[], message="无销售订单参数")

    log_info(f"按销售订单汇总: {order_list}")

    db = get_database()
    summary_list: list[SalesOrderSummary] = []

    for order in order_list:
        sn_pipeline = [
            {"$match": {"sale_no": order}},
            {"$group": {"_id": "$sn"}},
        ]
        cursor = db[Collections.MACHINE_INFO].aggregate(sn_pipeline)
        sn_docs = await cursor.to_list(length=5000)
        sn_list = [doc["_id"] for doc in sn_docs if doc.get("_id")]
        input_count = len(sn_list)

        defect_count = 0
        if sn_list:
            defect_pipeline = [
                {"$match": {"sn": {"$in": sn_list}}},
                {"$group": {"_id": "$sn"}},
            ]
            cursor = db[Collections.FAULT_INFO].aggregate(defect_pipeline)
            defect_docs = await cursor.to_list(length=5000)
            defect_count = len(defect_docs)

        rty_rate = round((input_count - defect_count) / input_count * 100, 2) if input_count > 0 else 100.0

        summary_list.append(SalesOrderSummary(
            salesOrder=order,
            inputCount=input_count,
            defectCount=defect_count,
            rtyRate=rty_rate,
        ))

    return Response(success=True, data=summary_list, message=f"查询到 {len(summary_list)} 个销售订单")


@router.get("/production-orders/by-sales-order", response_model=Response[list[str]])
async def get_production_orders_by_sales_order(
    salesOrder: str = Query(..., description="销售订单号 (sale_no)"),
):
    """
    根据销售订单号查询对应的生产订单列表
    """
    log_info(f"根据销售订单查询生产订单: {salesOrder}")

    db = get_database()
    pipeline = [
        {"$match": {"sale_no": salesOrder}},
        {"$group": {"_id": "$mfg_order"}},
        {"$match": {"_id": {"$ne": None}}},
        {"$sort": {"_id": 1}},
    ]
    cursor = db[Collections.MACHINE_INFO].aggregate(pipeline)
    docs = await cursor.to_list(length=1000)

    orders = [doc["_id"] for doc in docs]
    log_info(f"销售订单 {salesOrder} 对应 {len(orders)} 个生产订单")
    return Response(success=True, data=orders, message=f"查询到 {len(orders)} 个生产订单")


@router.get("/product-models", response_model=Response[list[dict]])
async def get_product_models():
    """
    获取所有生产机型列表及其数量
    """
    db = get_database()
    pipeline = [
        {"$group": {"_id": "$product_family", "count": {"$sum": 1}}},
        {"$match": {"_id": {"$ne": None}}},
        {"$sort": {"_id": 1}},
    ]
    cursor = db[Collections.MACHINE_INFO].aggregate(pipeline)
    docs = await cursor.to_list(length=1000)

    result = [{"model": doc["_id"], "count": doc["count"]} for doc in docs]
    return Response(success=True, data=result, message=f"查询到 {len(result)} 个生产机型")


@router.get("/sales-orders", response_model=Response[list[str]])
async def get_sales_orders(
    q: str = Query("", description="搜索关键词"),
    limit: int = Query(10, ge=1, le=50, description="返回数量限制"),
):
    """
    获取销售订单列表（支持关键词搜索）
    """
    db = get_database()
    pipeline = [
        {"$group": {"_id": "$sale_no"}},
        {"$match": {"_id": {"$ne": None}, "_id": {"$ne": ""}}},
        {"$sort": {"_id": -1}},
        {"$limit": 500},
    ]
    cursor = db[Collections.MACHINE_INFO].aggregate(pipeline)
    docs = await cursor.to_list(length=500)

    all_orders = [doc["_id"] for doc in docs]

    if not q:
        return Response(success=True, data=all_orders[:limit], message=f"返回 {min(limit, len(all_orders))} 条")

    filtered = [o for o in all_orders if q.lower() in o.lower()]
    return Response(success=True, data=filtered[:limit], message=f"返回 {min(limit, len(filtered))} 条")
