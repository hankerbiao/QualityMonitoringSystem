"""
系统配置 API 路由

包括:
- 机型指标配置
- 邮件预警规则配置

说明:
- GET 接口一律不返回明文密码；密码以 hasPassword 标志表示。
- PUT 接口对可选字段使用 Pydantic 的 model_dump(exclude_none=True) 自动生成 $set，
  避免逐字段 `if x is not None` 的重复样板。
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth import require_admin
from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.common import Response
from app.schemas.process_records import ProcessRecordConnectionTest
from app.schemas.settings import (
    CycleStatsConfig,
    EmailAlertConfig,
    EmailAlertConfigUpdate,
    ModelTargetsResponse,
    ProcessRecordConfig,
    ProcessRecordConfigUpdate,
    SettingsResponse,
    SettingsUpdateRequest,
)
from app.services.credential_crypto import (
    CredentialEncryptionError,
    decrypt_credential,
    encrypt_credential,
)
from app.services.process_record_service import process_record_gateway
from app.services.settings_service import SettingsService
from app.services.weekly_alert import get_weekly_production_candidates, run_weekly_production_check

router = APIRouter(dependencies=[Depends(require_admin)])

CONFIGS = Collections.CONFIGS


def _service() -> SettingsService:
    return SettingsService(get_database())


# ============== 通用助手 ==============


async def _read_doc(key: str) -> dict | None:
    """读取单个配置文档"""
    return await _service().read_doc(key)


async def _save_section(key: str, update: object) -> dict:
    """
    将 Pydantic 更新模型（已设字段）写入对应配置文档并返回最新文档。

    - 仅写入非 None 字段（exclude_none=True），消除重复的 if 判断。
    - 空字典视为无字段可更新，返回 400。
    """
    data = update.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    return await _service().save_section(key, update)


def _process_records_from_doc(doc: dict | None) -> ProcessRecordConfig:
    return SettingsService.process_records_from_doc(doc)


def _email_from_doc(doc: dict | None) -> EmailAlertConfig:
    return SettingsService.email_from_doc(doc)


# ============== 统一设置接口 ==============


@router.get("", response_model=Response[SettingsResponse])
async def get_all_settings():
    """获取所有系统配置"""
    return Response(success=True, data=await _service().get_all())


@router.put("", response_model=Response[SettingsResponse])
async def update_all_settings(request: SettingsUpdateRequest):
    """批量更新系统配置"""
    try:
        data = await _service().update_all(request)
    except CredentialEncryptionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if request.processRecords is not None:
        await process_record_gateway.invalidate_clients()
    return Response(success=True, data=data)


# ============== 关键工位影像追溯配置接口 ==============


@router.get("/process-records", response_model=Response[ProcessRecordConfig])
async def get_process_record_config():
    """读取两个实时影像数据源共用的凭据状态。"""
    doc = await _read_doc("process_record_config")
    return Response(success=True, data=_process_records_from_doc(doc))


@router.put("/process-records", response_model=Response[ProcessRecordConfig])
async def update_process_record_config(config: ProcessRecordConfigUpdate):
    """更新共享凭据；空密码表示保留当前值。"""
    data = config.model_dump(exclude_none=True)
    password = data.pop("password", None)
    if password:
        try:
            data["passwordCiphertext"] = encrypt_credential(password)
        except CredentialEncryptionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    data["updatedAt"] = datetime.now(timezone.utc)
    await get_database()[CONFIGS].update_one(
        {"key": "process_record_config"}, {"$set": data}, upsert=True
    )
    await process_record_gateway.invalidate_clients()
    doc = await _read_doc("process_record_config")
    return Response(
        success=True,
        data=_process_records_from_doc(doc),
        message="关键工位影像追溯凭据已更新",
    )


@router.post(
    "/process-records/test",
    response_model=Response[ProcessRecordConnectionTest],
)
async def test_process_record_config(config: ProcessRecordConfigUpdate | None = None):
    """并行测试两个系统；可测试尚未保存的新账号密码。"""
    stored = await _read_doc("process_record_config") or {}
    username = ((config.username if config else None) or stored.get("username") or "").strip()
    password = config.password if config else None
    if not password and stored.get("passwordCiphertext"):
        try:
            password = decrypt_credential(stored["passwordCiphertext"])
        except CredentialEncryptionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not username or not password:
        raise HTTPException(status_code=400, detail="请先填写账号和密码")
    result = await process_record_gateway.test_credentials(username, password)
    return Response(
        success=result.success,
        data=result,
        message="两个数据源均连接成功" if result.success else "部分数据源连接失败",
    )


# ============== 机型指标接口 ==============


@router.get("/model-targets", response_model=Response[ModelTargetsResponse])
async def get_model_targets():
    """获取所有机型的目标直通率配置"""
    doc = await _read_doc("model_targets")
    return Response(
        success=True, data=ModelTargetsResponse(items=doc.get("targets", {}) if doc else {})
    )


@router.put("/model-targets", response_model=Response[ModelTargetsResponse])
async def update_model_targets(targets: dict[str, float]):
    """批量更新机型目标直通率"""
    for model, rate in targets.items():
        if not isinstance(model, str) or not model.strip():
            raise HTTPException(status_code=400, detail=f"Invalid model name: {model}")
        if not isinstance(rate, int | float) or rate < 0 or rate > 100:
            raise HTTPException(status_code=400, detail=f"Invalid target rate for {model}: {rate}")

    await get_database()[CONFIGS].update_one(
        {"key": "model_targets"},
        {"$set": {"targets": targets, "updatedAt": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return Response(
        success=True, data=ModelTargetsResponse(items=targets), message="机型指标配置已更新"
    )


@router.post("/model-targets/{model}", response_model=Response[ModelTargetsResponse])
async def add_model_target(model: str, targetRate: float):
    """添加或更新单个机型的目标直通率"""
    doc = await _read_doc("model_targets")
    targets: dict[str, float] = doc.get("targets", {}).copy() if doc else {}
    targets[model] = targetRate
    await get_database()[CONFIGS].update_one(
        {"key": "model_targets"},
        {"$set": {"targets": targets, "updatedAt": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return Response(
        success=True,
        data=ModelTargetsResponse(items=targets),
        message=f"机型 {model} 的目标直通率已设置为 {targetRate}%",
    )


@router.delete("/model-targets/{model}", response_model=Response[ModelTargetsResponse])
async def delete_model_target(model: str):
    """删除指定机型的目标直通率配置"""
    doc = await _read_doc("model_targets")
    targets: dict[str, float] = doc.get("targets", {}).copy() if doc else {}
    if model not in targets:
        raise HTTPException(status_code=404, detail=f"机型 {model} 不存在")
    del targets[model]
    await get_database()[CONFIGS].update_one(
        {"key": "model_targets"},
        {"$set": {"targets": targets, "updatedAt": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return Response(
        success=True, data=ModelTargetsResponse(items=targets), message=f"机型 {model} 的配置已删除"
    )


# ============== 邮件预警配置接口 ==============


@router.get("/email-alert", response_model=Response[EmailAlertConfig])
async def get_email_alert_config():
    """获取邮件预警配置"""
    return Response(success=True, data=_email_from_doc(await _read_doc("email_alert_config")))


@router.put("/email-alert", response_model=Response[EmailAlertConfig])
async def update_email_alert_config(config: EmailAlertConfigUpdate):
    """更新邮件预警配置"""
    if config.emails is not None:
        emails = [e.strip() for e in config.emails.split(";") if e.strip()]
        for email in emails:
            if "@" not in email:
                raise HTTPException(status_code=400, detail=f"Invalid email format: {email}")
        config.emails = "; ".join(emails)
    doc = await _save_section("email_alert_config", config)
    return Response(success=True, data=_email_from_doc(doc), message="邮件预警配置已更新")


@router.post("/email-alert/run-weekly-check", response_model=Response[dict])
async def run_weekly_check():
    """
    手动触发「每周生产量预警检查」。

    与每天 17:00 的定时任务逻辑一致：统计上周五~今天窗口内各机型投入台数，
    对达到周生产量阈值且 RTY 低于目标直通率的机型发送告警邮件。
    主要用于验证配置与邮件链路，无需等待定时触发。
    """
    result = await run_weekly_production_check()
    return Response(success=True, data=result, message="每周生产量预警检查已执行")


@router.get("/email-alert/qualified-models", response_model=Response[dict])
async def get_qualified_models(threshold: int = Query(..., ge=0)):
    """查询达到生产量阈值且 RTY 未达标的机型，不触发邮件发送。"""
    result = await get_weekly_production_candidates(threshold)
    return Response(success=True, data=result, message="符合条件的机型已获取")


# ============== 周期统计看板配置接口 ==============


@router.get("/cycle-stats-config", response_model=Response[CycleStatsConfig])
async def get_cycle_stats_config():
    """获取周期统计看板配置"""
    doc = await _read_doc("cycle_stats_config")
    data = CycleStatsConfig(selectedModels=(doc or {}).get("selectedModels", []))
    return Response(success=True, data=data)


@router.put("/cycle-stats-config", response_model=Response[CycleStatsConfig])
async def update_cycle_stats_config(config: CycleStatsConfig):
    """保存周期统计看板配置"""
    db = get_database()
    now = datetime.now(timezone.utc)
    await db[Collections.CONFIGS].update_one(
        {"key": "cycle_stats_config"},
        {"$set": {"selectedModels": config.selectedModels, "updatedAt": now}},
        upsert=True,
    )
    return Response(success=True, data=config, message="周期统计配置已保存")
