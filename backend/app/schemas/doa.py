"""DOA 报修率接口模型。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

TimeGranularity = Literal["year", "month", "day"]


class DoaFilters(BaseModel):
    dateFrom: str | None = None
    dateTo: str | None = None
    acceptedDateFrom: str | None = None
    acceptedDateTo: str | None = None
    customer: str | None = None
    model: str | None = None
    timeGranularity: TimeGranularity = "month"


class DoaDimensionItem(BaseModel):
    key: str
    shippedCount: float = 0
    repairCount: float = 0
    repairRate: float | None = None
    replacementCount: float = 0
    replacementRate: float | None = None


class DoaTrendItem(BaseModel):
    period: str
    shippedCount: float = 0
    repairCount: float = 0
    repairServerCount: int = 0
    repairRate: float | None = None
    replacementCount: float = 0
    replacementRate: float | None = None


class DoaSummary(BaseModel):
    shippedCount: float = 0
    repairCount: float = 0
    repairRate: float | None = None
    replacementCount: float = 0
    replacementRate: float | None = None
    replacementRecordCount: int = 0
    matchedRepairRecords: int = 0
    excludedRepairRecords: int = 0
    latestDataAt: datetime | None = None


class DoaDashboardResponse(BaseModel):
    filters: DoaFilters
    summary: DoaSummary
    trend: list[DoaTrendItem] = Field(default_factory=list)
    byCustomer: list[DoaDimensionItem] = Field(default_factory=list)
    byModel: list[DoaDimensionItem] = Field(default_factory=list)


class DoaRepairItem(BaseModel):
    id: str
    salesOrder: str = ""
    materialSerial: str = ""
    acceptedAt: str = ""
    customer: str = ""
    model: str = ""
    shippedDate: str = ""
    shippedCount: float = 0
    repairCount: float = 0
    data: dict = Field(default_factory=dict)


class DoaRepairsResponse(BaseModel):
    items: list[DoaRepairItem] = Field(default_factory=list)
    total: int = 0
    totalRepairCount: float = 0
    page: int = 1
    limit: int = 50
    has_more: bool = False


class DoaRawFilters(BaseModel):
    acceptedDateFrom: str | None = None
    acceptedDateTo: str | None = None
    keyword: str | None = None
    serviceNumber: str | None = None
    salesOrder: str | None = None
    serialNumber: str | None = None
    customer: str | None = None
    product: str | None = None
    doaType: str | None = None
    judgment: str | None = None
    processingStatus: str | None = None
