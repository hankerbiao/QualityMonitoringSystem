"""
告警报表公开 API（免登录）

- GET /api/alert-report/{token}: 校验签名 token，实时聚合返回告警上下文 + 故障明细。
- POST /api/alert-report/preview: (已登录 + DEBUG) 生成报表签名链接，供测试 / 邮件发送调用。
- POST /api/alert-report/notify: (已登录) 根据告警上下文发送含报表链接的告警邮件。
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.api.auth import get_current_user
from app.core.config import get_settings
from app.core.logger import log_info
from app.libs.alert_token import build_alert_report_url, create_alert_token, verify_alert_token
from app.schemas.alert_report import AlertContext, AlertReportData
from app.schemas.common import Response
from app.services.alert_mail import send_rty_alert_email, send_test_email
from app.services.alert_report import build_alert_report

router = APIRouter()


class PreviewRequest(BaseModel):
    context: AlertContext
    ttlDays: int | None = None
    baseUrl: str | None = None


@router.get("/{token}", response_model=Response[AlertReportData])
async def get_alert_report(token: str, request: Request):
    """公开只读报表：校验签名 token，实时聚合返回数据。"""
    try:
        payload = verify_alert_token(token)
    except ValueError as e:
        return Response(success=False, error=str(e), message="链接无效或已过期")

    try:
        ctx = AlertContext(**payload.get("ctx", {}))
        data = await build_alert_report(ctx)
    except Exception as e:
        log_info(f"告警报表生成失败: {e}")
        return Response(success=False, error="报表生成失败", message=str(e))

    exp = payload.get("exp")
    if isinstance(exp, int):
        data.expiresAt = datetime.fromtimestamp(exp, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")

    return Response(success=True, data=data, message="ok")


@router.post("/preview", response_model=Response[dict])
async def preview_alert_link(
    body: PreviewRequest,
    current_user: dict = Depends(get_current_user),  # noqa: B008
):
    """(已登录 + DEBUG) 生成报表签名链接，用于本地预览或邮件发送时调用。"""
    settings = get_settings()
    if not settings.DEBUG:
        return Response(success=False, error="仅 DEBUG 模式可用")

    token = create_alert_token(body.context.model_dump(exclude_none=True), ttl_days=body.ttlDays)
    url = build_alert_report_url(token, base_url=body.baseUrl)
    return Response(success=True, data={"token": token, "url": url}, message="ok")


@router.post("/notify", response_model=Response[dict])
async def notify_alert_email(
    context: AlertContext,
    current_user: dict = Depends(get_current_user),  # noqa: B008
):
    """发送告警邮件：读取 email_alert_config，实时聚合报表并附带免登录报表链接。"""
    result = await send_rty_alert_email(context)
    return Response(
        success=result.get("sent", False),
        message="已尝试发送告警邮件",
        data=result,
    )


class TestEmailRequest(BaseModel):
    emails: str = ""


@router.post("/test", response_model=Response[dict])
async def test_alert_email(
    body: TestEmailRequest,
    current_user: dict = Depends(get_current_user),  # noqa: B008
):
    """发送测试邮件：向指定收件人(配置字符串)发送一封测试邮件，验证邮件服务与收件人配置。"""
    result = await send_test_email(body.emails)
    return Response(
        success=result.get("sent", False),
        message="已尝试发送测试邮件",
        data=result,
    )
