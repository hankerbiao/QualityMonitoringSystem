"""Contracts for FA application previews and submissions."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Stage = Literal["产测", "DOA"]


class FAMaterialVendorCacheUpdate(BaseModel):
    pn: str = Field(min_length=1, max_length=80)
    vendor: str = Field(min_length=1, max_length=120)

    @field_validator("pn", "vendor")
    @classmethod
    def trim_values(cls, value: str) -> str:
        return value.strip()


class FAPreviewRequest(BaseModel):
    pn: str = Field(min_length=1, max_length=80)
    vendor: str = Field(default="", max_length=120)
    faultDescription: str = Field(default="", max_length=2_000)
    stages: list[Stage] = Field(min_length=1, max_length=2)
    repairDateFrom: date | None = None
    repairDateTo: date | None = None
    doaDateFrom: date | None = None
    doaDateTo: date | None = None

    @field_validator("pn")
    @classmethod
    def normalize_pn(cls, value: str) -> str:
        return value.strip()

    @field_validator("vendor", "faultDescription")
    @classmethod
    def trim_text_fields(cls, value: str) -> str:
        return value.strip()

    @field_validator("stages")
    @classmethod
    def unique_stages(cls, value: list[Stage]) -> list[Stage]:
        return list(dict.fromkeys(value))

    @model_validator(mode="after")
    def validate_ranges(self):
        if "产测" in self.stages:
            self._validate_range(self.repairDateFrom, self.repairDateTo, "产测计划开始时间")
        if "DOA" in self.stages:
            self._validate_range(self.doaDateFrom, self.doaDateTo, "DOA 操作时间")
        return self

    @staticmethod
    def _validate_range(start: date | None, end: date | None, label: str) -> None:
        if not start or not end:
            raise ValueError(f"{label}开始和结束日期必填")
        if end < start:
            raise ValueError(f"{label}结束日期不能早于开始日期")
        if (end - start).days > 366:
            raise ValueError(f"{label}范围不能超过 367 天")


class FACreateRequest(FAPreviewRequest):
    selectedRepairIds: list[str] = Field(max_length=5_000)
    selectedDoaIds: list[str] = Field(max_length=5_000)


class FAEmailRequest(BaseModel):
    to: list[str] = Field(min_length=1, max_length=100)
    cc: list[str] = Field(default_factory=list, max_length=100)
    subject: str = Field(default="", max_length=300)
    content: str = Field(default="", max_length=20_000)


class FASubmitRequest(BaseModel):
    application: FACreateRequest
    email: FAEmailRequest


class FAApplicationListResponse(BaseModel):
    items: list[dict]
    total: int
    page: int
    pageSize: int
