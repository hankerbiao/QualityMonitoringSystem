"""
系统配置 API 路由

包括:
- 机型指标配置
- 邮件预警规则配置
- 功能开关配置

说明:
- GET 接口一律不返回明文密码；密码以 hasPassword 标志表示。
- PUT 接口对可选字段使用 Pydantic 的 model_dump(exclude_none=True) 自动生成 $set，
  避免逐字段 `if x is not None` 的重复样板。
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException

from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.common import Response
from app.schemas.process_records import ProcessRecordConnectionTest
from app.schemas.settings import (
    AIConfigSchema,
    AIConfigUpdate,
    CycleStatsConfig,
    EmailAlertConfig,
    EmailAlertConfigUpdate,
    FeatureFlags,
    FeatureFlagsUpdate,
    ModelTargetsResponse,
    ProcessRecordConfig,
    ProcessRecordConfigUpdate,
    SettingsResponse,
    SettingsUpdateRequest,
)
from app.services.credential_crypto import decrypt_credential, encrypt_credential
from app.services.lrr_alert import run_daily_lrr_check
from app.services.process_record_service import process_record_gateway
from app.services.weekly_alert import run_weekly_production_check

router = APIRouter()

CONFIGS = Collections.CONFIGS
EMAIL_DEFAULT = "manager@company.com; quality-team@company.com"


# ============== 通用助手 ==============


async def _read_doc(key: str) -> dict | None:
    """读取单个配置文档"""
    return await get_database()[CONFIGS].find_one({"key": key})


async def _save_section(key: str, update: object) -> dict:
    """
    将 Pydantic 更新模型（已设字段）写入对应配置文档并返回最新文档。

    - 仅写入非 None 字段（exclude_none=True），消除重复的 if 判断。
    - 空字典视为无字段可更新，返回 400。
    """
    data = update.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    data["updatedAt"] = datetime.utcnow()
    await get_database()[CONFIGS].update_one({"key": key}, {"$set": data}, upsert=True)
    return await _read_doc(key)


def _process_records_from_doc(doc: dict | None) -> ProcessRecordConfig:
    if not doc:
        return ProcessRecordConfig()
    return ProcessRecordConfig(
        username=doc.get("username", ""),
        hasPassword=bool(doc.get("passwordCiphertext")),
    )


def _email_from_doc(doc: dict | None) -> EmailAlertConfig:
    if not doc:
        return EmailAlertConfig(enabled=True, emails=EMAIL_DEFAULT)
    return EmailAlertConfig(
        enabled=doc.get("enabled", True),
        emails=doc.get("emails", ""),
        triggerCondition=doc.get("triggerCondition", ""),
        weeklyProductionThreshold=doc.get("weeklyProductionThreshold", 50),
        lrrAlertThreshold=doc.get("lrrAlertThreshold", 5.0),
    )


def _ai_from_doc(doc: dict | None) -> AIConfigSchema:
    if not doc:
        return AIConfigSchema()
    return AIConfigSchema(
        apiUrl=doc.get("apiUrl", ""),
        modelId=doc.get("modelId", ""),
        apiKey="",
        hasApiKey=bool(doc.get("apiKey")),
        maxTokens=doc.get("maxTokens", 4096),
    )


# ============== 统一设置接口 ==============


@router.get("", response_model=Response[SettingsResponse])
async def get_all_settings():
    """获取所有系统配置"""
    process_records_doc = await _read_doc("process_record_config")
    model_doc = await _read_doc("model_targets")
    email_doc = await _read_doc("email_alert_config")
    flags_doc = await _read_doc("feature_flags")
    ai_doc = await _read_doc("ai_config")
    cycle_doc = await _read_doc("cycle_stats_config")

    return Response(
        success=True,
        data=SettingsResponse(
            processRecords=_process_records_from_doc(process_records_doc),
            modelTargets=model_doc.get("targets", {}) if model_doc else {},
            emailAlert=_email_from_doc(email_doc),
            featureFlags=FeatureFlags(
                voiceInputEnabled=(flags_doc or {}).get("voiceInputEnabled", False)
            ),
            ai=_ai_from_doc(ai_doc),
            cycleStatsConfig=CycleStatsConfig(
                selectedModels=(cycle_doc or {}).get("selectedModels", [])
            ),
        ),
    )


@router.put("", response_model=Response[SettingsResponse])
async def update_all_settings(request: SettingsUpdateRequest):
    """批量更新系统配置"""
    db = get_database()
    now = datetime.utcnow()

    if request.processRecords is not None:
        process_set = request.processRecords.model_dump(exclude_none=True)
        password = process_set.pop("password", None)
        if password:
            process_set["passwordCiphertext"] = encrypt_credential(password)
        if process_set:
            process_set["updatedAt"] = now
            await db[CONFIGS].update_one(
                {"key": "process_record_config"},
                {"$set": process_set},
                upsert=True,
            )

    if request.modelTargets is not None:
        await db[CONFIGS].update_one(
            {"key": "model_targets"},
            {"$set": {"targets": request.modelTargets, "updatedAt": now}},
            upsert=True,
        )

    if request.emailAlert is not None:
        email_set = request.emailAlert.model_dump(exclude_none=True)
        if email_set:
            email_set["updatedAt"] = now
            await db[CONFIGS].update_one(
                {"key": "email_alert_config"}, {"$set": email_set}, upsert=True
            )

    if request.featureFlags is not None:
        flags_set = request.featureFlags.model_dump(exclude_none=True)
        if flags_set:
            flags_set["updatedAt"] = now
            await db[CONFIGS].update_one({"key": "feature_flags"}, {"$set": flags_set}, upsert=True)

    if request.ai is not None:
        ai_set = request.ai.model_dump(exclude_none=True)
        # 空值表示保留已存密钥，避免设置页回填的掩码值清空配置。
        if not ai_set.get("apiKey"):
            ai_set.pop("apiKey", None)
        if ai_set:
            ai_set["updatedAt"] = now
            await db[CONFIGS].update_one({"key": "ai_config"}, {"$set": ai_set}, upsert=True)

    if request.cycleStatsConfig is not None:
        await db[CONFIGS].update_one(
            {"key": "cycle_stats_config"},
            {
                "$set": {
                    "selectedModels": request.cycleStatsConfig.selectedModels,
                    "updatedAt": now,
                }
            },
            upsert=True,
        )

    return await get_all_settings()


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
        data["passwordCiphertext"] = encrypt_credential(password)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    data["updatedAt"] = datetime.utcnow()
    await get_database()[CONFIGS].update_one(
        {"key": "process_record_config"}, {"$set": data}, upsert=True
    )
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
        password = decrypt_credential(stored["passwordCiphertext"])
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
        {"$set": {"targets": targets, "updatedAt": datetime.utcnow()}},
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
        {"$set": {"targets": targets, "updatedAt": datetime.utcnow()}},
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
        {"$set": {"targets": targets, "updatedAt": datetime.utcnow()}},
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


@router.post("/email-alert/run-lrr-check", response_model=Response[dict])
async def run_lrr_check():
    """
    手动触发「每日物料故障率(LRR)预警检查」。

    与每天 17:30 的定时任务逻辑一致：聚合有装配扫号物料的 LRR，
    对达到 lrrAlertThreshold 阈值的物料发送汇总预警邮件。
    主要用于验证配置与邮件链路，无需等待定时触发。
    """
    result = await run_daily_lrr_check()
    return Response(success=True, data=result, message="物料故障率(LRR)预警检查已执行")


# ============== 功能开关接口 ==============


@router.get("/feature-flags", response_model=Response[FeatureFlags])
async def get_feature_flags():
    """获取功能开关配置"""
    doc = await _read_doc("feature_flags")
    return Response(
        success=True,
        data=FeatureFlags(voiceInputEnabled=(doc or {}).get("voiceInputEnabled", False)),
    )


@router.put("/feature-flags", response_model=Response[FeatureFlags])
async def update_feature_flags(flags: FeatureFlagsUpdate):
    """更新功能开关配置"""
    doc = await _save_section("feature_flags", flags)
    return Response(
        success=True,
        data=FeatureFlags(voiceInputEnabled=(doc or {}).get("voiceInputEnabled", False)),
        message="功能开关配置已更新",
    )


# ============== AI 模型配置接口 ==============


@router.get("/ai", response_model=Response[AIConfigSchema])
async def get_ai_config():
    """获取 AI 模型配置（不返回明文 apiKey）"""
    return Response(success=True, data=_ai_from_doc(await _read_doc("ai_config")))


@router.put("/ai", response_model=Response[AIConfigSchema])
async def update_ai_config(config: AIConfigUpdate):
    """更新 AI 模型配置"""
    if not config.apiKey:
        config.apiKey = None
    if config.model_dump(exclude_none=True):
        doc = await _save_section("ai_config", config)
    else:
        doc = await _read_doc("ai_config")
    return Response(success=True, data=_ai_from_doc(doc), message="AI 模型配置已更新")


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
    now = datetime.utcnow()
    await db[Collections.CONFIGS].update_one(
        {"key": "cycle_stats_config"},
        {"$set": {"selectedModels": config.selectedModels, "updatedAt": now}},
        upsert=True,
    )
    return Response(success=True, data=config, message="周期统计配置已保存")
