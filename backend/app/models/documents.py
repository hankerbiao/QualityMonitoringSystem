"""
MongoDB Document 模型定义

定义各 Collection 的文档结构
"""

from datetime import datetime

from pydantic import BaseModel

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

    MACHINE_INFO = "machine_info"
    FAULT_INFO = "fault_info"
    CONFIGS = "configs"
    USERS = "users"
    SALES_ORDERS_SAP = "sales_orders_sap"
    ORDER_BOM_POSTINGS_SAP = "order_bom_postings_sap"
    SERIAL_BINDINGS_SAP = "serial_bindings_sap"
    REPAIR_RECORDS_SAP = "repair_records_sap"
    STATION_RECORDS_SAP = "station_records_sap"
    ASSEMBLY_RECORDS = "assembly_records"
    SCS_DOA_RESULTS = "scs_doa_results"
    # SCS 换上换下（换件登记）采集结果，与 scs_doa_results 通过 data.服务单号 关联
    SCS_CHANGE_RESULTS = "scs_change_results"
