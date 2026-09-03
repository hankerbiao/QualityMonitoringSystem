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
from app.services.data_gateway_client import DataGatewayError, data_gateway

router = APIRouter()


class MetadataColumn(BaseModel):
    key: str
    label: str


class MetadataFilter(BaseModel):
    key: str
    label: str
    field: str


class MetadataTableDefinition(BaseModel):
    key: str
    title: str
    description: str
    columns: list[MetadataColumn]
    filters: list[MetadataFilter] = Field(default_factory=list)


class MetadataTableResponse(MetadataTableDefinition):
    total: int
    page: int
    page_size: int
    has_more: bool
    search: str
    rows: list[dict[str, Any]] = Field(default_factory=list)


TABLE_DEFINITIONS: dict[str, MetadataTableDefinition] = {
    Collections.MACHINE_INFO: MetadataTableDefinition(
        key=Collections.MACHINE_INFO,
        title="整机信息",
        description="MES 整机序列号、订单、基地与产品机型信息。",
        columns=[
            MetadataColumn(key="sn", label="整机序列号"),
            MetadataColumn(key="sale_no", label="销售订单"),
            MetadataColumn(key="mfg_order", label="生产订单"),
            MetadataColumn(key="factory", label="生产基地"),
            MetadataColumn(key="product_family", label="产品机型"),
            MetadataColumn(key="s_MFGLINENAME", label="产线"),
            MetadataColumn(key="customer_id", label="客户"),
        ],
    ),
    Collections.SALES_ORDERS_SAP: MetadataTableDefinition(
        key=Collections.SALES_ORDERS_SAP,
        title="SAP 销售订单",
        description="SAP 销售订单与生产订单原始数据，支撑 MFR 保有量计算。",
        columns=[
            MetadataColumn(key="aufnr", label="生产订单"),
            MetadataColumn(key="data.VBELN", label="销售订单"),
            MetadataColumn(key="data.MAKTX_TH", label="机型"),
            MetadataColumn(key="data.NAME1_ZU", label="客户"),
            MetadataColumn(key="data.WMENG", label="入库数量"),
            MetadataColumn(key="data.GSTRS", label="计划开始"),
            MetadataColumn(key="data.ZSTAT", label="订单状态"),
            MetadataColumn(key="data.AUART", label="订单类型"),
            MetadataColumn(key="data.IF_L6", label="L6 标识"),
            MetadataColumn(key="last_synced_at", label="同步时间"),
        ],
    ),
    Collections.SCS_DOA_RESULTS: MetadataTableDefinition(
        key=Collections.SCS_DOA_RESULTS,
        title="SCS 服务单",
        description="SCS 服务单原始字段、销售订单关联及生命周期补采数据。",
        columns=[
            MetadataColumn(key="data.服务单号", label="服务单号"),
            MetadataColumn(key="scs_enrichment.sales_order", label="销售订单"),
            MetadataColumn(key="data.客户全称", label="客户"),
            MetadataColumn(key="data.产品/备件名称", label="产品/备件"),
            MetadataColumn(key="data.曙光S/N", label="整机 SN"),
            MetadataColumn(key="data.备件S/N", label="备件 SN"),
            MetadataColumn(key="data.受理时间", label="受理时间"),
            MetadataColumn(key="data.发货日期", label="发货日期"),
            MetadataColumn(key="data.判定结果", label="判定结果"),
            MetadataColumn(key="data.处理状态", label="处理状态"),
            MetadataColumn(key="data.出厂日期", label="出厂日期"),
            MetadataColumn(key="data.保修结束日期", label="保修结束日期"),
            MetadataColumn(key="scs_enrichment.factory_date", label="补采出厂日期"),
            MetadataColumn(key="scs_enrichment.warranty_end_date", label="补采过保日期"),
            MetadataColumn(key="scs_enrichment.status", label="补全状态"),
        ],
        filters=[
            MetadataFilter(key="salesOrder", label="销售订单", field="scs_enrichment.sales_order"),
        ],
    ),
    Collections.SCS_CHANGE_RESULTS: MetadataTableDefinition(
        key=Collections.SCS_CHANGE_RESULTS,
        title="SCS 换件登记",
        description="MFR 故障分子使用的换上记录原始数据。",
        columns=[
            MetadataColumn(key="data.服务单号", label="服务单号"),
            MetadataColumn(key="data.操作类型", label="操作类型"),
            MetadataColumn(key="data.操作时间", label="操作时间"),
            MetadataColumn(key="data.报修设备", label="报修设备"),
            MetadataColumn(key="data.PN", label="物料 PN"),
            MetadataColumn(key="data.SN", label="物料 SN"),
            MetadataColumn(key="data.是否撤销", label="是否撤销"),
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


def _table_query(
    definition: MetadataTableDefinition,
    search: str,
    filter_values: dict[str, str | None],
) -> dict[str, Any]:
    clauses: list[dict[str, Any]] = []
    search_query = _search_query(definition, search)
    if search_query:
        clauses.append(search_query)
    for table_filter in definition.filters:
        value = (filter_values.get(table_filter.key) or "").strip()
        if value:
            clauses.append({table_filter.field: {"$regex": re.escape(value), "$options": "i"}})
    if not clauses:
        return {}
    return clauses[0] if len(clauses) == 1 else {"$and": clauses}


def _serialize_value(value: Any) -> Any:
    if isinstance(value, Decimal128):
        return str(value)
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _serialize_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_serialize_value(item) for item in value]
    if isinstance(value, bytes):
        return value.hex()
    return value


def _serialize_row(row: dict[str, Any]) -> dict[str, Any]:
    return {key: _serialize_value(value) for key, value in row.items() if key != "_id"}


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
    productionOrder: str | None = Query(None, max_length=80),
    salesOrder: str | None = Query(None, max_length=80),
    productModel: str | None = Query(None, max_length=80),
) -> MetadataTableResponse:
    definition = TABLE_DEFINITIONS.get(table_name)
    if definition is None:
        raise HTTPException(status_code=404, detail="不支持查看该数据表")

    if data_gateway.enabled and table_name == Collections.SALES_ORDERS_SAP:
        try:
            payload = await data_gateway.orders(
                page=page,
                page_size=page_size,
                keyword=search.strip(),
            )
        except DataGatewayError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        raw_rows = [
            row.get("raw", row) if isinstance(row, dict) else {} for row in payload.get("items", [])
        ]
        total = int(payload.get("total") or len(raw_rows))
        return MetadataTableResponse(
            **definition.model_dump(),
            total=total,
            page=int(payload.get("page") or page),
            page_size=int(payload.get("pageSize") or page_size),
            has_more=int(payload.get("page") or page) * int(payload.get("pageSize") or page_size)
            < total,
            search=search.strip(),
            rows=[_serialize_row(row) for row in raw_rows],
        )

    collection = get_database()[table_name]
    query = _table_query(
        definition,
        search.strip(),
        {
            "productionOrder": productionOrder,
            "salesOrder": salesOrder,
            "productModel": productModel,
        },
    )
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
