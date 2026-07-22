"""关键工位影像追溯实时查询模型。"""

from typing import Any, Literal

from pydantic import BaseModel, Field

ProcessRecordSource = Literal["all", "system1", "system2"]


class ProcessRecordPhoto(BaseModel):
    path: str


class ProcessRecordItem(BaseModel):
    key: str
    source: Literal["system1", "system2"]
    sourceName: str
    recordId: str
    sn: str = ""
    base: str = ""
    station: str = ""
    submittedAt: str = ""
    order: str = ""
    remarks: str = ""
    files: str = ""
    photos: list[ProcessRecordPhoto] = Field(default_factory=list)
    raw: dict[str, Any] = Field(default_factory=dict)


class ProcessRecordSourceResult(BaseModel):
    online: bool
    total: int = 0
    rows: list[ProcessRecordItem] = Field(default_factory=list)
    error: str | None = None


class ProcessRecordRealtimeData(BaseModel):
    queriedAt: str
    source: ProcessRecordSource
    page: int
    pageSize: int
    total: int
    rows: list[ProcessRecordItem]
    sources: dict[str, ProcessRecordSourceResult]


class ProcessRecordBaseOption(BaseModel):
    name: str
    sources: list[Literal["system1", "system2"]]


class ProcessRecordFilterOptions(BaseModel):
    bases: list[ProcessRecordBaseOption]
    system1Processes: list[str]


class SourceConnectionResult(BaseModel):
    source: Literal["system1", "system2"]
    name: str
    online: bool
    message: str


class ProcessRecordConnectionTest(BaseModel):
    success: bool
    sources: list[SourceConnectionResult]
