"""
邮件发送服务

通过统一邮件服务发送 HTML 邮件。地址和 Bearer Token 由配置提供。

请求体 JSON 结构:
{
  "to": ["libiao1@sugon.com"],
  "cc": [],
  "subject": "xxx",
  "content": "xxx",
  "contentType": "text/html; charset=utf-8"
}
"""
import httpx

from app.core.config import get_settings
from app.core.logger import log_error, log_info


class MailSendError(Exception):
    """邮件发送失败异常"""


async def send_email(
    subject: str,
    html_content: str,
    to: list[str],
    cc: list[str] | None = None,
    timeout: float = 10.0,
) -> dict:
    """
    通过邮件代理发送一封 HTML 邮件。

    Args:
        subject: 邮件主题
        html_content: HTML 正文
        to: 收件人邮箱列表（至少 1 个）
        cc: 抄送列表（可选）
        timeout: 请求超时时间（秒）

    Returns:
        代理返回的响应 JSON（dict）

    Raises:
        MailSendError: 代理返回非 2xx 或网络异常
    """
    if not to:
        raise MailSendError("收件人列表不能为空")

    settings = get_settings()
    mail_url = settings.MAIL_PROXY_URL
    mail_token = settings.MAIL_PROXY_TOKEN.strip()
    if not mail_token:
        raise MailSendError("邮件服务 Token 未配置")

    payload = {
        "to": to,
        "cc": cc or [],
        "subject": subject,
        "content": html_content,
        "contentType": "text/html; charset=utf-8",
    }
    headers = {
        "Authorization": f"Bearer {mail_token}",
        "Content-Type": "application/json",
    }

    # 关键日志记录：记录发出的邮件代理请求地址
    log_info(f"post {mail_url}")

    try:
        # The backend is deployed with runtime proxy variables disabled. Keep
        # this explicit so mail requests cannot accidentally inherit a proxy.
        async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
            resp = await client.post(mail_url, headers=headers, json=payload)
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
