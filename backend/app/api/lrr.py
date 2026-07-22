"""
LRR (工厂阶段部件故障率) API 路由

多维过滤设计(两步走):
  1. 先用机器级维度(基地/客户/机型/时间)过滤 machine_info, 得到命中的 sn 集合与 mfg_order 集合
     (assembly_records.mfg_order → machine_info.mfg_order 与 fault_info.sn → machine_info.sn 覆盖均 100%)。
  2. 再分别用这两个集合去 assembly_records(分母) 与 fault_info(分子) 做 $in 过滤并聚合。
  时间维度统一使用 machine_info.actual_start_time(机器生产时间), 保证分子分母在同一生产周期内。

计算口径:
- 物料全集 = assembly_records.product_no ∪ fault_info.reinsert_lot
- 分子 (faultCount):  fault_info 中 reinsert_lot == 该物料编号的记录数
- 分母 (totalCount):  assembly_records 中 product_no == 该物料编号的数量
  - 纯故障物料(不在装配表): totalCount = None, lrrRate = None
  - 纯装配物料(无故障): faultCount = 0, lrrRate = 0.0
"""
from fastapi import APIRouter, Query, Request

from app.core.logger import audit_log, log_info
from app.db.mongodb import get_database
from app.models.documents import Collections
from app.schemas.lrr import (
    LRRData,
    LRRDimensionStat,
    LRRFaultDetail,
    LRRListResponse,
    LRROptions,
    LRRSummary,
    LRRTrendPoint,
)

router = APIRouter()


def _build_time_match(date_from: str | None, date_to: str | None) -> dict | None:
    """根据日期范围构造 machine_info.actual_start_time 的字符串比较条件。

    actual_start_time 形如 '2026-05-26 19:36:06', 零填充, 可直接按字符串比较。
    """
    if not date_from and not date_to:
        return None
    m: dict = {}
    if date_from:
        m["$gte"] = f"{date_from} 00:00:00"
    if date_to:
        m["$lte"] = f"{date_to} 23:59:59"
    return m


def _bucket_of(ts: str | None, granularity: str) -> str:
    """把 actual_start_time 截取为 年/月/日 桶。"""
    if not ts or granularity in ("none", "", None):
        return ""
    if granularity == "year":
        return ts[:4]
    if granularity == "month":
        return ts[:7]
    if granularity == "day":
        return ts[:10]
    return ""


@router.get("/list", response_model=LRRListResponse)
@audit_log("QUERY", "lrr_list")
async def get_lrr_list(
    request: Request,
    page: int = Query(1, ge=1, description="页码"),
    limit: int = Query(50, ge=1, le=500, description="每页数量"),
    filter: str = Query("all", description="筛选: all-全部 / with_assembly-有装配扫号 / without_assembly-无装配扫号"),
    factory: str | None = Query(None, description="生产基地"),
    customer: str | None = Query(None, description="客户(customer_id)"),
    productFamily: str | None = Query(None, description="机型(product_family)"),
    partType: str | None = Query(None, description="部件类型(involved_component)"),
    partPN: str | None = Query(None, description="部件PN(reinsert_lot/product_no)"),
    faultType: str | None = Query(None, description="故障类型(fault_category)"),
    dateFrom: str | None = Query(None, description="生产开始日期 YYYY-MM-DD"),
    dateTo: str | None = Query(None, description="生产结束日期 YYYY-MM-DD"),
    timeGranularity: str = Query("none", description="时间趋势粒度: none/year/month/day"),
    sortBy: str = Query("lrrRate", description="排序字段: lrrRate/faultCount/totalCount/materialNo"),
    sortDir: str = Query("desc", description="排序方向: asc/desc"),
):
    """
    获取 LRR (部件故障率) 列表, 支持多维过滤 + 趋势 + 分组统计。

    - 机器级维度(基地/客户/机型/时间) 通过 machine_info 关联, 用于同时过滤分子与分母。
    - 部件类型/故障类型 仅作用于分子(故障侧)过滤。
    """
    db = get_database()
    mi_col = db[Collections.MACHINE_INFO]
    asm_col = db[Collections.ASSEMBLY_RECORDS]
    fault_col = db[Collections.FAULT_INFO]

    # ---------- 第一步: machine 维度过滤 → 命中 sn / mfg_order + 维度映射 ----------
    machine_match: dict = {}
    if factory:
        machine_match["factory"] = factory
    if customer:
        machine_match["customer_id"] = customer
    if productFamily:
        machine_match["product_family"] = productFamily
    time_match = _build_time_match(dateFrom, dateTo)
    if time_match:
        machine_match["actual_start_time"] = time_match

    matching_sns: set[str] = set()
    matching_mfg: set[str] = set()
    sn_to_dims: dict[str, dict] = {}
    mfg_to_dims: dict[str, dict] = {}

    cursor = mi_col.find(
        machine_match,
        {"sn": 1, "mfg_order": 1, "actual_start_time": 1, "factory": 1, "customer_id": 1, "product_family": 1},
    )
    async for m in cursor:
        sn = m.get("sn")
        mfg = m.get("mfg_order")
        dims = {
            "factory": m.get("factory") or "",
            "customer": m.get("customer_id") or "",
            "product_family": m.get("product_family") or "",
            "bucket": _bucket_of(m.get("actual_start_time"), timeGranularity),
        }
        if sn:
            matching_sns.add(sn)
            sn_to_dims[sn] = dims
        if mfg:
            matching_mfg.add(mfg)
            mfg_to_dims[mfg] = dims

    # ---------- 第二步: 分母(装配) 与 分子(故障) 聚合 ----------
    asm_match: dict = {
        "mfg_order": {"$in": list(matching_mfg)} if matching_mfg else {"$in": []},
        "product_no": {"$nin": [None, ""]},
    }
    if partPN:
        asm_match["product_no"] = partPN
    asm_cursor = asm_col.find(asm_match, {"product_no": 1, "mfg_order": 1, "product_desc": 1})
    assembly_map: dict[str, int] = {}        # pn -> 装配总数
    asm_desc: dict[str, str] = {}            # pn -> 物料描述
    asm_mfg_count: dict[str, int] = {}       # mfg_order -> 装配数(趋势/维度用)
    async for r in asm_cursor:
        pn = r.get("product_no")
        mfg = r.get("mfg_order")
        if not pn:
            continue
        assembly_map[pn] = assembly_map.get(pn, 0) + 1
        asm_desc.setdefault(pn, r.get("product_desc") or "")
        if mfg:
            asm_mfg_count[mfg] = asm_mfg_count.get(mfg, 0) + 1

    fault_match: dict = {
        "sn": {"$in": list(matching_sns)} if matching_sns else {"$in": []},
        "reinsert_lot": {"$nin": [None, ""]},
    }
    if partPN:
        fault_match["reinsert_lot"] = partPN
    if faultType:
        fault_match["fault_category"] = faultType
    if partType:
        fault_match["involved_component"] = partType
    fault_cursor = fault_col.find(fault_match, {"reinsert_lot": 1, "sn": 1, "fault_category": 1})
    fault_map: dict[str, int] = {}           # pn -> 故障数
    fault_sn_count: dict[str, int] = {}      # sn -> 故障数(趋势用)
    fault_type_count: dict[str, int] = {}    # fault_category -> 故障数(故障类型维度)
    async for f in fault_cursor:
        pn = f.get("reinsert_lot")
        sn = f.get("sn")
        ftype = f.get("fault_category") or ""
        if not pn:
            continue
        fault_map[pn] = fault_map.get(pn, 0) + 1
        if sn:
            fault_sn_count[sn] = fault_sn_count.get(sn, 0) + 1
        if ftype:
            fault_type_count[ftype] = fault_type_count.get(ftype, 0) + 1

    # ---------- 组合物料全集 ----------
    all_materials: set[str] = set(assembly_map.keys()) | set(fault_map.keys())
    with_assembly: list[LRRData] = []
    pure_fault: list[LRRData] = []
    for mat in sorted(all_materials):
        total = assembly_map.get(mat)
        fault = fault_map.get(mat, 0)
        if total is None:
            lrr = None
        elif total > 0:
            lrr = round(fault / total * 100, 2)
        else:
            lrr = 0.0
        item = LRRData(
            id=mat,
            materialNo=mat,
            materialDesc=asm_desc.get(mat, ""),
            totalCount=total,
            faultCount=fault,
            lrrRate=lrr,
        )
        if total is not None:
            with_assembly.append(item)
        else:
            pure_fault.append(item)

    combined = with_assembly + pure_fault
    if filter == "with_assembly":
        combined = with_assembly
    elif filter == "without_assembly":
        combined = pure_fault

    # ---------- 排序(null 始终排末尾) ----------
    def _sort_val(it: LRRData):
        return getattr(it, sortBy) if sortBy != "materialNo" else it.materialNo

    nulls = [it for it in combined if _sort_val(it) is None]
    nonnull = [it for it in combined if _sort_val(it) is not None]
    nonnull.sort(key=_sort_val, reverse=(sortDir == "desc"))
    combined = nonnull + nulls

    # ---------- 分页 ----------
    total = len(combined)
    skip = (page - 1) * limit
    page_items = combined[skip: skip + limit]

    # ---------- 汇总 + 趋势 + 维度统计(基于 filtered 全集) ----------
    total_asm = sum(assembly_map.values())
    total_fault = sum(fault_map.values())
    overall_lrr = round(total_fault / total_asm * 100, 2) if total_asm > 0 else None
    summary = LRRSummary(
        materialKinds=len(all_materials),
        withAssembly=len(with_assembly),
        withoutAssembly=len(pure_fault),
        totalAssemblies=total_asm,
        totalFaults=total_fault,
        overallLrr=overall_lrr,
    )

    # 时间趋势
    trend: list[LRRTrendPoint] = []
    if timeGranularity != "none":
        tb: dict[str, dict] = {}
        for mfg, cnt in asm_mfg_count.items():
            b = mfg_to_dims.get(mfg, {}).get("bucket", "")
            if b:
                d = tb.setdefault(b, {"a": 0, "f": 0})
                d["a"] += cnt
        for sn, cnt in fault_sn_count.items():
            b = sn_to_dims.get(sn, {}).get("bucket", "")
            if b:
                d = tb.setdefault(b, {"a": 0, "f": 0})
                d["f"] += cnt
        for b in sorted(tb):
            a = tb[b]["a"]
            f = tb[b]["f"]
            trend.append(LRRTrendPoint(
                period=b,
                totalAssemblies=a,
                totalFaults=f,
                lrrRate=round(f / a * 100, 2) if a > 0 else None,
            ))

    # 维度统计工厂函数
    def _dim_stats(key_field: str) -> list[LRRDimensionStat]:
        agg: dict[str, dict] = {}
        for mfg, cnt in asm_mfg_count.items():
            k = mfg_to_dims.get(mfg, {}).get(key_field, "")
            if not k:
                continue
            a = agg.setdefault(k, {"a": 0, "f": 0})
            a["a"] += cnt
        for sn, cnt in fault_sn_count.items():
            k = sn_to_dims.get(sn, {}).get(key_field, "")
            if not k:
                continue
            a = agg.setdefault(k, {"a": 0, "f": 0})
            a["f"] += cnt
        out = []
        for k, v in agg.items():
            out.append(LRRDimensionStat(
                key=k,
                label=k,
                totalAssemblies=v["a"],
                totalFaults=v["f"],
                lrrRate=round(v["f"] / v["a"] * 100, 2) if v["a"] > 0 else None,
            ))
        out.sort(key=lambda x: (x.lrrRate is None, -(x.lrrRate or 0)))
        return out

    by_factory = _dim_stats("factory")
    by_customer = _dim_stats("customer")
    by_pf = _dim_stats("product_family")

    # 故障类型维度: lrrRate = 该类型故障数 / 总装配数
    by_fault: list[LRRDimensionStat] = []
    for ft, cnt in fault_type_count.items():
        rate = round(cnt / total_asm * 100, 2) if total_asm > 0 else None
        by_fault.append(LRRDimensionStat(key=ft, label=ft, totalAssemblies=total_asm, totalFaults=cnt, lrrRate=rate))
    by_fault.sort(key=lambda x: -x.totalFaults)

    log_info(
        f"LRR 列表: 共 {total} 种物料 (有装配 {len(with_assembly)} / 纯故障 {len(pure_fault)}), "
        f"筛选 factory={factory} customer={customer} pf={productFamily} "
        f"partType={partType} partPN={partPN} faultType={faultType} "
        f"time={timeGranularity} [{dateFrom}~{dateTo}], 本页 {len(page_items)} 条"
    )
    return LRRListResponse(
        items=page_items,
        total=total,
        page=page,
        limit=limit,
        has_more=(page * limit) < total,
        summary=summary,
        trend=trend,
        byFactory=by_factory,
        byCustomer=by_customer,
        byProductFamily=by_pf,
        byFaultType=by_fault,
    )


@router.get("/options", response_model=LRROptions)
@audit_log("QUERY", "lrr_options")
async def get_lrr_options(request: Request):
    """返回过滤器下拉枚举值(基地/客户/机型/部件类型/故障类型)。"""
    db = get_database()
    mi = db[Collections.MACHINE_INFO]
    fi = db[Collections.FAULT_INFO]

    def _clean(values):
        return sorted([v for v in values if v])

    # Motor 的 distinct 返回 coroutine, 必须 await (与 find 返回的 cursor 不同)
    factories = _clean(await mi.distinct("factory", {"factory": {"$nin": [None, ""]}}))
    customers = _clean(await mi.distinct("customer_id", {"customer_id": {"$nin": [None, ""]}}))
    pfs = _clean(await mi.distinct("product_family", {"product_family": {"$nin": [None, ""]}}))
    part_types = _clean(await fi.distinct("involved_component", {"involved_component": {"$nin": [None, ""]}}))
    fault_types = _clean(await fi.distinct("fault_category", {"fault_category": {"$nin": [None, ""]}}))

    return LRROptions(
        factories=factories,
        customers=customers,
        productFamilies=pfs,
        partTypes=part_types,
        faultTypes=fault_types,
    )


@router.get("/fault-details", response_model=list[LRRFaultDetail])
@audit_log("QUERY", "lrr_fault_details")
async def get_lrr_fault_details(
    request: Request,
    factory: str | None = Query(None, description="生产基地"),
    customer: str | None = Query(None, description="客户(customer_id)"),
    productFamily: str | None = Query(None, description="机型(product_family)"),
    partType: str | None = Query(None, description="部件类型(involved_component)"),
    partPN: str | None = Query(None, description="部件PN(reinsert_lot)"),
    faultType: str | None = Query(None, description="故障类型(fault_category)"),
    dateFrom: str | None = Query(None, description="生产开始日期 YYYY-MM-DD"),
    dateTo: str | None = Query(None, description="生产结束日期 YYYY-MM-DD"),
    limit: int = Query(10000, ge=1, le=50000, description="最大返回条数"),
):
    """
    故障明细(已关联机器维度), 用于 Excel 导出。
    与 /list 共用同一套机器级维度过滤逻辑; 不要求 reinsert_lot 非空(导出全部故障记录)。
    """
    db = get_database()
    mi = db[Collections.MACHINE_INFO]
    fi = db[Collections.FAULT_INFO]

    machine_match: dict = {}
    if factory:
        machine_match["factory"] = factory
    if customer:
        machine_match["customer_id"] = customer
    if productFamily:
        machine_match["product_family"] = productFamily
    tm = _build_time_match(dateFrom, dateTo)
    if tm:
        machine_match["actual_start_time"] = tm

    sn_to_dims: dict[str, dict] = {}
    async for m in mi.find(
        machine_match,
        {"sn": 1, "factory": 1, "customer_id": 1, "product_family": 1, "actual_start_time": 1},
    ):
        sn = m.get("sn")
        if sn:
            sn_to_dims[sn] = m

    matching_sns = list(sn_to_dims.keys())
    fault_match: dict = {"sn": {"$in": matching_sns} if matching_sns else {"$in": []}}
    if partPN:
        fault_match["reinsert_lot"] = partPN
    if faultType:
        fault_match["fault_category"] = faultType
    if partType:
        fault_match["involved_component"] = partType

    details: list[LRRFaultDetail] = []
    cursor = fi.find(fault_match).sort("repair_time", -1).limit(limit)
    async for f in cursor:
        sn = f.get("sn") or ""
        d = sn_to_dims.get(sn, {})
        details.append(LRRFaultDetail(
            sn=sn,
            saleNo=f.get("sale_no") or "",
            mfgOrder=f.get("mfg_order") or "",
            factory=d.get("factory") or "",
            customer=d.get("customer_id") or "",
            productFamily=d.get("product_family") or "",
            productionTime=d.get("actual_start_time") or "",
            repairTime=f.get("repair_time") or "",
            partPN=f.get("reinsert_lot") or "",
            partType=f.get("involved_component") or "",
            partDesc=f.get("component_desc") or "",
            faultType=f.get("fault_category") or "",
            faultDesc=f.get("fault_desc") or "",
            fault2ndAppear=f.get("fault_2nd_appear") or "",
            fault3rdAppear=f.get("fault_3rd_appear") or "",
        ))
    return details
