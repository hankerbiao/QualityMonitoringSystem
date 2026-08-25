"""Metadata table browsing API for SAP raw collections."""

import re
from datetime import date, datetime
from typing import Annotated, Any

from bson import Decimal128, ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.auth import get_current_user
from app.db.mongodb import get_database
from app.models.documents import Collections

router = APIRouter()


class MetadataColumn(BaseModel):
    key: str
    label: str


class MetadataTableDefinition(BaseModel):
    key: str
    title: str
    description: str
    columns: list[MetadataColumn]


class MetadataTableResponse(MetadataTableDefinition):
    total: int
    page: int
    page_size: int
    has_more: bool
    search: str
    rows: list[dict[str, Any]] = Field(default_factory=list)


TABLE_DEFINITIONS: dict[str, MetadataTableDefinition] = {
    Collections.ORDER_BOM_POSTINGS_SAP: MetadataTableDefinition(
        key=Collections.ORDER_BOM_POSTINGS_SAP,
        title="订单 BOM 发料",
        description="SAP 生产订单 BOM 发料与过账明细。",
        columns=[
            MetadataColumn(key="AUFNR_1", label="生产订单"),
            MetadataColumn(key="VBELN_EX", label="销售订单"),
            MetadataColumn(key="MATNR", label="物料编码"),
            MetadataColumn(key="MAKTX", label="物料描述"),
            MetadataColumn(key="MENGE", label="发料数量"),
            MetadataColumn(key="BUDAT_MKPF", label="过账日期"),
            MetadataColumn(key="LGORT", label="库存地点"),
            MetadataColumn(key="WERKS", label="工厂"),
            MetadataColumn(key="TYPE", label="记录类型"),
            MetadataColumn(key="_synced_at", label="同步时间"),
        ],
    ),
    Collections.SERIAL_BINDINGS_SAP: MetadataTableDefinition(
        key=Collections.SERIAL_BINDINGS_SAP,
        title="序列号绑定",
        description="SAP 序列号、生产订单与产品层次绑定关系。",
        columns=[
            MetadataColumn(key="ZCODE_HEAD", label="整机序列号"),
            MetadataColumn(key="ZCODE_ITEM", label="部件序列号"),
            MetadataColumn(key="AUFNR_HEAD", label="整机生产订单"),
            MetadataColumn(key="AUFNR_ITEM", label="部件生产订单"),
            MetadataColumn(key="PRODH", label="产品层次"),
            MetadataColumn(key="_source_view", label="来源视图"),
            MetadataColumn(key="_synced_at", label="同步时间"),
        ],
    ),
    Collections.REPAIR_RECORDS_SAP: MetadataTableDefinition(
        key=Collections.REPAIR_RECORDS_SAP,
        title="维修记录",
        description="SAP/MES 维修记录、故障描述与处理结果明细。",
        columns=[
            MetadataColumn(key="PCODE", label="产品序列号"),
            MetadataColumn(key="AUFNR", label="生产订单"),
            MetadataColumn(key="VBELN", label="销售订单"),
            MetadataColumn(key="ZJXMC", label="机型"),
            MetadataColumn(key="ZBJ", label="部件"),
            MetadataColumn(key="ZNGWD", label="故障现象"),
            MetadataColumn(key="ZWXWD", label="维修现象"),
            MetadataColumn(key="ZDATE_WX", label="维修日期"),
            MetadataColumn(key="ZSOURCE", label="数据来源"),
            MetadataColumn(key="_synced_at", label="同步时间"),
        ],
    ),
    Collections.STATION_RECORDS_SAP: MetadataTableDefinition(
        key=Collections.STATION_RECORDS_SAP,
        title="工位过站记录",
        description="SAP/MES 工位过站、工序状态与实际开始结束时间。",
        columns=[
            MetadataColumn(key="PCODE", label="产品序列号"),
            MetadataColumn(key="AUFNR", label="生产订单"),
            MetadataColumn(key="SPEC", label="工位编码"),
            MetadataColumn(key="SPEC_DESC", label="工位名称"),
            MetadataColumn(key="OPERATION", label="操作类型"),
            MetadataColumn(key="ACTUAL_START_TIME", label="实际开始时间"),
            MetadataColumn(key="ACTUAL_END_TIME", label="实际结束时间"),
            MetadataColumn(key="MAKTX_TH", label="机型"),
            MetadataColumn(key="LGORT", label="库存地点"),
            MetadataColumn(key="UNAME", label="操作人"),
            MetadataColumn(key="_synced_at", label="同步时间"),
        ],
    ),
}


def _search_query(definition: MetadataTableDefinition, search: str) -> dict[str, Any]:
    if not search:
        return {}
    escaped = re.escape(search)
    return {
        "$or": [
            {column.key: {"$regex": escaped, "$options": "i"}}
            for column in definition.columns
            if not column.key.startswith("_")
        ]
    }


def _serialize_value(value: Any) -> Any:
    if isinstance(value, Decimal128):
        return str(value)
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _serialize_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_serialize_value(item) for item in value]
    if isinstance(value, bytes):
        return value.hex()
    return value


def _serialize_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: _serialize_value(value)
        for key, value in row.items()
        if key != "_id"
    }


@router.get("/tables", response_model=list[MetadataTableDefinition])
async def list_metadata_tables(
    _: Annotated[dict, Depends(get_current_user)],
) -> list[MetadataTableDefinition]:
    return list(TABLE_DEFINITIONS.values())


@router.get("/tables/{table_name}", response_model=MetadataTableResponse)
async def get_metadata_table(
    table_name: str,
    _: Annotated[dict, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=10, le=100),
    search: str = Query("", max_length=80),
) -> MetadataTableResponse:
    definition = TABLE_DEFINITIONS.get(table_name)
    if definition is None:
        raise HTTPException(status_code=404, detail="不支持查看该数据表")

    collection = get_database()[table_name]
    query = _search_query(definition, search.strip())
    if query:
        total = await collection.count_documents(query)
    else:
        total = await collection.estimated_document_count()

    cursor = collection.find(query, projection={"_id": 0})
    cursor = cursor.skip((page - 1) * page_size).limit(page_size)
    rows = [_serialize_row(row) async for row in cursor]
    return MetadataTableResponse(
        **definition.model_dump(),
        total=total,
        page=page,
        page_size=page_size,
        has_more=page * page_size < total,
        search=search.strip(),
        rows=rows,
    )
