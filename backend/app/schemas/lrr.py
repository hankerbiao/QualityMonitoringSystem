"""Pydantic models for the order-BOM LRR dashboard."""

from pydantic import BaseModel, Field


class LRRData(BaseModel):
    id: str = ""
    orderDimension: str = "productionOrder"
    orderNo: str = ""
    productionOrder: str = ""
    salesOrder: str = ""
    issuedQuantity: float = 0.0
    faultCount: int = 0
    lrrRate: float | None = None


class LRRSummary(BaseModel):
    orderCount: int = 0
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


class LRRFaultDetailsResponse(BaseModel):
    items: list["LRRFaultDetail"] = Field(default_factory=list)
    total: int = 0
    truncated: bool = False


class LRROptions(BaseModel):
    productionOrders: list[str] = Field(default_factory=list)
    salesOrders: list[str] = Field(default_factory=list)
    storageLocations: list[str] = Field(default_factory=list)


class LRRFaultDetail(BaseModel):
    orderDimension: str = "productionOrder"
    orderNo: str = ""
    productionOrder: str = ""
    salesOrder: str = ""
    storageLocation: str = ""
    sn: str = ""
    faultType: str = ""
    faultDesc: str = ""
    repairTime: str = ""
