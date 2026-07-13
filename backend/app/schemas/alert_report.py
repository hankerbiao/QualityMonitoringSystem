"""
告警报表相关模型
"""
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.rty import DefectDetail


class AlertContext(BaseModel):
    """告警上下文: 触发报表的过滤条件 + 展示元信息（写入签名 token）"""

    # 过滤条件（与 RTY 聚合一致）
    productModel: Optional[str] = Field(None, description="生产机型 (product_family)")
    base: Optional[str] = Field(None, description="基地 (factory)")
    customer: Optional[str] = Field(None, description="客户 (customer_id)")
    salesOrder: Optional[str] = Field(None, description="销售订单号")
    productionOrder: Optional[str] = Field(None, description="生产订单号")
    serialNumber: Optional[str] = Field(None, description="整机序列号")
    dateFrom: Optional[str] = Field(None, description="开始时间 (actual_start_time)")
    dateTo: Optional[str] = Field(None, description="结束时间 (actual_start_time)")

    # 展示元信息（仅用于页面呈现，可选）
    alertType: str = Field("RTY 未达标", description="告警类型")
    severity: str = Field("严重", description="严重级别: 严重/警告/提示")
    title: Optional[str] = Field(None, description="自定义标题")


class AlertReportSummary(BaseModel):
    """报表概要 KPI"""

    rtyRate: float = 0
    targetRate: float = 100
    defectCount: int = 0
    inputCount: int = 0
    productModel: str = ""
    base: str = ""
    customer: str = ""
    periodFrom: Optional[str] = None
    periodTo: Optional[str] = None
    reached: bool = True  # 是否达成指标


class AlertReportData(BaseModel):
    """告警报表完整数据（公开接口返回）"""

    context: AlertContext
    summary: AlertReportSummary
    defects: list[DefectDetail] = Field(default_factory=list)
    generatedAt: str = ""
    expiresAt: str = ""
