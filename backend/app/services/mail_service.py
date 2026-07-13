"""
邮件发送服务

通过中间件代理发送 HTML 邮件。代理地址由配置 MAIL_PROXY_URL 指定（默认
http://10.32.129.1/springboard_v3/mail_proxy/buqualiboard）。

请求体 JSON 结构:
{
  "subject": "xxx",
  "html_content": "xxx",
  "to": ["libiao1@sugon.com"],
  "bcc": [],
  "reply_to": []
}
"""
import httpx

from app.core.config import get_settings
from app.core.logger import log_error, log_info

# 邮件代理地址（中间件），默认取自配置
MAIL_PROXY_URL = get_settings().MAIL_PROXY_URL


class MailSendError(Exception):
    """邮件发送失败异常"""


async def send_email(
    subject: str,
    html_content: str,
    to: list[str],
    bcc: list[str] | None = None,
    reply_to: list[str] | None = None,
    timeout: float = 10.0,
) -> dict:
    """
    通过邮件代理发送一封 HTML 邮件。

    Args:
        subject: 邮件主题
        html_content: HTML 正文
        to: 收件人邮箱列表（至少 1 个）
        bcc: 密送列表（可选）
        reply_to: 回复地址列表（可选）
        timeout: 请求超时时间（秒）

    Returns:
        代理返回的响应 JSON（dict）

    Raises:
        MailSendError: 代理返回非 2xx 或网络异常
    """
    if not to:
        raise MailSendError("收件人列表不能为空")

    payload = {
        "subject": subject,
        "html_content": html_content,
        "to": to,
        "bcc": bcc or [],
        "reply_to": reply_to or [],
    }

    mail_url = get_settings().MAIL_PROXY_URL

    # 关键日志记录：记录发出的邮件代理请求地址
    log_info(f"post {mail_url}")

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(mail_url, json=payload)
    except httpx.HTTPError as exc:
        log_error(f"邮件代理请求异常: {mail_url} | {exc}")
        raise MailSendError(f"邮件代理请求异常: {exc}") from exc

    if resp.status_code >= 300:
        log_error(
            f"邮件代理返回错误: {mail_url} | "
            f"status={resp.status_code} | body={resp.text[:500]}"
        )
        raise MailSendError(f"邮件代理返回 {resp.status_code}: {resp.text[:300]}")

    log_info(f"邮件代理已接收请求: {mail_url} | status={resp.status_code}")
    try:
        return resp.json()
    except Exception:
        return {"status": resp.status_code, "body": resp.text[:500]}
