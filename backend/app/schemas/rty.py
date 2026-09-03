"""
RTY (整机综合直通率) 相关 Pydantic 模型
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ============== RTY 数据模型 ==============


class RTYDataBase(BaseModel):
    """RTY 数据基础模型"""

    time: str = Field(..., description="统计时间 (YYYY-MM-DD)")
    model: str = Field(..., description="数据口径: 销售订单 WMENG 入库数量")
    productModel: str = Field(..., description="生产机型 (sales_orders_sap.data.MAKTX_TH)")
    customer: str = Field("", description="客户 ID (sales_orders_sap.data.KID)")
    base: str = Field(..., description="基地/库位 (sales_orders_sap.data.LGORT)")
    defectCount: int = Field(..., ge=0, description="故障数量")
    inputCount: int = Field(..., ge=0, description="生产数量 (sales_orders_sap.data.WMENG 汇总)")
    rtyRate: float = Field(..., ge=0, le=100, description="直通率百分比, 如 98.5")
    targetRate: float = Field(..., ge=0, le=100, description="目标直通率百分比")
    salesOrder: str = Field("", description="销售订单号 (sales_orders_sap.data.VBELN)")
    productionOrder: str = Field("", description="生产订单号 (sales_orders_sap.aufnr)")
    productLine: str = Field("", description="产线，当前 RTY 数据源未提供")
    status: str = Field("", description="达成状态 (rate_status): 已达成/未达成")


class RTYData(RTYDataBase):
    """RTY 数据响应模型"""

    id: str = Field(..., description="记录ID")
    serialNumbers: list[str] = Field(default_factory=list, description="整机序列号列表")
    salesOrders: list[str] = Field(default_factory=list, description="销售订单号列表（聚合时返回）")
    productionOrders: list[str] = Field(
        default_factory=list, description="生产订单号列表（聚合时返回）"
    )

    model_config = ConfigDict(from_attributes=True)


class ExcludedOrder(BaseModel):
    """One sales order excluded from RTY statistics and its reason."""

    id: str
    time: str = ""
    salesOrder: str = ""
    productionOrder: str = ""
    productModel: str = ""
    customer: str = ""
    base: str = ""
    orderStatus: str = ""
    orderType: str = ""
    exclusionReasons: list[str] = Field(default_factory=list)


class RTYListResponse(BaseModel):
    """RTY 列表响应"""

    items: list[RTYData]
    total: int
    page: int = 1
    limit: int = 100


class StationPassRate(BaseModel):
    """工位过站直通率：过站 SN 为分母，匹配工位的维修 SN 为故障数。"""

    dimensionValue: str = Field(..., description="统计维度值，如销售订单号、生产订单号或机型")
    stationCode: str = Field(
        ..., description="工位编码，取 SPEC / ZNGGZ 冒号前且最后一个 '-' 后的值"
    )
    stationName: str = Field("", description="工位名称")
    inputCount: int = Field(..., ge=0, description="该工位去重后的过站 SN 数")
    defectCount: int = Field(..., ge=0, description="该工位去重后的维修 SN 数")
    passRate: float = Field(..., ge=0, le=100, description="过站直通率百分比")


class StationPassDetail(BaseModel):
    """工位过站/维修 SN 明细。"""

    id: str
    sn: str
    stationCode: str
    stationName: str = ""
    passDate: str = ""
    status: Literal["passed", "defect"]
    repairTime: str = ""
    defectCode: str = ""
    description: str = ""
    repairPerson: str = ""


# ============== 故障明细模型 ==============


class DefectDetailBase(BaseModel):
    """故障明细基础模型"""

    defectCode: str = Field(..., description="故障代码")
    description: str = Field(..., description="故障描述")
    count: int = Field(..., ge=0, description="故障数量")
    sn: str = Field("", description="机器序列号")
    sale_no: str = Field("", description="销售订单号")
    mfg_order: str = Field("", description="生产订单号")
    product_family: str = Field("", description="产品机型")
    fault_2nd_appear: str = Field("", description="二次故障现象")
    fault_3rd_appear: str = Field("", description="三次故障现象")
    repairTime: str = Field("", description="维修时间")
    repairPerson: str = Field("", description="维修人")
    repair_effectiveness: str = Field("", description="维修有效性")
    customer: str = Field("", description="维修记录回填的客户名称")


class DefectDetail(DefectDetailBase):
    """故障明细响应模型 (数据取自 fault_info 集合)"""

    id: str = Field(..., description="明细ID")

    model_config = ConfigDict(from_attributes=True)


# ============== 周期统计数据模型 ==============


# ============== 销售订单汇总模型 ==============


class SalesOrderSummary(BaseModel):
    """销售订单汇总数据"""

    salesOrder: str = Field(..., description="销售订单号")
    inputCount: int = Field(..., ge=0, description="投入数量（机器总数）")
    defectCount: int = Field(..., ge=0, description="故障数量（去重SN后）")
    rtyRate: float = Field(..., ge=0, le=100, description="直通率百分比")
