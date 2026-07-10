"""
MongoDB Document 模型定义

定义各 Collection 的文档结构
"""

from datetime import datetime

from pydantic import BaseModel, Field

# ============== RTY 数据文档 ==============

class RTYDocument(BaseModel):
    """
    RTY 数据文档

    Collection: rty_data

    MES 字段映射:
    - factoryname -> base
    - productfamilyname -> productModel
    - s_NGCNT -> defectCount
    - qty -> inputCount
    - rate_real -> rtyRate
    - rate_bz -> targetRate
    - s_SALENO -> salesOrder (新增)
    - mfgordername -> productionOrder (新增)
    - s_MFGLINENAME -> productLine (新增)
    - ordertypename -> orderType (新增)
    - plannedstartdate -> planStartDate (新增)
    - s_Mes_Planendtime -> planEndDate (新增)
    - rate_status -> status (新增)
    """
    id: str = Field(..., alias="_id")
    time: str  # YYYY-MM-DD 格式
    model: str  # 普通机型 / 复合机型 / Qiandaohu一拖多机型
    productModel: str  # 具体机型型号，如 6210 C21 BOX
    customer: str = ""  # MES无此字段，留空
    base: str  # 基地：天津 / 昆山 / 桐乡 / 大同
    defectCount: int  # 故障数量
    inputCount: int  # 投入数量
    rtyRate: float  # 直通率 (0-100)
    targetRate: float  # 目标直通率 (0-100)
    # MES 额外字段
    salesOrder: str = ""  # 销售单号
    productionOrder: str = ""  # 生产订单号
    productLine: str = ""  # 产线名称
    orderType: str = ""  # 订单类型
    planStartDate: str = ""  # 计划开始日期
    planEndDate: str = ""  # 计划结束时间
    status: str = ""  # 达成状态: 已达成/未达成
    createdAt: datetime | None = None
    updatedAt: datetime | None = None

    class Config:
        populate_by_name = True


# ============== 投入明细文档 ==============

class InputDetailItem(BaseModel):
    """投入明细项"""
    id: str
    workOrder: str  # 如 WO-001-01
    productLine: str  # 如 L1 / L2 / L3
    count: int  # 投入数量


class InputDetailDocument(BaseModel):
    """
    投入明细文档

    Collection: input_details
    结构: {recordId: "xxx", details: [{workOrder, productLine, count}, ...]}
    """
    recordId: str  # 关联的 RTY 记录 ID
    details: list[InputDetailItem] = []


# ============== MES 配置文档 ==============

class MESConfigDocument(BaseModel):
    """
    MES 配置文档

    Collection: configs
    Key: mes_config
    """
    key: str = "mes_config"
    username: str
    # 密码应加密存储，这里仅做占位
    password: str
    updatedAt: datetime | None = None


# ============== 机型指标文档 ==============

class ModelTargetsDocument(BaseModel):
    """
    机型指标文档

    Collection: configs
    Key: model_targets
    """
    key: str = "model_targets"
    targets: dict[str, float] = {}  # {机型名: 目标直通率}
    updatedAt: datetime | None = None


# ============== 邮件预警配置文档 ==============

class EmailAlertDocument(BaseModel):
    """
    邮件预警配置文档

    Collection: configs
    Key: email_alert_config
    """
    key: str = "email_alert_config"
    enabled: bool = True
    emails: str = ""  # 分号分隔的邮箱列表
    attachReport: bool = True
    updatedAt: datetime | None = None


# ============== 功能开关文档 ==============

class FeatureFlagsDocument(BaseModel):
    """
    功能开关文档

    Collection: configs
    Key: feature_flags
    """
    key: str = "feature_flags"
    voiceInputEnabled: bool = False
    updatedAt: datetime | None = None


# ============== MongoDB Collections ==============

class Collections:
    """MongoDB Collection 名称常量"""
    RTY_DATA = "rty_data"
    INPUT_DETAILS = "input_details"
    MACHINE_INFO = "machine_info"
    FAULT_INFO = "fault_info"
    CONFIGS = "configs"
    USERS = "users"
