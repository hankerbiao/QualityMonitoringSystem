"""
告警邮件发送服务

读取邮件预警配置(email_alert_config)，实时聚合报表数据，生成含报表链接的
HTML 告警邮件，并通过邮件代理(mail_service)发出。

设计要点:
- 收件人来自 email_alert_config.emails（分号/逗号分隔），未启用或无收件人时跳过。
- attachReport 控制邮件正文是否附带故障明细表（与前端「邮件预警规则」勾选项一致）。
- 报表链接由 alert_token 签名生成，免登录即可查看完整明细。
- 纯内联样式 HTML，兼容主流邮件客户端。
"""
import html
import re
from datetime import datetime
from typing import Any

from app.core.logger import log_error, log_info, log_warning
from app.db.mongodb import get_database
from app.libs.alert_token import build_alert_report_url, create_alert_token
from app.models.documents import Collections
from app.schemas.alert_report import AlertContext, AlertReportData
from app.services.alert_report import build_alert_report
from app.services.mail_service import MailSendError, send_email

# 与 app/api/settings.py 的 EMAIL_DEFAULT 保持一致（未配置时的兜底收件人）
EMAIL_DEFAULT = "manager@company.com; quality-team@company.com"


def _parse_emails(raw: str) -> list[str]:
    """把配置里的收件人字符串(分号/逗号/空白分隔)解析为有效邮箱列表。"""
    if not raw:
        return []
    parts = re.split(r"[;；,，\s]+", raw.strip())
    return [p.strip() for p in parts if p.strip() and "@" in p]


def _severity_color(severity: str) -> tuple[str, str]:
    """返回 (文字色, 背景色) 用于严重级别徽章。"""
    s = (severity or "").strip()
    if s == "严重":
        return ("#dc2626", "#fef2f2")
    if s == "警告":
        return ("#d97706", "#fffbeb")
    if s == "提示":
        return ("#2563eb", "#eff6ff")
    return ("#475569", "#f1f5f9")


def _esc(value: Any) -> str:
    """HTML 转义，避免邮件正文注入/乱码。"""
    return html.escape("" if value is None else str(value))


def _cell(value: str) -> str:
    """单行故障明细单元格（统一内联样式）。"""
    return (
        f'<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;'
        f'font-size:13px;color:#334155;">{_esc(value)}</td>'
    )


def _defect_table_html(report: AlertReportData, more_html: str) -> str:
    """故障明细表（最多展示前 20 条，避免邮件过长）。"""
    rows_html = ""
    for d in report.defects[:20]:
        rows_html += (
            "<tr>"
            + _cell(d.sn)
            + _cell(d.defectCode)
            + _cell(d.description)
            + _cell(d.repairPerson)
            + _cell(d.repairTime)
            + "</tr>"
        )
    empty_row = (
        '<tr><td colspan="5" style="padding:14px;text-align:center;'
        'font-size:13px;color:#94a3b8;">暂无故障明细</td></tr>'
    )
    body = rows_html or empty_row
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;border-collapse:collapse;">'
        '<thead><tr style="background:#f8fafc;">'
        '<th style="padding:10px;text-align:left;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">机器 SN</th>'
        '<th style="padding:10px;text-align:left;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">故障类型</th>'
        '<th style="padding:10px;text-align:left;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">故障描述</th>'
        '<th style="padding:10px;text-align:left;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">维修人</th>'
        '<th style="padding:10px;text-align:left;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">维修时间</th>'
        "</tr></thead><tbody>"
        f"{body}"
        "</tbody></table>"
        f"{more_html}"
    )


def build_alert_email_html(
    report: AlertReportData,
    report_url: str,
    attach_report: bool = True,
) -> str:
    """构建告警邮件 HTML 正文（内联样式，兼容主流邮件客户端）。"""
    summary = report.summary
    ctx = report.context

    text_color, bg_color = _severity_color(ctx.severity)
    reached = summary.reached
    rty_color = "#16a34a" if reached else "#dc2626"
    reach_text = "达成" if reached else "未达标"

    # 触发条件 chips
    chips: list[str] = []
    if summary.productModel:
        chips.append(f"机型 · {summary.productModel}")
    if summary.base:
        chips.append(f"基地 · {summary.base}")
    if summary.customer:
        chips.append(f"客户 · {summary.customer}")
    if ctx.salesOrder:
        chips.append(f"销售订单 · {ctx.salesOrder}")
    if ctx.productionOrder:
        chips.append(f"生产订单 · {ctx.productionOrder}")
    if summary.periodFrom or summary.periodTo:
        chips.append(f"周期 · {summary.periodFrom or '—'} ~ {summary.periodTo or '—'}")
    chips_html = "".join(
        f'<span style="display:inline-block;background:#f1f5f9;color:#475569;'
        f'border:1px solid #e2e8f0;border-radius:9999px;padding:2px 10px;'
        f'font-size:12px;margin:0 6px 6px 0;">{_esc(c)}</span>'
        for c in chips
    )

    # 故障明细表（attachReport=false 时不附带，引导去报表页查看）
    if attach_report:
        defects_count = len(report.defects)
        more_html = (
            f'<p style="font-size:12px;color:#94a3b8;margin:8px 0 0;">'
            f'仅展示前 20 条，共 {defects_count} 条；完整明细请点击下方按钮查看。</p>'
            if defects_count > 20
            else ""
        )
        defects_block = _defect_table_html(report, more_html)
    else:
        defects_block = (
            '<p style="font-size:13px;color:#64748b;margin:0 0 4px;line-height:1.6;">'
            '本邮件未附带故障明细，请点击下方按钮在报表页查看完整列表。</p>'
        )

    # KPI 卡片
    def kpi(label: str, value: str, value_color: str = "#0f172a") -> str:
        return (
            '<div style="flex:1;min-width:120px;background:#f8fafc;border:1px solid #e2e8f0;'
            'border-radius:10px;padding:12px 14px;">'
            f'<div style="font-size:12px;color:#64748b;margin-bottom:4px;">{label}</div>'
            f'<div style="font-size:20px;font-weight:700;color:{value_color};">{value}</div>'
            "</div>"
        )

    kpis = "".join([
        kpi("直通率 (RTY)", f"{summary.rtyRate}%", rty_color),
        kpi("目标直通率", f"{summary.targetRate}%"),
        kpi("达成状态", reach_text, rty_color),
        kpi("故障 / 投入", f"{summary.defectCount} / {summary.inputCount}"),
    ])

    title = ctx.title or f"{summary.productModel or '未知机型'} 直通率未达标"

    return f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <!-- 头部 -->
        <tr>
          <td style="padding:18px 24px;background:#0f172a;color:#ffffff;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:16px;font-weight:700;">QualiBoard · 品质告警详情</span>
            <span style="display:inline-block;background:{bg_color};color:{text_color};border-radius:9999px;padding:4px 12px;font-size:13px;font-weight:600;">{_esc(ctx.severity or '告警')}</span>
          </td>
        </tr>
        <!-- 内容 -->
        <tr>
          <td style="padding:24px;">
            <h2 style="margin:0 0 4px;font-size:18px;color:#0f172a;">{_esc(title)}</h2>
            <p style="margin:0 0 16px;font-size:13px;color:#64748b;">告警类型：{_esc(ctx.alertType or 'RTY 未达标')}　|　生成时间：{_esc(report.generatedAt)}</p>

            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">{kpis}</div>

            <div style="margin:0 0 18px;">{chips_html}</div>

            {defects_block}

            <!-- 主按钮 -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
              <tr><td align="center">
                <a href="{_esc(report_url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;">查看完整报表</a>
              </td></tr>
            </table>

            <p style="font-size:12px;color:#94a3b8;margin:18px 0 0;line-height:1.6;">
              本邮件由 QualiBoard 品质看板自动发出，报表链接有效期为 {_esc(str(report.expiresAt) or '7 天')}。<br/>
              如非本人关注事项，请勿转发包含链接的邮件。
            </p>
          </td>
        </tr>
        <!-- 页脚 -->
        <tr>
          <td style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;">
            QualiBoard 品质看板 · 数据截至 {_esc(report.generatedAt)}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()


async def send_rty_alert_email(context: AlertContext) -> dict:
    """
    根据告警上下文发送告警邮件。

    读取 email_alert_config：
    - 未启用 / 无有效收件人 → 跳过并记录日志，返回 sent=False。
    - attachReport 控制邮件是否附带故障明细表。
    - 实时聚合报表数据并生成签名报表链接，拼入邮件正文后发出。

    Returns:
        dict: {{"sent": bool, ...}}
    """
    db = get_database()
    cfg_doc = await db[Collections.CONFIGS].find_one({"key": "email_alert_config"})

    # 与前端设置页(_email_from_doc)保持一致：文档缺失时回落到默认值
    if cfg_doc is None:
        enabled = True
        emails_raw = EMAIL_DEFAULT
        attach_report = True
    else:
        enabled = (cfg_doc or {}).get("enabled", True)
        emails_raw = (cfg_doc or {}).get("emails", "")
        attach_report = (cfg_doc or {}).get("attachReport", True)

    if not enabled:
        log_info("邮件预警未启用，跳过告警邮件发送")
        return {"sent": False, "reason": "disabled"}

    recipients = _parse_emails(emails_raw)
    if not recipients:
        log_warning("邮件预警已启用但无有效收件人，跳过发送")
        return {"sent": False, "reason": "no_recipients"}

    report = await build_alert_report(context)
    token = create_alert_token(context.model_dump(exclude_none=True))
    report_url = build_alert_report_url(token)

    title = context.title or f"{report.summary.productModel or '未知机型'} 直通率未达标"
    subject = f"【{context.severity or '告警'}】{title}"
    html_content = build_alert_email_html(report, report_url, attach_report=attach_report)

    try:
        proxy_resp = await send_email(subject=subject, html_content=html_content, to=recipients)
    except MailSendError as exc:
        log_error(f"告警邮件发送失败: {exc}")
        return {"sent": False, "reason": "send_error", "error": str(exc)}

    log_info(f"告警邮件发送成功: to={recipients} | attachReport={attach_report} | report_url={report_url}")
    return {
        "sent": True,
        "recipients": recipients,
        "subject": subject,
        "reportUrl": report_url,
        "attachReport": attach_report,
        "proxy": proxy_resp,
    }


def build_test_email_html(report_url: str | None = None, sent_at: str = "") -> str:
    """
    构建测试邮件 HTML 正文（用于验证邮件服务与收件人配置是否正常）。

    纯静态模板，不依赖数据库。展示与告警邮件一致的视觉风格，便于用户确认：
    - 邮件能正常送达配置的收件人邮箱；
    - 邮件模板样式正常渲染；
    - （可选）免登录报表链接可访问。
    """
    # 示例 KPI 卡片（明确标注"示例"，避免与真实告警混淆）
    def kpi(label: str, value: str, value_color: str = "#0f172a") -> str:
        return (
            '<div style="flex:1;min-width:120px;background:#f8fafc;border:1px solid #e2e8f0;'
            'border-radius:10px;padding:12px 14px;">'
            f'<div style="font-size:12px;color:#64748b;margin-bottom:4px;">{label}</div>'
            f'<div style="font-size:20px;font-weight:700;color:{value_color};">{value}</div>'
            "</div>"
        )

    kpis = "".join([
        kpi("直通率 (RTY) 示例", "98.2%", "#16a34a"),
        kpi("目标直通率 示例", "99.0%"),
        kpi("达成状态 示例", "未达标", "#dc2626"),
        kpi("故障 / 投入 示例", "3 / 120"),
    ])

    # 可选示例报表链接（验证免登录报表页可访问）
    btn_block = ""
    if report_url:
        btn_block = (
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">'
            "<tr><td align=\"center\">"
            f'<a href="{_esc(report_url)}" style="display:inline-block;background:#2563eb;color:#ffffff;'
            'text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;">'
            "查看示例报表</a></td></tr></table>"
        )

    sent_at_text = sent_at or datetime.now().strftime("%Y-%m-%d %H:%M")

    return f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <!-- 头部 -->
        <tr>
          <td style="padding:18px 24px;background:#0f172a;color:#ffffff;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:16px;font-weight:700;">QualiBoard · 邮件预警测试</span>
            <span style="display:inline-block;background:#eff6ff;color:#2563eb;border-radius:9999px;padding:4px 12px;font-size:13px;font-weight:600;">测试</span>
          </td>
        </tr>
        <!-- 内容 -->
        <tr>
          <td style="padding:24px;">
            <h2 style="margin:0 0 4px;font-size:18px;color:#0f172a;">这是一封测试邮件</h2>
            <p style="margin:0 0 16px;font-size:13px;color:#64748b;">发送时间：{_esc(sent_at_text)}</p>

            <p style="font-size:14px;color:#334155;line-height:1.7;margin:0 0 16px;">
              如果您收到此邮件，说明 <strong>QualiBoard 邮件预警服务已正确配置</strong>，且下方收件人邮箱地址有效。
              当某机型实际直通率 (RTY) 低于目标值时，系统将自动向该邮箱发送与下方模板风格一致的告警邮件。
            </p>

            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;">{kpis}</div>
            <p style="font-size:12px;color:#94a3b8;margin:6px 0 0;">* 以上为示例数据，仅用于展示邮件模板样式。</p>

            {btn_block}

            <p style="font-size:12px;color:#94a3b8;margin:18px 0 0;line-height:1.6;">
              本邮件由 QualiBoard 品质看板自动发出，用于验证邮件预警配置。<br/>
              如非本人操作，请忽略本邮件。
            </p>
          </td>
        </tr>
        <!-- 页脚 -->
        <tr>
          <td style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;">
            QualiBoard 品质看板 · 邮件预警配置测试
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
""".strip()


async def send_test_email(emails: str) -> dict:
    """
    向配置的收件人发送一封测试邮件，验证邮件服务与收件人配置。

    与告警邮件不同，测试邮件不依赖数据库聚合，也不受 email_alert_config.enabled
    开关限制（用户主动触发验证）。无有效收件人时跳过并记录日志。

    Args:
        emails: 收件人字符串（分号/逗号分隔），与前端表单一致。

    Returns:
        dict: {"sent": bool, ...}
    """
    recipients = _parse_emails(emails)
    if not recipients:
        log_warning("测试邮件无有效收件人，跳过发送")
        return {"sent": False, "reason": "no_recipients"}

    # 生成示例报表链接，便于用户在测试邮件中验证免登录报表页可访问
    sample_ctx = AlertContext(
        productModel="示例机型",
        base="示例基地",
        severity="提示",
        alertType="邮件预警测试示例",
    )
    token = create_alert_token(sample_ctx.model_dump(exclude_none=True))
    report_url = build_alert_report_url(token)

    sent_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    subject = "【测试】QualiBoard 邮件预警配置验证"
    html_content = build_test_email_html(report_url=report_url, sent_at=sent_at)

    try:
        proxy_resp = await send_email(subject=subject, html_content=html_content, to=recipients)
    except MailSendError as exc:
        log_error(f"测试邮件发送失败: {exc}")
        return {"sent": False, "reason": "send_error", "error": str(exc)}

    log_info(f"测试邮件发送成功: to={recipients} | report_url={report_url}")
    return {
        "sent": True,
        "recipients": recipients,
        "subject": subject,
        "reportUrl": report_url,
        "proxy": proxy_resp,
    }
