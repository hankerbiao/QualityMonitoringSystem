"""FA application dashboard and submission workflow."""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pymongo import ReturnDocument

from app.api.auth import get_current_user
from app.auth_permissions import dashboard_dependency
from app.core.logger import audit_log
from app.db.mongodb import get_database
from app.schemas.fa_applications import (
    FAApplicationListResponse,
    FAPreviewRequest,
    FASubmitRequest,
)
from app.services.fa_application_service import (
    build_preview,
    deliver_application_email,
    normalize_recipients,
)
from app.services.mail_service import MailSendError
from app.services.oa_user_directory import list_employees, search_employees

router = APIRouter(dependencies=[Depends(dashboard_dependency("fa"))])


@router.get("/employees")
async def employees(q: str | None = Query(default=None, min_length=2, max_length=100)):
    try:
        return {"items": await (search_employees(q) if q else list_employees())}
    except Exception as exc:
        raise HTTPException(status_code=502, detail="员工通讯录查询失败，请稍后重试") from exc


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public(doc: dict) -> dict:
    result = dict(doc)
    result.pop("_id", None)
    return result


@router.post("/preview")
@audit_log("QUERY", "fa_preview")
async def preview(payload: FAPreviewRequest):
    return await build_preview(payload)


@router.post("/applications", status_code=status.HTTP_201_CREATED)
@audit_log("CREATE", "fa_application")
async def submit_application(
    payload: FASubmitRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
):
    application = payload.application
    preview_data = await build_preview(application)
    if not application.selectedRepairIds and not application.selectedDoaIds:
        raise HTTPException(status_code=422, detail="至少选择一条故障明细")
    selected_repairs = {str(item.get("sourceId")) for item in preview_data["repairFaults"]}
    selected_doa = {str(item.get("sourceId")) for item in preview_data["doaChanges"]}
    if application.selectedRepairIds and not set(application.selectedRepairIds) <= selected_repairs:
        raise HTTPException(status_code=422, detail="产测故障明细选择已过期，请重新查询")
    if application.selectedDoaIds and not set(application.selectedDoaIds) <= selected_doa:
        raise HTTPException(status_code=422, detail="DOA 明细选择已过期，请重新查询")

    selected_repair_rows = [
        row for row in preview_data["repairFaults"] if row["sourceId"] in application.selectedRepairIds
    ]
    selected_doa_rows = [
        row for row in preview_data["doaChanges"] if row["sourceId"] in application.selectedDoaIds
    ]
    application_info = {
        "物料号 PN": application.pn,
        "厂商": application.vendor,
        "物料描述": preview_data["materialDescription"],
        "故障现象": application.faultDescription,
        "发生环节": "、".join(application.stages),
    }
    if "产测" in application.stages:
        application_info["产测计划开始时间"] = f"{application.repairDateFrom} 至 {application.repairDateTo}"
    if "DOA" in application.stages:
        application_info["DOA 操作时间"] = f"{application.doaDateFrom} 至 {application.doaDateTo}"
    try:
        to_addresses = normalize_recipients(payload.email.to, label="收件人")
        cc_addresses = normalize_recipients(payload.email.cc, label="抄送人")
        to_keys = {address.casefold() for address in to_addresses}
        cc_addresses = [address for address in cc_addresses if address.casefold() not in to_keys]
        delivery_result = await deliver_application_email(
            to=to_addresses,
            cc=cc_addresses,
            subject=payload.email.subject,
            content=payload.email.content,
            application=application_info,
            repair_faults=selected_repair_rows,
            doa_changes=selected_doa_rows,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except MailSendError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"邮件发送失败，申请单未保存：{exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="邮件发送失败，申请单未保存") from exc

    db = get_database()
    sequence = await db.fa_application_counters.find_one_and_update(
        {"_id": "fa"}, {"$inc": {"value": 1}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    next_value = int((sequence or {}).get("value") or 1)
    application_id = f"FA-{datetime.now().strftime('%Y%m%d')}-{next_value:06d}"
    now = _now()
    doc = {
        "applicationId": application_id,
        "pn": application.pn,
        "vendor": application.vendor,
        "faultDescription": application.faultDescription,
        "materialDescription": preview_data["materialDescription"],
        "stages": application.stages,
        "repairDateFrom": application.repairDateFrom.isoformat() if application.repairDateFrom else None,
        "repairDateTo": application.repairDateTo.isoformat() if application.repairDateTo else None,
        "doaDateFrom": application.doaDateFrom.isoformat() if application.doaDateFrom else None,
        "doaDateTo": application.doaDateTo.isoformat() if application.doaDateTo else None,
        "repairSummary": preview_data["repair"],
        "doaSummary": preview_data["doa"],
        "repairFaults": selected_repair_rows,
        "doaChanges": selected_doa_rows,
        "createdBy": current_user.get("username") or current_user.get("itcode", ""),
        "createdByName": current_user.get("name") or current_user.get("姓名") or "",
        "createdAt": now,
        "email": {
            "status": "sent",
            "to": to_addresses,
            "cc": cc_addresses,
            "subject": payload.email.subject,
            "content": payload.email.content,
            "sentAt": now,
            "sentBy": current_user.get("username") or current_user.get("itcode", ""),
            "error": None,
            "proxyResponse": delivery_result,
        },
    }
    await db.fa_applications.insert_one(doc)
    return _public(doc)


@router.get("/applications", response_model=FAApplicationListResponse)
async def list_applications(
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
):
    db = get_database()
    sent_filter = {"email.status": "sent"}
    total = await db.fa_applications.count_documents(sent_filter)
    docs = await (
        db.fa_applications.find(sent_filter)
        .sort("createdAt", -1)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .to_list(length=pageSize)
    )
    return FAApplicationListResponse(
        items=[_public(doc) for doc in docs], total=total, page=page, pageSize=pageSize
    )
