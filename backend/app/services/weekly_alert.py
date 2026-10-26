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

import asyncio
from datetime import datetime, timedelta
from typing import Any

from app.core.logger import log_error, log_info, log_warning
from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.alert_report import AlertContext
from app.schemas.settings import DEFAULT_WEEKLY_PRODUCTION_THRESHOLD
from app.services.alert_mail import send_rty_alert_email
from app.services.rty_gateway import _fault_sns_by_orders, _num, _orders
from app.services.rty_shared import normalize_order


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


async def run_weekly_production_check(
    config_override: dict[str, Any] | None = None,
) -> dict:
    """
    执行一次每周生产量预警检查。

    Returns:
        dict: 检查概要 {checked, reason?, window, threshold, modelsChecked,
                       alertsSent, skipped(noRecipients/disabled), details[]}
    """
    db = get_database()
    cfg_doc = config_override
    if cfg_doc is None:
        cfg_doc = await db[Collections.CONFIGS].find_one({"key": "email_alert_config"})
    enabled = (cfg_doc or {}).get("enabled", True)
    threshold = int(
        (cfg_doc or {}).get(
            "weeklyProductionThreshold", DEFAULT_WEEKLY_PRODUCTION_THRESHOLD
        )
    )

    if not enabled:
        log_info("邮件预警未启用，跳过每周生产量统计")
        return {
            "checked": False,
            "reason": "disabled",
            "alertsSent": 0,
            "alertsFailed": 0,
            "failures": [],
            "modelsChecked": 0,
        }

    targets = (cfg_doc or {}).get("modelTargets")
    candidates = await get_weekly_production_candidates(threshold, targets=targets)
    start = candidates["window"]["from"]
    end = candidates["window"]["to"]
    details = candidates["details"]
    alerts_sent = 0
    alerts_failed = 0
    failures: list[dict[str, str]] = []

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
            result = await send_rty_alert_email(ctx, config_override=cfg_doc)
            if result.get("sent"):
                alerts_sent += 1
                log_info(f"已发送周生产量预警邮件: 机型={model} RTY={rty}% 目标={target}%")
            else:
                alerts_failed += 1
                failures.append(
                    {
                        "productModel": model,
                        "reason": str(result.get("reason") or "send_failed"),
                        "error": str(result.get("error") or ""),
                    }
                )
                log_warning(f"周生产量预警邮件未发送: 机型={model} reason={result.get('reason')}")
        except Exception as exc:  # 单机型发送失败不影响其他机型
            alerts_failed += 1
            failures.append(
                {
                    "productModel": model,
                    "reason": "send_error",
                    "error": str(exc),
                }
            )
            log_error(f"周生产量预警邮件发送异常: 机型={model} err={exc}")

    log_info(
        f"每周生产量预警统计完成: 窗口 {start}~{end}, "
        f"纳入判定机型={candidates['modelsChecked']}, 发送邮件={alerts_sent}"
    )
    return {
        **candidates,
        "checked": True,
        "alertsSent": alerts_sent,
        "alertsFailed": alerts_failed,
        "failures": failures,
    }


async def get_weekly_production_candidates(
    threshold: int,
    *,
    targets: dict[str, float] | None = None,
) -> dict:
    """返回达到生产量阈值且 RTY 未达标的机型，不发送邮件。"""
    db = get_database()
    start, end = compute_last_friday_window()

    if targets is None:
        targets_doc = await db[Collections.CONFIGS].find_one({"key": "model_targets"})
        targets_map: dict[str, float] = (targets_doc or {}).get("targets", {}) or {}
    else:
        targets_map = targets

    # Use the same gateway normalization and order eligibility as the RTY dashboard.
    orders = await _orders({"dateFrom": start[:10], "dateTo": end[:10]})
    model_groups: dict[str, dict[str, Any]] = {}
    for order in orders:
        data = order["data"]
        model = str(data.get("MAKTX_TH") or "").strip()
        if not model:
            continue
        group = model_groups.setdefault(model, {"input": 0.0, "orders": set()})
        group["input"] += _num(data.get("WMENG"))
        group["orders"].add(order["aufnr"])

    candidates = [
        (model, group)
        for model, group in model_groups.items()
        if group["input"] >= threshold
    ]
    fault_maps = await asyncio.gather(
        *(
            _fault_sns_by_orders(group["orders"], model=model)
            for model, group in candidates
        )
    )

    details: list[dict] = []
    for (model, group), faults in zip(candidates, fault_maps, strict=True):
        input_count = group["input"]
        defect_sns = set().union(
            *(
                faults.get(normalize_order(order), set())
                for order in group["orders"]
            )
        )
        defect_count = len(defect_sns)
        target = float(targets_map.get(model, 100))
        rty = round((input_count - defect_count) / input_count * 100, 2) if input_count else 100.0
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
        "modelsChecked": len(candidates),
        "details": details,
    }
