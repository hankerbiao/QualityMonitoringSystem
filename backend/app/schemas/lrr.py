"""Pydantic models for the material-PN LRR dashboard."""

from pydantic import BaseModel, Field


class LRRData(BaseModel):
    id: str = ""
    month: str = ""
    materialNumber: str = ""
    materialDescription: str = ""
    issuedQuantity: float = 0.0
    faultCount: int = 0
    lrrRate: float | None = None


class LRRSummary(BaseModel):
    materialCount: int = 0
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
    materialNumbers: list[str] = Field(default_factory=list)
    productModels: list[str] = Field(default_factory=list)
    bases: list[str] = Field(default_factory=list)
    customerIds: list[str] = Field(default_factory=list)


class LRRFaultDetail(BaseModel):
    month: str = ""
    materialNumber: str = ""
    materialDescription: str = ""
    sn: str = ""
    faultType: str = ""
    faultDesc: str = ""
    ngTime: str = ""
