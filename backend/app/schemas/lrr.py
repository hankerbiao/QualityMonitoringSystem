"""
LRR (工厂阶段部件故障率) 相关 Pydantic 模型

计算口径:
- 物料全集 = assembly_records 的 product_no ∪ fault_info 的 reinsert_lot（两边都取非空）
- 分子 (faultCount):  fault_info 中 reinsert_lot == 该物料编号的记录数
- 分母 (totalCount):  assembly_records 中 product_no == 该物料编号的数量
  - 若该物料仅出现在 fault_info 中（未在装配表出现）, totalCount = None, lrrRate = None
  - 若该物料仅出现在 assembly_records 中, faultCount = 0, lrrRate = 0%

多维过滤关联:
- 机器级维度(基地/客户/机型/时间) 存储在 machine_info,
  通过 assembly_records.mfg_order → machine_info.mfg_order 与 fault_info.sn → machine_info.sn 关联(覆盖率100%)。
- 时间维度统一使用 machine_info.actual_start_time(机器生产时间), 保证分子分母在同一生产周期内。
- 部件类型 = fault_info.involved_component; 故障类型 = fault_info.fault_category。
"""
from pydantic import BaseModel


class LRRData(BaseModel):
    """LRR 单条物料故障率数据"""
    id: str = ""
    materialNo: str = ""              # 物料编号 (部件PN)
    materialDesc: str = ""            # 物料描述（来自装配表或空）
    totalCount: int | None = None     # 总装配数量（分母）; None 表示无装配数据
    faultCount: int = 0               # 故障数量（分子）
    lrrRate: float | None = None      # 故障率百分比; None 表示无分母


class LRRTrendPoint(BaseModel):
    """按时间粒度(年/月/日)聚合的趋势点"""
    period: str                       # '2026' / '2026-07' / '2026-07-15'
    totalAssemblies: int = 0          # 该周期总装配件次(分母)
    totalFaults: int = 0              # 该周期总故障件次(分子)
    lrrRate: float | None = None      # 故障率百分比 = totalFaults/totalAssemblies*100


class LRRDimensionStat(BaseModel):
    """某一维度的 LRR 汇总统计(用于分组柱状图)"""
    key: str                          # 维度原始值(如 '天津' / 'B01' / 'CPU')
    label: str                        # 展示标签(同 key, 预留)
    totalAssemblies: int = 0
    totalFaults: int = 0
    lrrRate: float | None = None


class LRRSummary(BaseModel):
    """当前过滤条件下的整体汇总"""
    materialKinds: int = 0            # 物料种类数(有装配+纯故障)
    withAssembly: int = 0            # 有装配数据的物料数
    withoutAssembly: int = 0          # 纯故障物料数
    totalAssemblies: int = 0          # 总装配件次
    totalFaults: int = 0             # 总故障件次
    overallLrr: float | None = None  # 加权整体故障率


class LRRListResponse(BaseModel):
    """LRR 列表 + 多维统计聚合响应"""
    items: list[LRRData] = []
    total: int = 0
    page: int = 1
    limit: int = 50
    has_more: bool = False
    summary: LRRSummary = LRRSummary()
    trend: list[LRRTrendPoint] = []                       # 时间趋势(按 timeGranularity)
    byFactory: list[LRRDimensionStat] = []                # 按生产基地
    byCustomer: list[LRRDimensionStat] = []               # 按客户
    byProductFamily: list[LRRDimensionStat] = []          # 按机型
    byFaultType: list[LRRDimensionStat] = []              # 按故障类型


class LRROptions(BaseModel):
    """过滤器下拉枚举值"""
    factories: list[str] = []
    customers: list[str] = []
    productFamilies: list[str] = []
    partTypes: list[str] = []          # involved_component
    faultTypes: list[str] = []         # fault_category


class LRRFaultDetail(BaseModel):
    """故障明细(已关联机器维度, 用于导出)"""
    sn: str = ""
    saleNo: str = ""
    mfgOrder: str = ""
    factory: str = ""
    customer: str = ""
    productFamily: str = ""
    productionTime: str = ""           # machine_info.actual_start_time
    repairTime: str = ""               # fault_info.repair_time
    partPN: str = ""                   # reinsert_lot
    partType: str = ""                 # involved_component
    partDesc: str = ""                 # component_desc
    faultType: str = ""                # fault_category
    faultDesc: str = ""
    fault2ndAppear: str = ""
    fault3rdAppear: str = ""
