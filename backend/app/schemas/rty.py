"""
RTY (整机综合直通率) 相关 Pydantic 模型
"""
from datetime import datetime

from pydantic import BaseModel, Field

# ============== RTY 数据模型 ==============

class RTYDataBase(BaseModel):
    """RTY 数据基础模型"""
    time: str = Field(..., description="统计时间 (YYYY-MM-DD)")
    model: str = Field(..., description="计算方法: 普通机型/复合机型/Qiandaohu一拖多机型")
    productModel: str = Field(..., description="生产机型")
    customer: str = Field("", description="客户名称 (MES无此字段,留空)")
    base: str = Field(..., description="基地: 天津/昆山/桐乡/大同")
    defectCount: int = Field(..., ge=0, description="故障数量")
    inputCount: int = Field(..., ge=0, description="投入数量")
    rtyRate: float = Field(..., ge=0, le=100, description="直通率百分比, 如 98.5")
    targetRate: float = Field(..., ge=0, le=100, description="目标直通率百分比")
    # 以下为 MES 额外字段
    salesOrder: str = Field("", description="销售单号 (s_SALENO)")
    productionOrder: str = Field("", description="生产订单号 (mfgordername)")
    productLine: str = Field("", description="产线名称 (s_MFGLINENAME)")
    orderType: str = Field("", description="订单类型 (ordertypename)")
    planStartDate: str = Field("", description="计划开始日期 (plannedstartdate)")
    planEndDate: str = Field("", description="计划结束时间 (s_Mes_Planendtime)")
    status: str = Field("", description="达成状态 (rate_status): 已达成/未达成")


class RTYDataCreate(RTYDataBase):
    """创建 RTY 数据"""
    pass


class RTYData(RTYDataBase):
    """RTY 数据响应模型"""
    id: str = Field(..., description="记录ID")
    serialNumbers: list[str] = Field(default_factory=list, description="整机序列号列表")
    salesOrders: list[str] = Field(default_factory=list, description="销售订单号列表（聚合时返回）")
    productionOrders: list[str] = Field(default_factory=list, description="生产订单号列表（聚合时返回）")

    class Config:
        from_attributes = True


class RTYDataInDB(RTYDataBase):
    """存储在数据库中的 RTY 数据"""
    id: str = Field(..., alias="_id")
    createdAt: datetime | None = None
    updatedAt: datetime | None = None
    # MES 额外字段
    salesOrder: str = Field("", description="销售单号 (s_SALENO)")
    productionOrder: str = Field("", description="生产订单号 (mfgordername)")
    productLine: str = Field("", description="产线名称 (s_MFGLINENAME)")
    orderType: str = Field("", description="订单类型 (ordertypename)")
    planStartDate: str = Field("", description="计划开始日期 (plannedstartdate)")
    planEndDate: str = Field("", description="计划结束时间 (s_Mes_Planendtime)")
    status: str = Field("", description="达成状态 (rate_status): 已达成/未达成")


class RTYFilterParams(BaseModel):
    """RTY 查询过滤参数"""
    statMethod: str | None = Field(None, description="统计方式: 整体直通率/过站直通率")
    dateRange: dict[str, datetime | None] | None = Field(
        None,
        description="日期范围: {from: datetime, to: datetime}"
    )
    model: str | None = Field(None, description="计算方法筛选")
    productModel: str | None = Field(None, description="生产机型筛选")
    customer: str | None = Field(None, description="客户名称筛选")
    base: str | None = Field(None, description="基地筛选")
    salesOrder: str | None = Field(None, description="销售订单号筛选")
    productionOrder: str | None = Field(None, description="生产订单号筛选")
    serialNumber: str | None = Field(None, description="整机序列号筛选")


class RTYListResponse(BaseModel):
    """RTY 列表响应"""
    items: list[RTYData]
    total: int
    page: int = 1
    limit: int = 100


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


class DefectDetail(DefectDetailBase):
    """故障明细响应模型 (数据取自 fault_info 集合)"""
    id: str = Field(..., description="明细ID")

    class Config:
        from_attributes = True


# ============== 周期统计数据模型 ==============

class CycleStatsResponse(BaseModel):
    """周期统计响应"""
    totalInput: int = Field(..., description="周期内累计投入")
    totalDefect: int = Field(..., description="周期内总故障数")
    avgRty: float = Field(..., description="综合平均直通率")
    maxInputMonth: str = Field(..., description="产量最高月份")
    highestRiskModel: str = Field(..., description="高风险机型 (故障率最高)")
    bestModel: str = Field(..., description="最佳表现机型 (RTY最高)")
    trendData: list[dict] = Field(default_factory=list, description="趋势数据")
    heatmapData: list[dict] = Field(default_factory=list, description="热力图数据")


# ============== 销售订单汇总模型 ==============

class SalesOrderSummary(BaseModel):
    """销售订单汇总数据"""
    salesOrder: str = Field(..., description="销售订单号")
    inputCount: int = Field(..., ge=0, description="投入数量（机器总数）")
    defectCount: int = Field(..., ge=0, description="故障数量（去重SN后）")
    rtyRate: float = Field(..., ge=0, le=100, description="直通率百分比")
