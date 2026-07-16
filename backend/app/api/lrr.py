"""
LRR (工厂阶段部件故障率) API 路由

计算口径:
- 物料全集 = assembly_records.product_no ∪ fault_info.reinsert_lot（两边都取非空）
- 分子 (faultCount): fault_info 中 reinsert_lot == 该物料编号的记录数
- 分母 (totalCount): assembly_records 中 product_no == 该物料编号的数量
  - 纯故障物料（不在装配表）: totalCount = None, lrrRate = None
  - 纯装配物料（无故障）: faultCount = 0, lrrRate = 0.0

由于物料全集规模较小（通常 <500），采取全量拉取后在内存中组装+分页的方案，
避免 $facet 内存开销和跨集合分页复杂度。
"""
from fastapi import APIRouter, Query, Request

from app.core.logger import audit_log, log_info
from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.common import PaginatedResponse
from app.schemas.lrr import LRRData

router = APIRouter()


@router.get("/list", response_model=PaginatedResponse[LRRData])
@audit_log("QUERY", "lrr_list")
async def get_lrr_list(
    request: Request,
    page: int = Query(1, ge=1, description="页码"),
    limit: int = Query(50, ge=1, le=500, description="每页数量"),
    filter: str = Query("all", description="筛选: all-全部 / with_assembly-有装配扫号 / without_assembly-无装配扫号"),
):
    """
    获取 LRR (部件故障率) 列表。

    物料全集 = 装配表 product_no ∪ 故障表 reinsert_lot。
    对每类物料计算：故障数（分子）、总装配数（分母；无装配数据则为 None）。
    支持筛选：全部 / 仅有装配数据 / 仅纯故障物料。
    """
    db = get_database()
    assembly_col = db[Collections.ASSEMBLY_RECORDS]
    fault_col = db[Collections.FAULT_INFO]

    # 1) 分母: 全量物料分组
    assembly_pipeline: list[dict] = [
        {"$match": {"product_no": {"$nin": [None, ""]}}},
        {"$group": {
            "_id": "$product_no",
            "totalCount": {"$sum": 1},
            "materialDesc": {"$first": "$product_desc"},
        }},
    ]
    cursor = assembly_col.aggregate(assembly_pipeline)
    assembly_docs = await cursor.to_list(length=10000)
    assembly_map: dict[str, dict] = {}
    for d in assembly_docs:
        mid = d.get("_id")
        if mid:
            assembly_map[mid] = d

    # 2) 分子: 全量故障分组
    fault_pipeline: list[dict] = [
        {"$match": {"reinsert_lot": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$reinsert_lot", "faultCount": {"$sum": 1}}},
    ]
    cursor = fault_col.aggregate(fault_pipeline)
    fault_docs = await cursor.to_list(length=10000)
    fault_map: dict[str, int] = {}
    for d in fault_docs:
        rid = d.get("_id")
        if rid:
            fault_map[rid] = d.get("faultCount", 0)

    # 3) 组合物料全集: 装配物料 ∪ 故障物料
    all_materials: set[str] = set()
    all_materials.update(assembly_map.keys())
    all_materials.update(fault_map.keys())

    # 4) 分成两组: 有装配数据的 / 纯故障的
    with_assembly: list[LRRData] = []
    pure_fault: list[LRRData] = []
    for mat in sorted(all_materials):
        a = assembly_map.get(mat)
        total_count = a.get("totalCount", 0) if a else None
        desc = a.get("materialDesc", "") if a else ""
        fault_count = fault_map.get(mat, 0)
        if total_count is not None:
            lrr_rate = round(fault_count / total_count * 100, 2) if total_count > 0 else 0.0
        else:
            lrr_rate = None

        item = LRRData(
            id=mat,
            materialNo=mat,
            materialDesc=desc,
            totalCount=total_count,
            faultCount=fault_count,
            lrrRate=lrr_rate,
        )
        if total_count is not None:
            with_assembly.append(item)
        else:
            pure_fault.append(item)

    combined = with_assembly + pure_fault

    # 按 filter 参数筛选
    if filter == "with_assembly":
        combined = with_assembly
    elif filter == "without_assembly":
        combined = pure_fault

    total = len(combined)
    skip = (page - 1) * limit
    page_items = combined[skip: skip + limit]

    log_info(
        f"LRR 列表: 共 {total} 种物料 "
        f"(有装配数据 {len(with_assembly)} / 纯故障 {len(pure_fault)}), "
        f"筛选={filter}, 本页返回 {len(page_items)} 条"
    )
    return PaginatedResponse(
        items=page_items,
        total=total,
        page=page,
        limit=limit,
        has_more=(page * limit) < total,
    )
