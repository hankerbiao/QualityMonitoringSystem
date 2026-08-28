"""Pydantic models for the order-BOM LRR dashboard."""

from pydantic import BaseModel, Field


class LRRData(BaseModel):
    id: str = ""
    materialNo: str = ""
    materialDesc: str = ""
    issuedQuantity: float = 0.0
    faultCount: int = 0
    lrrRate: float | None = None


class LRRSummary(BaseModel):
    materialKinds: int = 0
    issuedQuantity: float = 0.0
    totalFaults: int = 0
    overallLrr: float | None = None


class LRRListResponse(BaseModel):
    items: list[LRRData] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    limit: int = 50
    has_more: bool = False
    summary: LRRSummary = Field(default_factory=LRRSummary)


class LRROptions(BaseModel):
    productionOrders: list[str] = Field(default_factory=list)
    salesOrders: list[str] = Field(default_factory=list)
    storageLocations: list[str] = Field(default_factory=list)


class LRRFaultDetail(BaseModel):
    materialNo: str = ""
    materialDesc: str = ""
    productionOrder: str = ""
    salesOrder: str = ""
    storageLocation: str = ""
    sn: str = ""
    faultType: str = ""
    faultDesc: str = ""
    repairTime: str = ""
