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

from collections import Counter
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Query

from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.common import Response
from app.schemas.process_records import ProcessRecordConnectionTest
from app.schemas.settings import (
    AIConfigSchema,
    AIConfigUpdate,
    CycleStatsConfig,
    DataDictionaryField,
    DataSummaryResponse,
    DimensionSummary,
    DimensionValues,
    EmailAlertConfig,
    EmailAlertConfigUpdate,
    FeatureFlags,
    FeatureFlagsUpdate,
    MESConfig,
    MESConfigUpdate,
    ModelTargetsResponse,
    ProcessRecordConfig,
    ProcessRecordConfigUpdate,
    RTYDataDictionary,
    SettingsResponse,
    SettingsUpdateRequest,
    ValueCount,
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


def _mes_from_doc(doc: dict | None) -> MESConfig:
    if not doc:
        return MESConfig(username="", hasPassword=False)
    return MESConfig(username=doc.get("username", ""), hasPassword=bool(doc.get("password")))


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
        apiKey=doc.get("apiKey", ""),
        hasApiKey=bool(doc.get("apiKey")),
        maxTokens=doc.get("maxTokens", 4096),
    )


# ============== 统一设置接口 ==============


@router.get("", response_model=Response[SettingsResponse])
async def get_all_settings():
    """获取所有系统配置"""
    mes_doc = await _read_doc("mes_config")
    process_records_doc = await _read_doc("process_record_config")
    model_doc = await _read_doc("model_targets")
    email_doc = await _read_doc("email_alert_config")
    flags_doc = await _read_doc("feature_flags")
    ai_doc = await _read_doc("ai_config")

    return Response(
        success=True,
        data=SettingsResponse(
            mes=_mes_from_doc(mes_doc),
            processRecords=_process_records_from_doc(process_records_doc),
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
    doc = await _save_section("ai_config", config)
    return Response(success=True, data=_ai_from_doc(doc), message="AI 模型配置已更新")


# ============== RTY 数据字典接口 ==============

# 机器信息表字段 -> (对应 RTY 业务字段, 业务含义)
# 来源: AGENTS.md 字段映射 + rty.py 聚合逻辑
_MACHINE_FIELD_META: dict[str, tuple[str, str]] = {
    "sn": ("serialNumber", "整机序列号（唯一标识，按 sn 唯一索引）"),
    "sale_no": ("salesOrder", "销售订单号"),
    "mfg_order": ("productionOrder", "生产订单号"),
    "factory": ("base", "生产基地（天津 / 昆山 / 桐乡 / 大同）"),
    "product_family": ("productModel", "生产机型（如 6210 C21 BOX）"),
    "s_MFGLINENAME": ("productLine", "产线名称"),
    "customer_id": ("customer", "客户编码"),
    "actual_start_time": ("", "实际开始时间（RTY 列表按此时间倒序）"),
    "ordertypename": ("orderType", "订单类型"),
    "plannedstartdate": ("planStartDate", "计划开始日期"),
    "s_Mes_Planendtime": ("planEndDate", "计划结束时间"),
    "rate_status": ("status", "达成状态（已达成 / 未达成）"),
}

# 需要精确「全集去重数」的关键业务字段（均有索引，聚合成本低）
_MACHINE_KEY_FIELDS: list[str] = [
    "sn",
    "sale_no",
    "mfg_order",
    "factory",
    "product_family",
    "customer_id",
    "s_MFGLINENAME",
    "ordertypename",
]

# 可下钻的业务维度（用于数据字典看板）：字段 -> 业务名
_MACHINE_DIMENSIONS: dict[str, str] = {
    "sale_no": "销售订单号",
    "product_family": "机型",
    "factory": "基地",
    "mfg_order": "生产订单",
    "s_MFGLINENAME": "产线",
    "ordertypename": "订单类型",
    "customer_id": "客户",
}


def _infer_field_type(value) -> str:
    """根据样本值推断字段类型"""
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (datetime, date)):
        return "datetime"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, list):
        return "array"
    return "other"


@router.get("/rty-dictionary", response_model=Response[RTYDataDictionary])
async def get_rty_data_dictionary():
    """
    获取机器信息表(machine_info)的数据字典与概要信息：

    - 总记录数、字段（列）数量
    - 每个字段的类型推断、非空比例、样例值
    - 关键业务字段的「全集去重数」，其余字段基于采样去重
    - 字段与 RTY 业务字段的对应关系及业务含义
    """
    db = get_database()
    coll = db[Collections.MACHINE_INFO]
    total = await coll.count_documents({})

    SAMPLE_SIZE = 300
    if total == 0:
        sample: list[dict] = []
    elif total <= SAMPLE_SIZE:
        sample = await coll.find({}).to_list(length=total)
    else:
        cursor = coll.aggregate([{"$sample": {"size": SAMPLE_SIZE}}])
        sample = await cursor.to_list(length=SAMPLE_SIZE)

    # 1) 基于采样做字段画像
    stats: dict[str, dict] = {}
    for doc in sample:
        for key, val in doc.items():
            if key == "_id":
                continue
            s = stats.setdefault(
                key, {"types": Counter(), "non_null": 0, "distinct": set(), "sample": None}
            )
            if val is None:
                continue
            s["non_null"] += 1
            s["types"][_infer_field_type(val)] += 1
            if s["sample"] is None:
                s["sample"] = val
            try:
                s["distinct"].add(val)
            except TypeError:
                s["distinct"].add(repr(val))

    # 2) 关键业务字段全集去重 + 维度 Top 取值（一次性 $facet，基于全集合，不受采样影响）
    distinct_map: dict[str, int] = {}
    dimensions: list[DimensionSummary] = []
    if total > 0 and sample:
        facet: dict = {}
        for f in _MACHINE_KEY_FIELDS:
            facet[f"dist_{f}"] = [
                {"$group": {"_id": f"${f}"}},
                {"$match": {"_id": {"$ne": None}}},
                {"$count": "c"},
            ]
        for f in _MACHINE_DIMENSIONS:
            facet[f"top_{f}"] = [
                {"$group": {"_id": f"${f}", "count": {"$sum": 1}}},
                {"$match": {"_id": {"$ne": None}}},
                {"$sort": {"count": -1}},
                {"$limit": 20},
                {"$project": {"value": "$_id", "count": 1, "_id": 0}},
            ]
        cursor = coll.aggregate([{"$facet": facet}])
        facet_res = await cursor.to_list(length=1)
        if facet_res:
            fr = facet_res[0]
            for f in _MACHINE_KEY_FIELDS:
                distinct_map[f] = (
                    fr.get(f"dist_{f}", [{}])[0].get("c", 0) if fr.get(f"dist_{f}") else 0
                )
            for f in _MACHINE_DIMENSIONS:
                # 仅展示全集合中确实存在的维度（distinct > 0）
                if distinct_map.get(f, 0) <= 0:
                    continue
                top = [
                    ValueCount(value=str(v["value"]), count=v["count"])
                    for v in fr.get(f"top_{f}", [])
                ]
                dimensions.append(
                    DimensionSummary(
                        key=f,
                        label=_MACHINE_DIMENSIONS[f],
                        total=distinct_map.get(f, 0),
                        topValues=top,
                    )
                )

    # 3) 组装字段列表
    fields: list[DataDictionaryField] = []
    for name, s in stats.items():
        types = s["types"]
        # 整数与浮点混合时统一为 number
        if types.get("integer") and types.get("number"):
            ftype = "number"
        else:
            ftype = types.most_common(1)[0][0] if types else "unknown"

        rty_field, desc = _MACHINE_FIELD_META.get(name, ("", ""))
        sample_val = s["sample"]
        sample_str = "" if sample_val is None else str(sample_val)
        if len(sample_str) > 60:
            sample_str = sample_str[:57] + "..."

        distinct_count = distinct_map.get(name) if name in distinct_map else len(s["distinct"])

        fields.append(
            DataDictionaryField(
                name=name,
                type=ftype,
                fillRate=round(s["non_null"] / len(sample), 3) if sample else 0.0,
                nonNullCount=s["non_null"],
                distinctCount=distinct_count,
                sampleValue=sample_str,
                rtyField=rty_field,
                description=desc,
            )
        )

    # 业务关键字段（有 RTY 映射或业务含义）排前，其余按字段名排序
    fields.sort(key=lambda f: (0 if (f.rtyField or f.description) else 1, f.name))

    return Response(
        success=True,
        data=RTYDataDictionary(
            totalCount=total,
            fieldCount=len(fields),
            sampleSize=len(sample),
            fields=fields,
            dimensions=dimensions,
        ),
        message=f"机器信息表共 {total} 条记录，{len(fields)} 个字段",
    )


@router.get("/rty-dictionary/dimension", response_model=Response[DimensionValues])
async def get_rty_dimension_values(
    field: str = Query(..., description="维度字段名，如 sale_no / product_family"),
    search: str = Query("", description="按取值关键字过滤（不区分大小写）"),
    page: int = Query(1, ge=1, description="页码，从 1 开始"),
    pageSize: int = Query(50, ge=1, le=200, description="每页条数"),
):
    """
    下钻查询某维度的全部去重取值及其出现次数（机器信息表）。

    - 返回结果按出现次数降序排列，支持按取值关键字搜索与分页。
    - 用于「RTY 数据字典」看板点击卡片后的明细弹窗。
    """
    if field not in _MACHINE_DIMENSIONS:
        raise HTTPException(status_code=400, detail=f"不支持的维度字段: {field}")

    db = get_database()
    coll = db[Collections.MACHINE_INFO]
    cursor = coll.aggregate(
        [
            {"$group": {"_id": f"${field}", "count": {"$sum": 1}}},
            {"$match": {"_id": {"$ne": None}}},
        ]
    )
    rows = await cursor.to_list(length=None)
    total = len(rows)

    kw = search.strip().lower()
    filtered = [
        (str(r["_id"]), r["count"]) for r in rows if (not kw) or (kw in str(r["_id"]).lower())
    ]
    filtered.sort(key=lambda x: x[1], reverse=True)
    filtered_total = len(filtered)

    start = (page - 1) * pageSize
    page_rows = filtered[start : start + pageSize]
    values = [ValueCount(value=v, count=c) for v, c in page_rows]

    return Response(
        success=True,
        data=DimensionValues(
            field=field,
            label=_MACHINE_DIMENSIONS[field],
            total=total,
            filteredTotal=filtered_total,
            page=page,
            pageSize=pageSize,
            values=values,
        ),
        message=f"{_MACHINE_DIMENSIONS[field]} 共 {total} 个取值",
    )


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


@router.get("/summary", response_model=Response[DataSummaryResponse])
async def get_data_summary():
    """获取系统数据概览统计（总订单数/机器数/故障数/基地/客户等）"""
    db = get_database()

    total_orders = await db[Collections.SALES_ORDERS].count_documents({})
    valid_orders = await db[Collections.SALES_ORDERS].count_documents({"import_status": "done"})
    total_machines = await db[Collections.MACHINE_INFO].count_documents({})

    model_types = await db[Collections.MACHINE_INFO].distinct("product_family")
    factories = await db[Collections.MACHINE_INFO].distinct("factory")
    customers = await db[Collections.MACHINE_INFO].distinct("customer_id")
    customers = [c for c in customers if c]

    total_materials = len(await db[Collections.ASSEMBLY_RECORDS].distinct("product_no"))
    total_faults = await db[Collections.FAULT_INFO].count_documents({})
    fault_materials = len(await db[Collections.FAULT_INFO].distinct("product_name"))

    return Response(
        success=True,
        data=DataSummaryResponse(
            totalOrders=total_orders,
            validOrders=valid_orders,
            totalMachines=total_machines,
            totalModelTypes=len(model_types),
            totalMaterials=total_materials,
            totalFaults=total_faults,
            totalFaultMaterials=fault_materials,
            factories=sorted(factories),
            customers=sorted(customers),
        ),
    )
