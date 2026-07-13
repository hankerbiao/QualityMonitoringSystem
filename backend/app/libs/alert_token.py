"""
告警报表签名 Token 工具

用途: 邮件告警链接使用免登录的签名 URL。后端校验签名 + 有效期后，
      实时聚合返回只读的告警上下文与故障明细，避免直接暴露数据库查询接口。

实现: HMAC-SHA256 (Python 标准库)，无第三方依赖。
      token 结构: <base64url(payload)>,<base64url(hmac)>
      payload: {"ctx": <告警上下文>, "iat": <签发时间>, "exp": <过期时间>}
"""
import base64
import hashlib
import hmac
import json
import time
from typing import Any

from app.core.config import get_settings


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def _sign(payload_b64: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    return _b64url_encode(digest)


def create_alert_token(context: dict[str, Any], ttl_days: int | None = None) -> str:
    """生成一个免登录的签名 token。context 为告警上下文(过滤条件 + 元信息)。"""
    settings = get_settings()
    ttl = ttl_days if ttl_days is not None else settings.ALERT_TOKEN_TTL_DAYS
    issued_at = int(time.time())
    expires_at = issued_at + ttl * 86400
    payload = {
        "ctx": context,
        "iat": issued_at,
        "exp": expires_at,
    }
    payload_b64 = _b64url_encode(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    sig = _sign(payload_b64, settings.ALERT_TOKEN_SECRET)
    return f"{payload_b64}.{sig}"


def verify_alert_token(token: str) -> dict[str, Any]:
    """
    校验签名与有效期，返回完整 payload dict（含 ctx / iat / exp）。
    失败抛 ValueError（调用方据此返回 '链接无效或已过期'）。
    """
    settings = get_settings()
    if not token or "." not in token:
        raise ValueError("链接格式不正确")
    payload_b64, sig = token.rsplit(".", 1)
    expected = _sign(payload_b64, settings.ALERT_TOKEN_SECRET)
    if not hmac.compare_digest(expected, sig):
        raise ValueError("签名校验失败")
    try:
        raw = _b64url_decode(payload_b64)
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        raise ValueError("链接解析失败")
    exp = payload.get("exp")
    if not isinstance(exp, int) or exp < int(time.time()):
        raise ValueError("链接已过期")
    if not isinstance(payload.get("ctx"), dict):
        raise ValueError("链接缺少上下文")
    return payload


def build_alert_report_url(token: str, base_url: str | None = None) -> str:
    """拼接前端可访问的报表链接（如 https://host/alert-report/{token}）。"""
    settings = get_settings()
    base = (base_url or settings.APP_PUBLIC_BASE_URL).rstrip("/")
    return f"{base}/alert-report/{token}"
