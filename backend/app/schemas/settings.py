"""
系统配置相关 Pydantic 模型
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

DashboardStatus = Literal["available", "planned"]
DASHBOARD_STATUS_KEYS = frozenset({"rty", "station-pass-rate", "lrr", "doa", "mfr"})
DEFAULT_DASHBOARD_STATUSES: dict[str, DashboardStatus] = {
    "rty": "available",
    "station-pass-rate": "available",
    "lrr": "available",
    "doa": "planned",
    "mfr": "planned",
}


def default_dashboard_statuses() -> dict[str, DashboardStatus]:
    return DEFAULT_DASHBOARD_STATUSES.copy()


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


class ModelTarget(ModelTargetBase):
    """机型指标响应模型"""

    model_config = ConfigDict(from_attributes=True)


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


class EmailAlertConfig(EmailAlertConfigBase):
    """邮件预警配置响应模型"""

    model_config = ConfigDict(from_attributes=True)


class EmailAlertConfigUpdate(BaseModel):
    """更新邮件预警配置"""

    enabled: bool | None = None
    emails: str | None = None
    triggerCondition: str | None = None
    weeklyProductionThreshold: int | None = None


# ============== 周期统计看板配置 ==============


class CycleStatsConfig(BaseModel):
    """周期统计看板配置"""

    selectedModels: list[str] = Field(
        default_factory=list, description="已选机型列表，空列表表示全部"
    )


class StationPassRateConfig(BaseModel):
    """工位直通率页面的组合工站配置。"""

    selectedStations: list[str] = Field(default_factory=list, description="已选工站编码列表")
    configured: bool = Field(False, description="是否已保存过工站选择")


# ============== 统一设置响应 ==============


class QualitySettingsResponse(BaseModel):
    """所有已登录用户可管理的质量指标与邮件预警配置。"""

    modelTargets: dict[str, float] = Field(default_factory=dict)
    emailAlert: EmailAlertConfig


class SettingsResponse(QualitySettingsResponse):
    """管理员统一设置响应。"""

    processRecords: ProcessRecordConfig
    dashboardStatuses: dict[str, DashboardStatus] = Field(
        default_factory=default_dashboard_statuses
    )
    cycleStatsConfig: CycleStatsConfig = Field(default_factory=CycleStatsConfig)
    stationPassRateConfig: StationPassRateConfig = Field(default_factory=StationPassRateConfig)


class SettingsUpdateRequest(BaseModel):
    """设置更新请求"""

    model_config = ConfigDict(extra="forbid")

    processRecords: ProcessRecordConfigUpdate | None = None
    modelTargets: dict[str, float] | None = None
    emailAlert: EmailAlertConfigUpdate | None = None
    dashboardStatuses: dict[str, DashboardStatus] | None = None
    cycleStatsConfig: CycleStatsConfig | None = None
    stationPassRateConfig: StationPassRateConfig | None = None

    @field_validator("dashboardStatuses")
    @classmethod
    def validate_dashboard_statuses(
        cls, value: dict[str, DashboardStatus] | None
    ) -> dict[str, DashboardStatus] | None:
        if value is not None:
            invalid_keys = set(value) - DASHBOARD_STATUS_KEYS
            if invalid_keys:
                raise ValueError(f"Invalid dashboard status keys: {sorted(invalid_keys)}")
        return value
