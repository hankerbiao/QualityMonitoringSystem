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
        default_factory=dict,
        description="机型名称 -> 目标直通率 的映射"
    )


# ============== 邮件预警配置 ==============

class EmailAlertConfigBase(BaseModel):
    """邮件预警配置基础模型"""
    enabled: bool = Field(True, description="是否启用邮件预警")
    emails: str = Field(..., description="预警接收人邮箱, 多个用分号分隔")
    attachReport: bool = Field(True, description="是否在邮件中附带故障明细")


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
    attachReport: bool | None = None


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
    modelTargets: dict[str, float] = Field(default_factory=dict)
    emailAlert: EmailAlertConfig
    featureFlags: FeatureFlags
    ai: AIConfigSchema


class SettingsUpdateRequest(BaseModel):
    """设置更新请求"""
    mes: MESConfigUpdate | None = None
    modelTargets: dict[str, float] | None = None
    emailAlert: EmailAlertConfigUpdate | None = None
    featureFlags: FeatureFlagsUpdate | None = None
    ai: AIConfigUpdate | None = None
