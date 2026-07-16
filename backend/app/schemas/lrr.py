"""
LRR (工厂阶段部件故障率) 相关 Pydantic 模型

计算口径:
- 物料全集 = assembly_records 的 product_no ∪ fault_info 的 reinsert_lot（以 fault 侧为全量基准）
- 分子 (faultCount):  fault_info 中 reinsert_lot == 该物料编号的记录数
- 分母 (totalCount):  assembly_records 中 product_no == 该物料编号的数量
  - 若该物料仅出现在 fault_info 中（未在装配表出现）, totalCount = None, lrrRate = None
  - 若该物料仅出现在 assembly_records 中, faultCount = 0, lrrRate = 0%
"""
from pydantic import BaseModel


class LRRData(BaseModel):
    """LRR 单条物料故障率数据"""
    id: str = ""
    materialNo: str = ""              # 物料编号
    materialDesc: str = ""            # 物料描述（来自装配表或空）
    totalCount: int | None = None     # 总装配数量（分母）; None 表示无装配数据
    faultCount: int = 0               # 故障数量（分子）
    lrrRate: float | None = None      # 故障率百分比; None 表示无分母
