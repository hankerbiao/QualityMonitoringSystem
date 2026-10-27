"""MFR (整机现网月化故障率) API models."""

from pydantic import BaseModel, Field


class MFRFilters(BaseModel):
    dateFrom: str
    dateTo: str
    model: str = ""


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
    warrantyDateCoverage: float = 0
    ordersWithWarrantyDates: int = 0
    ordersMissingWarrantyDates: int = 0


class MFRDashboardResponse(BaseModel):
    filters: MFRFilters
    summary: MFRSummary
    trend: list[MFRTrendItem] = Field(default_factory=list)
    dailyTrend: list[MFRDailyTrendItem] = Field(default_factory=list)
    byModel: list[MFRDimensionItem] = Field(default_factory=list)
