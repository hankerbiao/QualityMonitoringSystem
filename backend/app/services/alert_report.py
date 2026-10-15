"""
告警报表数据构建服务

实时查询 MongoDB（machine_info + fault_info）聚合，点击链接时计算最新数据。
与 api/rty.py 的过滤逻辑保持一致，但面向「单个告警上下文」做整体聚合。
"""
import re
from datetime import datetime, timezone

from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.alert_report import AlertContext, AlertReportData, AlertReportSummary
from app.schemas.rty import DefectDetail

# 故障明细展示上限（避免超大上下文返回过多数据）
DEFECT_LIMIT = 1000


def _build_machine_filter(ctx: AlertContext) -> dict:
    """构建 machine_info 查询条件，逻辑与 rty.py 保持一致。"""
    qf: dict = {}

    if ctx.salesOrder:
        so = [s.strip() for s in re.split(r"[,，\n]+", ctx.salesOrder) if s.strip()]
        if so:
            qf["sale_no"] = {"$in": so} if len(so) > 1 else so[0]
    if ctx.productionOrder:
        po = [s.strip() for s in re.split(r"[,，\n]+", ctx.productionOrder) if s.strip()]
        if po:
            qf["mfg_order"] = {"$in": po} if len(po) > 1 else po[0]
    if ctx.serialNumber:
        qf["sn"] = ctx.serialNumber
    if ctx.base:
        qf["factory"] = ctx.base
    if ctx.productModel:
        qf["product_family"] = ctx.productModel
    if ctx.customer:
        qf["customer_id"] = ctx.customer
    if ctx.dateFrom:
        qf["actual_start_time"] = {"$gte": ctx.dateFrom}
    if ctx.dateTo:
        if "actual_start_time" in qf:
            qf["actual_start_time"]["$lte"] = ctx.dateTo
        else:
            qf["actual_start_time"] = {"$lte": ctx.dateTo}

    return qf


async def build_alert_report(context: AlertContext) -> AlertReportData:
    """根据告警上下文实时聚合生成报表数据。"""
    db = get_database()
    query_filter = _build_machine_filter(context)

    # 机型指标（目标直通率）
    targets_doc = await db[Collections.CONFIGS].find_one({"key": "model_targets"})
    targets_map: dict[str, float] = (targets_doc or {}).get("targets", {}) or {}

    # 投入 SN（去重）
    sn_cursor = db[Collections.MACHINE_INFO].aggregate([
        {"$match": query_filter},
        {"$group": {"_id": "$sn"}},
    ])
    sn_docs = await sn_cursor.to_list(length=100000)
    sns = [d["_id"] for d in sn_docs if d.get("_id")]
    input_count = len(sns)

    # 故障 SN 数量（去重计数，保证概要准确）
    defect_count = 0
    if sns:
        cnt_cursor = db[Collections.FAULT_INFO].aggregate([
            {"$match": {"sn": {"$in": sns}}},
            {"$group": {"_id": "$sn"}},
            {"$count": "c"},
        ])
        cnt_docs = await cnt_cursor.to_list(length=10)
        defect_count = cnt_docs[0]["c"] if cnt_docs else 0

    rty_rate = round((input_count - defect_count) / input_count * 100, 2) if input_count > 0 else 100.0
    product_model = context.productModel or ""
    target_rate = float(targets_map.get(product_model, 100))
    reached = rty_rate >= target_rate

    # 按机器 SN 和记录 ID 稳定排序，限 DEFECT_LIMIT。
    defects: list[DefectDetail] = []
    if sns:
        defect_cursor = db[Collections.FAULT_INFO].aggregate([
            {"$match": {"sn": {"$in": sns}}},
            {"$sort": {"sn": 1, "_id": 1}},
            {"$limit": DEFECT_LIMIT},
        ])
        items = await defect_cursor.to_list(length=DEFECT_LIMIT)
        defects = [
            DefectDetail(
                id=str(it["_id"]),
                defectCode=it.get("fault_category") or "未知",
                description=it.get("fault_desc") or "",
                count=1,
                sn=it.get("sn") or "",
                sale_no=it.get("sale_no") or "",
                mfg_order=it.get("mfg_order") or "",
                product_family=it.get("product_family") or "",
                fault_2nd_appear=it.get("fault_2nd_appear") or "",
                fault_3rd_appear=it.get("fault_3rd_appear") or "",
                repairPerson=it.get("repair_person") or "",
                repair_effectiveness=it.get("repair_effectiveness") or "",
            )
            for it in items
        ]

    now = datetime.now(timezone.utc)
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
