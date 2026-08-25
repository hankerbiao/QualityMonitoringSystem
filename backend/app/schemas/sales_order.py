"""
销售订单双来源同步相关 Pydantic 模型
"""

from datetime import date
from typing import Any

from pydantic import BaseModel, Field, model_validator

# ============== 请求模型 ==============


class SalesOrderSyncRequest(BaseModel):
    """销售订单同步请求：按 SAP 变更日期范围从 SG / KK 两个来源拉取数据"""

    start_date: date = Field(..., description="开始日期 (YYYY-MM-DD)")
    end_date: date = Field(..., description="结束日期 (YYYY-MM-DD)")
    prodh_list: list[str] | None = Field(
        None, description="产品层次过滤列表，为空或省略时不传给 SAP"
    )

    @model_validator(mode="after")
    def _validate_date_range(self) -> "SalesOrderSyncRequest":
        if self.start_date > self.end_date:
            raise ValueError("start_date must be before or equal to end_date")
        return self


# ============== 响应模型 ==============


class SourceSyncResult(BaseModel):
    """单个 SAP 来源的同步结果统计"""

    success: bool = True
    fetched_count: int = Field(0, description="该来源返回的总记录数（含重复/缺 AUFNR）")
    unique_count: int = Field(0, description="按 AUFNR 去重后的有效记录数")
    skipped_count: int = Field(0, description="缺少或为空 AUFNR 而被跳过的记录数")
    error: str | None = Field(None, description="失败时的错误信息")


class DateRange(BaseModel):
    """同步使用的日期范围"""

    start_date: str
    end_date: str


class SalesOrderDocument(BaseModel):
    """按 AUFNR 去重后的订单文档（来自 MongoDB sales_orders_sap）"""

    id: str
    aufnr: str
    data: dict[str, Any] = Field(default_factory=dict)
    source_records: dict[str, Any] = Field(default_factory=dict)
    sources: list[str] = Field(default_factory=list)
    quantity: float = Field(0, description="归一化后的订单数量，源自 data.GAMNG")
    gstrs_date: str | None = Field(
        None, description="归一化后的计划开始日期 (YYYY-MM-DD)，源自 data.GSTRS"
    )
    first_seen_at: str | None = None
    last_synced_at: str | None = None
    sync_count: int = 0


# ============== 统计模型 ==============


class SalesOrderStatsItem(BaseModel):
    """单维度统计项"""

    key: str
    count: int


class SalesOrderStatsResponse(BaseModel):
    """销售订单多维度统计响应"""

    total: int = 0
    total_quantity: float = Field(0, description="机器总数量（quantity 求和，随筛选条件联动）")
    by_model: list[SalesOrderStatsItem] = Field(
        default_factory=list, description="按机型 (data.MAKTX_TH) 分组计数"
    )
    by_base: list[SalesOrderStatsItem] = Field(
        default_factory=list, description="按基地 (data.LGORT) 分组计数"
    )
    by_month: list[SalesOrderStatsItem] = Field(
        default_factory=list, description="按月份 (gstrs_date 截取 YYYY-MM) 分组计数"
    )


class SalesOrderFilterOptions(BaseModel):
    """Distinct values used by the sales-order filter controls."""

    models: list[str] = Field(default_factory=list)
    bases: list[str] = Field(default_factory=list)
    customers: list[str] = Field(default_factory=list)


class SalesOrdersQueryResponse(BaseModel):
    """Single response for the sales-order table, statistics, and options."""

    items: list[SalesOrderDocument] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    limit: int = 50
    has_more: bool = False
    stats: SalesOrderStatsResponse
    filterOptions: SalesOrderFilterOptions


class SalesOrderSyncResponse(BaseModel):
    """销售订单同步成功响应"""

    success: bool = True
    partial_success: bool = Field(False, description="仅部分来源成功时为 True")
    date_range: DateRange
    sources: dict[str, SourceSyncResult]
    total_fetched: int
    total_unique: int
    total_skipped: int
    inserted: int
    updated: int
    orders: list[SalesOrderDocument] = Field(default_factory=list)
