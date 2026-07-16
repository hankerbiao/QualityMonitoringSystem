"""
每日物料故障率(LRR)预警定时任务服务

每天 17:30（由 main.py 的 APScheduler 调用）自动统计：
- 聚合 assembly_records（有装配扫号，分母）∪ fault_info（故障，分子）
- 仅对有装配扫号的物料计算 LRR = 故障数 / 总装配数 * 100
- 若某物料 LRR ≥ 配置的「物料故障率阈值(lrrAlertThreshold)」，则计入超标列表
- 若存在超标物料，发送一封汇总预警邮件（表格列出超标物料）

设计要点:
- 与 weekly_alert 类似，读 email_alert_config 的 enabled + lrrAlertThreshold。
- 无装配扫号物料没有分母（lrrRate 不参与计算），按业务口径不参与判定。
- 复用 alert_mail.send_lrr_alert_email 与 LRR 邮件模板，保证邮件风格一致。
- email_alert_config.enabled=False / 阈值<=0 / 无有效收件人时整体跳过。
"""
from app.core.logger import log_error, log_info, log_warning
from app.db.mongodb import get_database
from app.models.documents import Collections
from app.services.alert_mail import send_lrr_alert_email


async def _compute_lrr_items() -> list[dict]:
    """
    聚合 assembly_records ∪ fault_info，返回有装配扫号物料的 LRR 明细。

    仅遍历 assembly_records 中的物料（即有分母的「有装配扫号」物料），
    故障数来自 fault_info.reinsert_lot 分组。无装配扫号物料无分母，不参与计算。
    """
    db = get_database()
    assembly_col = db[Collections.ASSEMBLY_RECORDS]
    fault_col = db[Collections.FAULT_INFO]

    # 分母：有装配扫号物料的总装配数
    assembly_pipeline = [
        {"$match": {"product_no": {"$nin": [None, ""]}}},
        {"$group": {
            "_id": "$product_no",
            "totalCount": {"$sum": 1},
            "materialDesc": {"$first": "$product_desc"},
        }},
    ]
    cursor = assembly_col.aggregate(assembly_pipeline)
    assembly_docs = await cursor.to_list(length=10000)
    assembly_map: dict[str, dict] = {}
    for d in assembly_docs:
        mid = d.get("_id")
        if mid:
            assembly_map[mid] = d

    # 分子：故障物料的故障次数
    fault_pipeline = [
        {"$match": {"reinsert_lot": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$reinsert_lot", "faultCount": {"$sum": 1}}},
    ]
    cursor = fault_col.aggregate(fault_pipeline)
    fault_docs = await cursor.to_list(length=10000)
    fault_map: dict[str, int] = {}
    for d in fault_docs:
        rid = d.get("_id")
        if rid:
            fault_map[rid] = d.get("faultCount", 0)

    items: list[dict] = []
    for mat, a in assembly_map.items():
        total_count = a.get("totalCount", 0)
        fault_count = fault_map.get(mat, 0)
        lrr_rate = round(fault_count / total_count * 100, 2) if total_count > 0 else 0.0
        items.append({
            "materialNo": mat,
            "materialDesc": a.get("materialDesc", "") or "",
            "totalCount": total_count,
            "faultCount": fault_count,
            "lrrRate": lrr_rate,
        })
    return items


async def run_daily_lrr_check() -> dict:
    """
    执行一次每日物料故障率(LRR)预警检查。

    Returns:
        dict: 检查概要 {checked, reason?, threshold, totalMaterials, exceeded, alertsSent, details}
    """
    db = get_database()
    cfg_doc = await db[Collections.CONFIGS].find_one({"key": "email_alert_config"})
    enabled = (cfg_doc or {}).get("enabled", True)
    threshold = float((cfg_doc or {}).get("lrrAlertThreshold", 5.0))

    if not enabled:
        log_info("邮件预警未启用，跳过每日 LRR 故障率统计")
        return {"checked": False, "reason": "disabled", "exceeded": 0, "alertsSent": 0}

    if threshold <= 0:
        log_info("物料故障率阈值(lrrAlertThreshold)为 0，跳过每日 LRR 故障率统计")
        return {"checked": False, "reason": "threshold_zero", "exceeded": 0, "alertsSent": 0}

    log_info(f"每日 LRR 故障率预警统计开始: 阈值={threshold}%")

    items = await _compute_lrr_items()
    exceeded = [it for it in items if it["lrrRate"] >= threshold]
    # 按 LRR 降序，邮件中优先展示最严重的物料
    exceeded.sort(key=lambda x: x["lrrRate"], reverse=True)

    log_info(
        f"每日 LRR 故障率统计完成: 有装配扫号物料={len(items)}, "
        f"超标={len(exceeded)}, 阈值={threshold}%"
    )

    if not exceeded:
        return {
            "checked": True,
            "threshold": threshold,
            "totalMaterials": len(items),
            "exceeded": 0,
            "alertsSent": 0,
            "details": [],
        }

    # 存在超标物料，发送一封汇总预警邮件
    try:
        result = await send_lrr_alert_email(exceeded, threshold)
        alerts_sent = 1 if result.get("sent") else 0
        if not result.get("sent"):
            log_warning(f"LRR 故障率预警邮件未发送: reason={result.get('reason')}")
    except Exception as exc:  # 单封邮件发送失败不影响记录概要
        log_error(f"LRR 故障率预警邮件发送异常: {exc}")
        alerts_sent = 0

    return {
        "checked": True,
        "threshold": threshold,
        "totalMaterials": len(items),
        "exceeded": len(exceeded),
        "alertsSent": alerts_sent,
        "details": exceeded,
    }
