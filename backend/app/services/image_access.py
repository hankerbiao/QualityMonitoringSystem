"""Short-lived image grants bind an upstream path to its authorized base."""

import base64
import hashlib
import hmac
import json
import time

from fastapi import HTTPException

from app.base_access import base_allowed, canonical_base
from app.core.config import get_settings


def image_grant(source: str, path: str, base: str) -> str:
    payload = json.dumps(
        [source, path, canonical_base(base), int(time.time()) + 3600],
        ensure_ascii=True,
        separators=(",", ":"),
    ).encode()
    body = base64.urlsafe_b64encode(payload).rstrip(b"=").decode()
    signature = hmac.new(
        get_settings().JWT_SECRET.encode(), f"image:{body}".encode(), hashlib.sha256
    ).hexdigest()
    return f"{body}.{signature}"


def require_image_grant(token: str, source: str, path: str) -> None:
    try:
        body, signature = token.split(".")
        expected = hmac.new(
            get_settings().JWT_SECRET.encode(), f"image:{body}".encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError
        granted_source, granted_path, base, expires = json.loads(
            base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
        )
        if (
            granted_source != source
            or granted_path != path
            or expires <= time.time()
            or not base_allowed(base)
        ):
            raise ValueError
    except (ValueError, TypeError, UnicodeError):
        raise HTTPException(
            status_code=403, detail="图片访问权限无效或已过期，请重新查询"
        ) from None
