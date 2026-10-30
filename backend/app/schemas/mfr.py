"""MFR (整机现网月化故障率) API models."""

from pydantic import BaseModel, Field


class MFRFilters(BaseModel):
    dateFrom: str
    dateTo: str
    model: str = ""
    customerId: str = ""
    customerIds: list[str] = Field(default_factory=list)


class MFRDimensionItem(BaseModel):
    key: str
    faultCount: int = 0
    fleetCount: float = 0
    mfrRate: float | None = None


class MFRTrendItem(MFRDimensionItem):
    period: str


class MFRDailyTrendItem(BaseModel):
    period: str
    faultCount: int = 0


class MFRSummary(BaseModel):
    faultCount: int = 0
    fleetCount: float = 0
    mfrRate: float | None = None
    warrantyDateCoverage: float | None = None
    ordersWithWarrantyDates: int | None = None
    ordersMissingWarrantyDates: int | None = None
    sourceDeviceCount: int = 0
    selectedDeviceCount: int = 0
    deviceIssues: dict[str, int] = Field(default_factory=dict)
    unmatchedChangeCount: int = 0


class MFRFaultDetail(BaseModel):
    model: str
    plannedDate: str
    shipmentDate: str
    productionOrder: str
    deviceSn: str
    serviceOrder: str
    changeId: str
    changeType: str
    occurredAt: str
    partNumber: str
    partSn: str
    partName: str
    customer: str


class MFRDashboardResponse(BaseModel):
    filters: MFRFilters
    summary: MFRSummary
    trend: list[MFRTrendItem] = Field(default_factory=list)
    dailyTrend: list[MFRDailyTrendItem] = Field(default_factory=list)
    byModel: list[MFRDimensionItem] = Field(default_factory=list)
    customerIds: list[str] = Field(default_factory=list)
    faultDetails: list[MFRFaultDetail] = Field(default_factory=list)
