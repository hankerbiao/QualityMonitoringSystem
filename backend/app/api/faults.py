"""故障信息 API

提供 fault_info 集合的分页查询接口，按销售订单分组展示，用于前端故障列表弹窗。
"""

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.common import Response

router = APIRouter()


class FaultGroup(BaseModel):
    """按销售订单分组的故障组"""
    sale_no: str
    fault_count: int
    faults: list[dict]


class FaultGroupResponse(BaseModel):
    """分组故障列表响应"""
    groups: list[FaultGroup]
    total: int          # 有故障的销售订单总数（组数）
    total_faults: int   # 故障总数（所有故障条数）
    page: int
    page_size: int


@router.get("/faults", response_model=Response[FaultGroupResponse])
async def list_fault_groups(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页组数"),
    search: str = Query("", description="搜索关键字（匹配 SN / 故障描述 / 物料名）"),
):
    """按销售订单分组查询故障信息"""
    db = get_database()
    col = db[Collections.FAULT_INFO]

    match_stage: dict = {}
    if search:
        import re
        escaped = re.escape(search)
        match_stage = {
            "$or": [
                {"sn": {"$regex": escaped, "$options": "i"}},
                {"fault_desc": {"$regex": escaped, "$options": "i"}},
                {"fault_category": {"$regex": escaped, "$options": "i"}},
                {"product_name": {"$regex": escaped, "$options": "i"}},
            ]
        }

    # 构建分组 pipeline
    pipeline: list[dict] = []
    if match_stage:
        pipeline.append({"$match": match_stage})
    pipeline.extend([
        {"$sort": {"repair_time": -1}},
        {"$group": {
            "_id": "$sale_no",
            "faults": {"$push": "$$ROOT"},
            "fault_count": {"$sum": 1},
        }},
        {"$sort": {"fault_count": -1}},
    ])

    # 总组数（有故障的订单数）
    count_pipeline = [{"$match": match_stage}] if match_stage else []
    count_pipeline.append({"$group": {"_id": "$sale_no"}})
    count_pipeline.append({"$count": "total"})
    count_result = await col.aggregate(count_pipeline).to_list(length=1)
    total_groups = count_result[0]["total"] if count_result else 0

    # 总故障条数（全部匹配的故障文档数）
    total_faults = await col.count_documents(match_stage)

    # 分页
    skip = (page - 1) * page_size
    page_pipeline = [
        *pipeline,
        {"$skip": skip},
        {"$limit": page_size},
        {"$project": {"sale_no": "$_id", "faults": 1, "fault_count": 1, "_id": 0}},
    ]

    groups_raw = await col.aggregate(page_pipeline).to_list(length=page_size)

    groups = [
        FaultGroup(
            sale_no=g["sale_no"] or "(空)",
            fault_count=g["fault_count"],
            faults=[{k: v for k, v in f.items() if k != "_id"} for f in g["faults"]],
        )
        for g in groups_raw
    ]

    return Response(success=True, data=FaultGroupResponse(
        groups=groups,
        total=total_groups,
        total_faults=total_faults,
        page=page,
        page_size=page_size,
    ))
