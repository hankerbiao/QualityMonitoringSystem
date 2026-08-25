"""SAP 整机 SN 关键节点查询模型。"""

from pydantic import BaseModel, Field, field_validator


class SnInfoRequest(BaseModel):
    """批量查询整机 SN。"""

    sn_list: list[str] = Field(..., alias="SN_LIST", min_length=1, max_length=1000)

    @field_validator("sn_list")
    @classmethod
    def normalize_sn_list(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for value in values:
            sn = value.strip()
            if not sn or sn in seen:
                continue
            seen.add(sn)
            normalized.append(sn)
        if not normalized:
            raise ValueError("SN_LIST 不能全部为空")
        return normalized

    model_config = {"populate_by_name": True}


class SnInfoItem(BaseModel):
    """SAP 返回的单台整机 SN 信息。"""

    pcode: str = Field("", alias="PCODE")
    aufnr: str = Field("", alias="AUFNR")
    matnr: str = Field("", alias="MATNR")
    maktx: str = Field("", alias="MAKTX")
    cdate_s: str = Field("", alias="CDATE_S")
    cdate_e: str = Field("", alias="CDATE_E")
    cdate_i: str = Field("", alias="CDATE_I")
    cdate_o: str = Field("", alias="CDATE_O")
    sources: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}


class SnInfoSourceResult(BaseModel):
    """单个 SAP 来源的查询结果。"""

    success: bool
    error: str | None = None
    fetched_count: int = 0


class SnInfoQueryResponse(BaseModel):
    """SN 查询聚合结果。"""

    requested_count: int
    matched_count: int
    items: list[SnInfoItem] = Field(default_factory=list)
    sources: dict[str, SnInfoSourceResult] = Field(default_factory=dict)
