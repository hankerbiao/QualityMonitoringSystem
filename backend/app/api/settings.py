"""
系统配置 API 路由

包括:
- MES 系统接入配置
- 机型指标配置
- 邮件预警规则配置
- 功能开关配置

说明:
- GET 接口一律不返回明文密码；MES 密码以 hasPassword 标志表示。
- PUT 接口对可选字段使用 Pydantic 的 model_dump(exclude_none=True) 自动生成 $set，
  避免逐字段 `if x is not None` 的重复样板。
- MES 密码为安全敏感字段：仅当传入非空密码时才写入，空字符串会被忽略，
  防止前端回填空值导致已存密码被误清空。
"""
from datetime import datetime

from fastapi import APIRouter, HTTPException

from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.common import Response
from app.schemas.settings import (
    AIConfigSchema,
    AIConfigUpdate,
    EmailAlertConfig,
    EmailAlertConfigUpdate,
    FeatureFlags,
    FeatureFlagsUpdate,
    MESConfig,
    MESConfigUpdate,
    ModelTargetsResponse,
    SettingsResponse,
    SettingsUpdateRequest,
)

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


def _mes_from_doc(doc: dict | None) -> MESConfig:
    if not doc:
        return MESConfig(username="", hasPassword=False)
    return MESConfig(username=doc.get("username", ""), hasPassword=bool(doc.get("password")))


def _email_from_doc(doc: dict | None) -> EmailAlertConfig:
    if not doc:
        return EmailAlertConfig(enabled=True, emails=EMAIL_DEFAULT, attachReport=True)
    return EmailAlertConfig(
        enabled=doc.get("enabled", True),
        emails=doc.get("emails", ""),
        attachReport=doc.get("attachReport", True),
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
    mes_doc = await _read_doc("mes_config")
    model_doc = await _read_doc("model_targets")
    email_doc = await _read_doc("email_alert_config")
    flags_doc = await _read_doc("feature_flags")
    ai_doc = await _read_doc("ai_config")

    return Response(
        success=True,
        data=SettingsResponse(
            mes=_mes_from_doc(mes_doc),
            modelTargets=model_doc.get("targets", {}) if model_doc else {},
            emailAlert=_email_from_doc(email_doc),
            featureFlags=FeatureFlags(
                voiceInputEnabled=(flags_doc or {}).get("voiceInputEnabled", False)
            ),
            ai=_ai_from_doc(ai_doc),
        ),
    )


@router.put("", response_model=Response[SettingsResponse])
async def update_all_settings(request: SettingsUpdateRequest):
    """批量更新系统配置"""
    db = get_database()
    now = datetime.utcnow()

    if request.mes is not None:
        mes_set = request.mes.model_dump(exclude_none=True)
        # 安全护栏：忽略空密码，避免误清空已存密码
        if not mes_set.get("password"):
            mes_set.pop("password", None)
        if mes_set:
            mes_set["updatedAt"] = now
            await db[CONFIGS].update_one({"key": "mes_config"}, {"$set": mes_set}, upsert=True)

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
            await db[CONFIGS].update_one(
                {"key": "feature_flags"}, {"$set": flags_set}, upsert=True
            )

    if request.ai is not None:
        ai_set = request.ai.model_dump(exclude_none=True)
        if ai_set:
            ai_set["updatedAt"] = now
            await db[CONFIGS].update_one({"key": "ai_config"}, {"$set": ai_set}, upsert=True)

    return await get_all_settings()


# ============== MES 配置接口 ==============

@router.get("/mes", response_model=Response[MESConfig])
async def get_mes_config():
    """获取 MES 系统接入配置（不返回明文密码）"""
    return Response(success=True, data=_mes_from_doc(await _read_doc("mes_config")))


@router.put("/mes", response_model=Response[MESConfig])
async def update_mes_config(config: MESConfigUpdate):
    """更新 MES 系统接入配置"""
    # 忽略空密码，保护已存凭证
    if not config.password:
        config.password = None
    doc = await _save_section("mes_config", config)
    return Response(success=True, data=_mes_from_doc(doc), message="MES 配置已更新")


# ============== 机型指标接口 ==============

@router.get("/model-targets", response_model=Response[ModelTargetsResponse])
async def get_model_targets():
    """获取所有机型的目标直通率配置"""
    doc = await _read_doc("model_targets")
    return Response(success=True, data=ModelTargetsResponse(items=doc.get("targets", {}) if doc else {}))


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
    return Response(success=True, data=ModelTargetsResponse(items=targets), message="机型指标配置已更新")


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
    return Response(success=True, data=ModelTargetsResponse(items=targets), message=f"机型 {model} 的配置已删除")


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
    doc = await _save_section("ai_config", config)
    return Response(success=True, data=_ai_from_doc(doc), message="AI 模型配置已更新")
