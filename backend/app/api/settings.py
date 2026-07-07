"""
系统配置 API 路由

包括:
- MES 系统接入配置
- 机型指标配置
- 邮件预警规则配置
- 功能开关配置
"""
from datetime import datetime
from typing import Dict
from fastapi import APIRouter, HTTPException

from app.db.mongodb import get_database
from app.schemas.settings import (
    MESConfig,
    MESConfigUpdate,
    ModelTarget,
    ModelTargetsResponse,
    EmailAlertConfig,
    EmailAlertConfigUpdate,
    FeatureFlags,
    FeatureFlagsUpdate,
    SettingsResponse,
    SettingsUpdateRequest,
)
from app.schemas.common import Response
from app.models.documents import Collections

router = APIRouter()


# ============== 统一设置接口 ==============

@router.get("", response_model=Response[SettingsResponse])
async def get_all_settings():
    """
    获取所有系统配置
    """
    db = get_database()

    # 获取 MES 配置
    mes_config = await db[Collections.CONFIGS].find_one({"key": "mes_config"})
    mes = None
    if mes_config:
        mes = MESConfig(
            username=mes_config.get("username", ""),
            password="********"  # 隐藏密码
        )

    # 获取机型指标配置
    model_targets_doc = await db[Collections.CONFIGS].find_one({"key": "model_targets"})
    model_targets: Dict[str, float] = model_targets_doc.get("targets", {}) if model_targets_doc else {}

    # 获取邮件预警配置
    email_alert_doc = await db[Collections.CONFIGS].find_one({"key": "email_alert_config"})
    if email_alert_doc:
        email_alert = EmailAlertConfig(
            enabled=email_alert_doc.get("enabled", True),
            emails=email_alert_doc.get("emails", ""),
            attachReport=email_alert_doc.get("attachReport", True),
        )
    else:
        # 默认配置
        email_alert = EmailAlertConfig(
            enabled=True,
            emails="manager@company.com; quality-team@company.com",
            attachReport=True,
        )

    # 获取功能开关配置
    feature_flags_doc = await db[Collections.CONFIGS].find_one({"key": "feature_flags"})
    if feature_flags_doc:
        feature_flags = FeatureFlags(
            voiceInputEnabled=feature_flags_doc.get("voiceInputEnabled", False),
        )
    else:
        feature_flags = FeatureFlags(voiceInputEnabled=False)

    return Response(
        success=True,
        data=SettingsResponse(
            mes=mes,
            modelTargets=model_targets,
            emailAlert=email_alert,
            featureFlags=feature_flags,
        )
    )


@router.put("", response_model=Response[SettingsResponse])
async def update_all_settings(request: SettingsUpdateRequest):
    """
    批量更新系统配置
    """
    db = get_database()
    updated_at = datetime.utcnow()

    # 更新 MES 配置
    if request.mes is not None:
        mes_update = {}
        if request.mes.username is not None:
            mes_update["username"] = request.mes.username
        if request.mes.password is not None:
            # TODO: 生产环境应加密存储
            mes_update["password"] = request.mes.password
        if mes_update:
            mes_update["updatedAt"] = updated_at
            await db[Collections.CONFIGS].update_one(
                {"key": "mes_config"},
                {"$set": mes_update},
                upsert=True
            )

    # 更新机型指标配置
    if request.modelTargets is not None:
        await db[Collections.CONFIGS].update_one(
            {"key": "model_targets"},
            {"$set": {"targets": request.modelTargets, "updatedAt": updated_at}},
            upsert=True
        )

    # 更新邮件预警配置
    if request.emailAlert is not None:
        email_update = {}
        if request.emailAlert.enabled is not None:
            email_update["enabled"] = request.emailAlert.enabled
        if request.emailAlert.emails is not None:
            email_update["emails"] = request.emailAlert.emails
        if request.emailAlert.attachReport is not None:
            email_update["attachReport"] = request.emailAlert.attachReport
        if email_update:
            email_update["updatedAt"] = updated_at
            await db[Collections.CONFIGS].update_one(
                {"key": "email_alert_config"},
                {"$set": email_update},
                upsert=True
            )

    # 更新功能开关配置
    if request.featureFlags is not None:
        flags_update = {}
        if request.featureFlags.voiceInputEnabled is not None:
            flags_update["voiceInputEnabled"] = request.featureFlags.voiceInputEnabled
        if flags_update:
            flags_update["updatedAt"] = updated_at
            await db[Collections.CONFIGS].update_one(
                {"key": "feature_flags"},
                {"$set": flags_update},
                upsert=True
            )

    # 返回更新后的配置
    return await get_all_settings()


# ============== MES 配置接口 ==============

@router.get("/mes", response_model=Response[MESConfig])
async def get_mes_config():
    """
    获取 MES 系统接入配置
    """
    db = get_database()

    doc = await db[Collections.CONFIGS].find_one({"key": "mes_config"})

    if not doc:
        return Response(success=True, data=MESConfig(username="", password=""))

    return Response(
        success=True,
        data=MESConfig(
            username=doc.get("username", ""),
            password="********"  # 隐藏实际密码
        )
    )


@router.put("/mes", response_model=Response[MESConfig])
async def update_mes_config(config: MESConfigUpdate):
    """
    更新 MES 系统接入配置
    """
    db = get_database()
    updated_at = datetime.utcnow()

    update_data = {"updatedAt": updated_at}
    if config.username is not None:
        update_data["username"] = config.username
    if config.password is not None:
        # TODO: 生产环境应加密存储
        update_data["password"] = config.password

    await db[Collections.CONFIGS].update_one(
        {"key": "mes_config"},
        {"$set": update_data},
        upsert=True
    )

    # 获取更新后的配置
    doc = await db[Collections.CONFIGS].find_one({"key": "mes_config"})

    return Response(
        success=True,
        data=MESConfig(
            username=doc.get("username", ""),
            password="********"
        ),
        message="MES 配置已更新"
    )


# ============== 机型指标接口 ==============

@router.get("/model-targets", response_model=Response[ModelTargetsResponse])
async def get_model_targets():
    """
    获取所有机型的目标直通率配置
    """
    db = get_database()

    doc = await db[Collections.CONFIGS].find_one({"key": "model_targets"})

    targets: Dict[str, float] = doc.get("targets", {}) if doc else {}

    return Response(
        success=True,
        data=ModelTargetsResponse(items=targets)
    )


@router.put("/model-targets", response_model=Response[ModelTargetsResponse])
async def update_model_targets(targets: Dict[str, float]):
    """
    批量更新机型目标直通率

    请求体: {"6210 C21 BOX": 99.5, "6210 C21": 99.0}
    """
    db = get_database()

    # 验证数据
    for model, rate in targets.items():
        if not isinstance(model, str) or not model.strip():
            raise HTTPException(status_code=400, detail=f"Invalid model name: {model}")
        if not isinstance(rate, (int, float)) or rate < 0 or rate > 100:
            raise HTTPException(status_code=400, detail=f"Invalid target rate for {model}: {rate}")

    await db[Collections.CONFIGS].update_one(
        {"key": "model_targets"},
        {"$set": {"targets": targets, "updatedAt": datetime.utcnow()}},
        upsert=True
    )

    return Response(
        success=True,
        data=ModelTargetsResponse(items=targets),
        message="机型指标配置已更新"
    )


@router.post("/model-targets/{model}", response_model=Response[ModelTargetsResponse])
async def add_model_target(model: str, targetRate: float):
    """
    添加或更新单个机型的目标直通率

    - model: 机型名称
    - targetRate: 目标直通率 (0-100)
    """
    db = get_database()

    # 获取现有配置
    doc = await db[Collections.CONFIGS].find_one({"key": "model_targets"})
    targets: Dict[str, float] = doc.get("targets", {}).copy() if doc else {}

    # 更新目标值
    targets[model] = targetRate

    await db[Collections.CONFIGS].update_one(
        {"key": "model_targets"},
        {"$set": {"targets": targets, "updatedAt": datetime.utcnow()}},
        upsert=True
    )

    return Response(
        success=True,
        data=ModelTargetsResponse(items=targets),
        message=f"机型 {model} 的目标直通率已设置为 {targetRate}%"
    )


@router.delete("/model-targets/{model}", response_model=Response[ModelTargetsResponse])
async def delete_model_target(model: str):
    """
    删除指定机型的目标直通率配置
    """
    db = get_database()

    # 获取现有配置
    doc = await db[Collections.CONFIGS].find_one({"key": "model_targets"})
    targets: Dict[str, float] = doc.get("targets", {}).copy() if doc else {}

    if model not in targets:
        raise HTTPException(status_code=404, detail=f"机型 {model} 不存在")

    del targets[model]

    await db[Collections.CONFIGS].update_one(
        {"key": "model_targets"},
        {"$set": {"targets": targets, "updatedAt": datetime.utcnow()}},
        upsert=True
    )

    return Response(
        success=True,
        data=ModelTargetsResponse(items=targets),
        message=f"机型 {model} 的配置已删除"
    )


# ============== 邮件预警配置接口 ==============

@router.get("/email-alert", response_model=Response[EmailAlertConfig])
async def get_email_alert_config():
    """
    获取邮件预警配置
    """
    db = get_database()

    doc = await db[Collections.CONFIGS].find_one({"key": "email_alert_config"})

    if not doc:
        # 返回默认配置
        config = EmailAlertConfig(
            enabled=True,
            emails="manager@company.com; quality-team@company.com",
            attachReport=True,
        )
    else:
        config = EmailAlertConfig(
            enabled=doc.get("enabled", True),
            emails=doc.get("emails", ""),
            attachReport=doc.get("attachReport", True),
        )

    return Response(success=True, data=config)


@router.put("/email-alert", response_model=Response[EmailAlertConfig])
async def update_email_alert_config(config: EmailAlertConfigUpdate):
    """
    更新邮件预警配置
    """
    db = get_database()
    updated_at = datetime.utcnow()

    update_data = {}
    if config.enabled is not None:
        update_data["enabled"] = config.enabled
    if config.emails is not None:
        # 验证邮箱格式 (简单验证)
        emails = [e.strip() for e in config.emails.split(";") if e.strip()]
        for email in emails:
            if "@" not in email:
                raise HTTPException(status_code=400, detail=f"Invalid email format: {email}")
        update_data["emails"] = "; ".join(emails)
    if config.attachReport is not None:
        update_data["attachReport"] = config.attachReport

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    update_data["updatedAt"] = updated_at

    await db[Collections.CONFIGS].update_one(
        {"key": "email_alert_config"},
        {"$set": update_data},
        upsert=True
    )

    # 获取更新后的配置
    doc = await db[Collections.CONFIGS].find_one({"key": "email_alert_config"})

    return Response(
        success=True,
        data=EmailAlertConfig(
            enabled=doc.get("enabled", True),
            emails=doc.get("emails", ""),
            attachReport=doc.get("attachReport", True),
        ),
        message="邮件预警配置已更新"
    )


# ============== 功能开关接口 ==============

@router.get("/feature-flags", response_model=Response[FeatureFlags])
async def get_feature_flags():
    """
    获取功能开关配置
    """
    db = get_database()

    doc = await db[Collections.CONFIGS].find_one({"key": "feature_flags"})

    if not doc:
        flags = FeatureFlags(voiceInputEnabled=False)
    else:
        flags = FeatureFlags(
            voiceInputEnabled=doc.get("voiceInputEnabled", False),
        )

    return Response(success=True, data=flags)


@router.put("/feature-flags", response_model=Response[FeatureFlags])
async def update_feature_flags(flags: FeatureFlagsUpdate):
    """
    更新功能开关配置
    """
    db = get_database()
    updated_at = datetime.utcnow()

    update_data = {}
    if flags.voiceInputEnabled is not None:
        update_data["voiceInputEnabled"] = flags.voiceInputEnabled

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    update_data["updatedAt"] = updated_at

    await db[Collections.CONFIGS].update_one(
        {"key": "feature_flags"},
        {"$set": update_data},
        upsert=True
    )

    # 获取更新后的配置
    doc = await db[Collections.CONFIGS].find_one({"key": "feature_flags"})

    return Response(
        success=True,
        data=FeatureFlags(
            voiceInputEnabled=doc.get("voiceInputEnabled", False),
        ),
        message="功能开关配置已更新"
    )