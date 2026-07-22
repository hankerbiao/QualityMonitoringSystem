"""
系统配置相关 Pydantic 模型
"""

from pydantic import BaseModel, Field

# ============== MES 系统配置 ==============


class MESConfigBase(BaseModel):
    """MES 配置基础模型"""

    username: str = Field(..., description="MES 系统账号")
    password: str = Field(..., description="MES 系统密码 (加密存储)")


class MESConfigCreate(MESConfigBase):
    """创建 MES 配置"""

    pass


class MESConfig(BaseModel):
    """MES 配置响应模型（出于安全，密码永不返回明文）"""

    username: str
    hasPassword: bool = Field(False, description="是否已配置密码（不返回明文）")

    class Config:
        from_attributes = True


class MESConfigUpdate(BaseModel):
    """更新 MES 配置"""

    username: str | None = None
    password: str | None = None


# ============== 关键工位影像追溯配置 ==============


class ProcessRecordConfig(BaseModel):
    """两个影像数据源共用的凭据（密码永不返回明文）。"""

    username: str = ""
    hasPassword: bool = False


class ProcessRecordConfigUpdate(BaseModel):
    username: str | None = None
    password: str | None = None


# ============== 机型指标配置 ==============


class ModelTargetBase(BaseModel):
    """机型指标基础模型"""

    model: str = Field(..., description="机型名称")
    targetRate: float = Field(..., ge=0, le=100, description="目标直通率百分比")


class ModelTargetCreate(ModelTargetBase):
    """创建机型指标"""

    pass


class ModelTarget(ModelTargetBase):
    """机型指标响应模型"""

    class Config:
        from_attributes = True


class ModelTargetsResponse(BaseModel):
    """机型指标列表响应"""

    items: dict[str, float] = Field(
        default_factory=dict, description="机型名称 -> 目标直通率 的映射"
    )


# ============== 邮件预警配置 ==============


class EmailAlertConfigBase(BaseModel):
    """邮件预警配置基础模型"""

    enabled: bool = Field(True, description="是否启用邮件预警")
    emails: str = Field(..., description="预警接收人邮箱, 多个用分号分隔")
    triggerCondition: str = Field(
        "",
        description="触发条件说明文本（用户自定义，可在前端「邮件预警规则」中编辑）",
    )
    weeklyProductionThreshold: int = Field(
        50,
        ge=0,
        description="周生产量阈值（台）：窗口内某机型投入台数达到该值才纳入 RTY 判定",
    )
    lrrAlertThreshold: float = Field(
        5.0,
        ge=0,
        description="物料故障率(LRR)阈值(%)：有装配扫号物料的故障率 ≥ 该值即发送预警邮件",
    )


class EmailAlertConfigCreate(EmailAlertConfigBase):
    """创建邮件预警配置"""

    pass


class EmailAlertConfig(EmailAlertConfigBase):
    """邮件预警配置响应模型"""

    class Config:
        from_attributes = True


class EmailAlertConfigUpdate(BaseModel):
    """更新邮件预警配置"""

    enabled: bool | None = None
    emails: str | None = None
    triggerCondition: str | None = None
    weeklyProductionThreshold: int | None = None
    lrrAlertThreshold: float | None = None


# ============== AI 模型配置 ==============


class AIConfigSchema(BaseModel):
    apiUrl: str = Field("", description="AI API 地址")
    modelId: str = Field("", description="模型 ID")
    apiKey: str = Field("", description="API Key (仅写入，不返回)")
    hasApiKey: bool = Field(False, description="API Key 是否已配置")
    maxTokens: int = Field(4096, ge=1, le=32768, description="最大 Token 数")


class AIConfigUpdate(BaseModel):
    apiUrl: str | None = None
    modelId: str | None = None
    apiKey: str | None = None
    maxTokens: int | None = None


# ============== RTY 数据字典 ==============


class DataDictionaryField(BaseModel):
    """机器信息表(machine_info)字段概要"""

    name: str = Field(..., description="MongoDB 字段名")
    type: str = Field("unknown", description="推断的数据类型")
    fillRate: float = Field(0.0, description="采样内非空比例 (0~1)")
    nonNullCount: int = Field(0, description="采样内非空条数")
    distinctCount: int = Field(0, description="去重数（关键业务字段为全集去重，其余为采样去重）")
    sampleValue: str = Field("", description="样例值（字符串化，最多 60 字）")
    rtyField: str = Field("", description="对应 RTY 业务字段名（如有）")
    description: str = Field("", description="业务含义说明")


class ValueCount(BaseModel):
    """维度取值与出现次数"""

    value: str = Field(..., description="取值（统一字符串化）")
    count: int = Field(0, description="在机器信息表中出现的次数")


class DimensionSummary(BaseModel):
    """机器信息表中的一个可下钻业务维度（看板卡片）"""

    key: str = Field(..., description="MongoDB 字段名")
    label: str = Field(..., description="业务名称（如 销售订单号）")
    total: int = Field(0, description="该维度全集去重数")
    topValues: list[ValueCount] = Field(
        default_factory=list, description="出现频次最高的前 20 个取值"
    )


class DimensionValues(BaseModel):
    """维度下钻：某字段的全部去重取值（可按关键字搜索、分页）"""

    field: str = Field(..., description="MongoDB 字段名")
    label: str = Field(..., description="业务名称")
    total: int = Field(0, description="该维度全集去重数")
    filteredTotal: int = Field(0, description="按搜索关键字过滤后的去重数")
    page: int = Field(1, description="当前页（从 1 开始）")
    pageSize: int = Field(50, description="每页条数")
    values: list[ValueCount] = Field(default_factory=list)


class RTYDataDictionary(BaseModel):
    """机器信息表(machine_info)数据字典与概要信息"""

    collection: str = Field("machine_info", description="集合名称")
    totalCount: int = Field(0, description="集合总记录数")
    fieldCount: int = Field(0, description="字段（列）数量")
    sampleSize: int = Field(0, description="采样条数")
    fields: list[DataDictionaryField] = Field(default_factory=list)
    dimensions: list[DimensionSummary] = Field(
        default_factory=list, description="可下钻的业务维度看板"
    )


# ============== 功能开关配置 ==============


class FeatureFlagsBase(BaseModel):
    """功能开关基础模型"""

    voiceInputEnabled: bool = Field(False, description="语音输入功能是否启用")


class FeatureFlagsCreate(FeatureFlagsBase):
    """创建功能开关配置"""

    pass


class FeatureFlags(FeatureFlagsBase):
    """功能开关配置响应模型"""

    class Config:
        from_attributes = True


class FeatureFlagsUpdate(BaseModel):
    """更新功能开关配置"""

    voiceInputEnabled: bool | None = None


# ============== 统一设置响应 ==============


class SettingsResponse(BaseModel):
    """统一设置响应"""

    mes: MESConfig | None = None
    processRecords: ProcessRecordConfig
    modelTargets: dict[str, float] = Field(default_factory=dict)
    emailAlert: EmailAlertConfig
    featureFlags: FeatureFlags
    ai: AIConfigSchema


class SettingsUpdateRequest(BaseModel):
    """设置更新请求"""

    mes: MESConfigUpdate | None = None
    processRecords: ProcessRecordConfigUpdate | None = None
    modelTargets: dict[str, float] | None = None
    emailAlert: EmailAlertConfigUpdate | None = None
    featureFlags: FeatureFlagsUpdate | None = None
    ai: AIConfigUpdate | None = None


class CycleStatsConfig(BaseModel):
    """周期统计看板配置"""

    selectedModels: list[str] = Field(
        default_factory=list, description="已选机型列表，空列表表示全部"
    )


class DataSummaryResponse(BaseModel):
    """数据概览统计响应"""

    totalOrders: int = Field(description="总销售订单数")
    validOrders: int = Field(description="有效订单数（有机器数据的订单）")
    totalMachines: int = Field(description="总机器数")
    totalModelTypes: int = Field(description="总机型数")
    totalMaterials: int = Field(description="总物料数（装配记录物料编码种类）")
    totalFaults: int = Field(description="总故障数")
    totalFaultMaterials: int = Field(description="总故障物料数（出现故障的物料种类）")
    factories: list[str] = Field(description="基地列表")
    customers: list[str] = Field(description="客户列表")
