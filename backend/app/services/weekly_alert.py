"""
每周生产量预警定时任务服务

每天 17:00（由 main.py 的 APScheduler 调用）自动统计：
- 时间窗口：上周五 00:00:00 ~ 当前运行时刻（滚动周窗口，最长 7 天）
- 对每个机型统计窗口内投入台数（按 SN 去重）
- 若投入台数 ≥ 配置的「周生产量阈值」，且实际 RTY < 目标直通率，则发送告警邮件

设计要点:
- 窗口计算完全离线（datetime），不依赖任何外部服务，可正确获取「今天是周几」。
- 复用 alert_report.build_alert_report 的聚合逻辑与 alert_mail.send_rty_alert_email 的邮件模板，
  保证定时预警邮件与手动点击触发的告警邮件样式、报表链接一致。
- email_alert_config.enabled=False 或无有效收件人时整体跳过（send_rty_alert_email 内部也会兜底）。
"""

from datetime import datetime, timedelta

from app.core.logger import log_error, log_info, log_warning
from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.alert_report import AlertContext
from app.services.alert_mail import send_rty_alert_email


def compute_last_friday_window(now: datetime | None = None) -> tuple[str, str]:
    """
    返回 (start_str, end_str)，格式 "%Y-%m-%d %H:%M:%S"。

    窗口起点 = 最近一个周五的 00:00:00（若当天就是周五则起点为今天 00:00）；
    窗口终点 = 当前运行时刻。
    这样「从今天到上周五」构成一个随当天滚动、最长 7 天的统计区间。
    """
    now = now or datetime.now()
    # Python weekday(): 周一=0, 周二=1, ... 周五=4, 周六=5, 周日=6
    days_since_friday = (now.weekday() - 4) % 7
    last_friday = (now - timedelta(days=days_since_friday)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    fmt = "%Y-%m-%d %H:%M:%S"
    return last_friday.strftime(fmt), now.strftime(fmt)


async def run_weekly_production_check() -> dict:
    """
    执行一次每周生产量预警检查。

    Returns:
        dict: 检查概要 {checked, reason?, window, threshold, modelsChecked,
                       alertsSent, skipped(noRecipients/disabled), details[]}
    """
    db = get_database()
    cfg_doc = await db[Collections.CONFIGS].find_one({"key": "email_alert_config"})
    enabled = (cfg_doc or {}).get("enabled", True)
    threshold = int((cfg_doc or {}).get("weeklyProductionThreshold", 50))

    if not enabled:
        log_info("邮件预警未启用，跳过每周生产量统计")
        return {"checked": False, "reason": "disabled", "emailsSent": 0, "modelsChecked": 0}

    candidates = await get_weekly_production_candidates(threshold)
    start = candidates["window"]["from"]
    end = candidates["window"]["to"]
    details = candidates["details"]
    alerts_sent = 0

    log_info(f"每周生产量预警统计开始: 窗口 {start} ~ {end}, 周生产量阈值={threshold} 台")

    for detail in details:
        model = detail["productModel"]
        input_count = detail["inputCount"]
        rty = detail["rtyRate"]
        target = detail["targetRate"]
        ctx = AlertContext(
            productModel=model,
            dateFrom=start,
            dateTo=end,
            alertType="周生产量达标但 RTY 未达标",
            severity="警告",
            title=f"{model} 周生产量 {input_count} 台，直通率 {rty}% 低于目标 {target}%",
        )
        try:
            result = await send_rty_alert_email(ctx)
            if result.get("sent"):
                alerts_sent += 1
                log_info(f"已发送周生产量预警邮件: 机型={model} RTY={rty}% 目标={target}%")
            else:
                log_warning(f"周生产量预警邮件未发送: 机型={model} reason={result.get('reason')}")
        except Exception as exc:  # 单机型发送失败不影响其他机型
            log_error(f"周生产量预警邮件发送异常: 机型={model} err={exc}")

    log_info(
        f"每周生产量预警统计完成: 窗口 {start}~{end}, "
        f"纳入判定机型={candidates['modelsChecked']}, 发送邮件={alerts_sent}"
    )
    return {**candidates, "checked": True, "alertsSent": alerts_sent}


async def get_weekly_production_candidates(threshold: int) -> dict:
    """返回达到生产量阈值且 RTY 未达标的机型，不发送邮件。"""
    db = get_database()
    start, end = compute_last_friday_window()

    # 读取机型目标直通率（未配置默认 100）
    targets_doc = await db[Collections.CONFIGS].find_one({"key": "model_targets"})
    targets_map: dict[str, float] = (targets_doc or {}).get("targets", {}) or {}

    # 按机型聚合窗口内投入 SN（去重）
    pipeline = [
        {
            "$match": {
                "actual_start_time": {"$gte": start, "$lte": end},
                "product_family": {"$nin": [None, ""]},
            }
        },
        {"$group": {"_id": "$product_family", "sns": {"$addToSet": "$sn"}}},
    ]
    cursor = db[Collections.MACHINE_INFO].aggregate(pipeline)
    rows = await cursor.to_list(length=2000)

    details: list[dict] = []
    models_checked = 0

    for row in rows:
        model = row["_id"]
        sns = [s for s in (row.get("sns") or []) if s]
        input_count = len(sns)
        target = float(targets_map.get(model, 100))

        # 投入台数未达到阈值，直接跳过判定
        if input_count < threshold:
            continue

        models_checked += 1

        # 计算窗口内该机型的 RTY
        rty = 100.0
        defect_count = 0
        if sns:
            dc_cursor = db[Collections.FAULT_INFO].aggregate(
                [
                    {"$match": {"sn": {"$in": sns}}},
                    {"$group": {"_id": "$sn"}},
                    {"$count": "c"},
                ]
            )
            dres = await dc_cursor.to_list(length=10)
            defect_count = dres[0]["c"] if dres else 0
            rty = round((input_count - defect_count) / input_count * 100, 2)

        below_target = rty < target
        if below_target:
            details.append(
                {
                    "productModel": model,
                    "inputCount": input_count,
                    "defectCount": defect_count,
                    "rtyRate": rty,
                    "targetRate": target,
                }
            )

    return {
        "window": {"from": start, "to": end},
        "threshold": threshold,
        "modelsChecked": models_checked,
        "details": details,
    }
