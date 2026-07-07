"""
系统配置相关 Pydantic 模型
"""
from typing import Optional, Dict
from pydantic import BaseModel, Field, EmailStr


# ============== MES 系统配置 ==============

class MESConfigBase(BaseModel):
    """MES 配置基础模型"""
    username: str = Field(..., description="MES 系统账号")
    password: str = Field(..., description="MES 系统密码 (加密存储)")


class MESConfigCreate(MESConfigBase):
    """创建 MES 配置"""
    pass


class MESConfig(MESConfigBase):
    """MES 配置响应模型"""
    password: str = Field(..., description="返回时隐藏密码")

    class Config:
        from_attributes = True


class MESConfigUpdate(BaseModel):
    """更新 MES 配置"""
    username: Optional[str] = None
    password: Optional[str] = None


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
    items: Dict[str, float] = Field(
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
    enabled: Optional[bool] = None
    emails: Optional[str] = None
    attachReport: Optional[bool] = None


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
    voiceInputEnabled: Optional[bool] = None


# ============== 统一设置响应 ==============

class SettingsResponse(BaseModel):
    """统一设置响应"""
    mes: Optional[MESConfig] = None
    modelTargets: Dict[str, float] = Field(default_factory=dict)
    emailAlert: EmailAlertConfig
    featureFlags: FeatureFlags


class SettingsUpdateRequest(BaseModel):
    """设置更新请求"""
    mes: Optional[MESConfigUpdate] = None
    modelTargets: Optional[Dict[str, float]] = None
    emailAlert: Optional[EmailAlertConfigUpdate] = None
    featureFlags: Optional[FeatureFlagsUpdate] = None