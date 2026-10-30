"""Pydantic models for the material-PN LRR dashboard."""

from typing import Literal

from pydantic import BaseModel, Field


class LRRData(BaseModel):
    id: str = ""
    month: str = ""
    materialNumber: str = ""
    materialDescription: str = ""
    issuedQuantity: float = 0.0
    faultCount: int | None = None
    lrrRate: float | None = None


class LRRSummary(BaseModel):
    materialCount: int = 0
    issuedQuantity: float = 0.0
    totalFaults: int | None = None
    overallLrr: float | None = None
    scope: Literal["usage", "page", "full"] = "full"


class LRRTrendPoint(BaseModel):
    month: str = ""
    issuedQuantity: float = 0.0
    faultCount: int | None = None
    lrrRate: float | None = None


class LRRMaterialRank(BaseModel):
    materialNumber: str = ""
    materialDescription: str = ""
    issuedQuantity: float = 0.0
    faultCount: int = 0
    lrrRate: float | None = None


class LRRListResponse(BaseModel):
    items: list[LRRData] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    limit: int = 50
    has_more: bool = False
    summary: LRRSummary = Field(default_factory=LRRSummary)
    trend: list[LRRTrendPoint] = Field(default_factory=list)
    hotspots: list[LRRMaterialRank] = Field(default_factory=list)


class LRRFaultDetailsResponse(BaseModel):
    items: list["LRRFaultDetail"] = Field(default_factory=list)
    total: int = 0
    truncated: bool = False


class LRROptions(BaseModel):
    materialNumbers: list[str] = Field(default_factory=list)
    productModels: list[str] = Field(default_factory=list)
    bases: list[str] = Field(default_factory=list)
    customerIds: list[str] = Field(default_factory=list)
    orderTypes: list[str] = Field(default_factory=list)


class LRRFaultDetail(BaseModel):
    month: str = ""
    materialNumber: str = ""
    materialDescription: str = ""
    sn: str = ""
    faultType: str = ""
    faultDesc: str = ""
    matchedModel: str = ""
    salesOrder: str = ""
    productionOrder: str = ""
    faultPhenomenon: str = ""
    repairAction: str = ""
    station: str = ""
    repairPerson: str = ""
    repairTime: str = ""
    ngTime: str = Field("", deprecated=True, description="已停用，保留空值兼容旧客户端")
