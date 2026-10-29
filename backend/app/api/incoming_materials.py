"""Incoming-material exceptions dashboard API."""

from datetime import date
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import Response as FastAPIResponse

from app.auth_permissions import dashboard_dependency
from app.db.mongodb import get_database
from app.schemas.common import Response
from app.services.credential_crypto import CredentialEncryptionError
from app.services.image_access import require_image_grant
from app.services.incoming_materials import (
    IMAGE_SOURCE,
    REPORT_SOURCE,
    incoming_image_path,
    query_incoming_materials,
)
from app.services.process_record_service import (
    CredentialsNotConfiguredError,
    process_record_gateway,
)
from app.services.settings_service import SettingsService


async def require_incoming_access(
    user: Annotated[dict, Depends(dashboard_dependency("incoming-materials"))],
):
    if user.get("role") != "admin":
        statuses = await SettingsService(get_database()).get_dashboard_statuses()
        if statuses["incoming-materials"] == "admin-only":
            raise HTTPException(status_code=403, detail="来料异常看板仅管理员可见")
    return user


router = APIRouter(dependencies=[Depends(require_incoming_access)])


@router.get("/realtime")
async def realtime(
    keyword: str = Query("", max_length=200), base: str = Query("", max_length=40),
    bases: Annotated[list[str] | None, Query(max_length=20)] = None,
    material: str = Query("", max_length=200), supplier: str = Query("", max_length=200),
    order: str = Query("", max_length=200), lot: str = Query("", max_length=200),
    category: str = Query("", max_length=200), date_from: date | None = None,
    date_to: date | None = None,
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=400, detail="到货开始日期不能晚于结束日期")
    try:
        return Response(success=True, data=await query_incoming_materials(
            keyword.strip(), base=base.strip(), bases=[value.strip() for value in bases or []],
            material=material.strip(), supplier=supplier.strip(),
            order=order.strip(), lot=lot.strip(), category=category.strip(),
            date_from=date_from, date_to=date_to,
        ))
    except (CredentialsNotConfiguredError, CredentialEncryptionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"来料异常查询失败：{exc}") from exc


@router.get("/image")
async def image(path: str = Query(..., min_length=1, max_length=1000), accessToken: str = Query("", max_length=6000)):
    try:
        normalized = incoming_image_path(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    require_image_grant(accessToken, IMAGE_SOURCE, normalized)
    try:
        content, content_type = await process_record_gateway.fetch_image("system1", normalized)
    except (CredentialsNotConfiguredError, CredentialEncryptionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="图片加载失败，请刷新后重试") from exc
    media_type = content_type.split(";", 1)[0].strip().lower()
    if media_type not in {"image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"}:
        raise HTTPException(status_code=502, detail="上游返回的图片格式无效")
    return FastAPIResponse(content=content, media_type=media_type, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/report")
async def report(path: str = Query(..., min_length=1, max_length=1000), accessToken: str = Query("", max_length=6000)):
    try:
        normalized = incoming_image_path(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    require_image_grant(accessToken, REPORT_SOURCE, normalized)
    try:
        content, content_type = await process_record_gateway.fetch_image("system1", normalized)
    except (CredentialsNotConfiguredError, CredentialEncryptionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="报告下载失败，请刷新后重试") from exc
    if content_type.split(";", 1)[0].strip().lower() in {"text/html", "application/json"}:
        raise HTTPException(status_code=502, detail="上游未返回报告文件")
    filename = quote(normalized.rsplit("/", 1)[-1], safe="")
    return FastAPIResponse(content=content, media_type="application/octet-stream", headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{filename}",
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    })
