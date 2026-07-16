"""
MES 数据持久化层

复用项目统一的 MongoDB 连接（app.db.mongodb），不再单独维护 MongoClient / 索引。
所有集合的索引统一在 app.db.mongodb.create_indexes() 中定义。
"""


from datetime import datetime

from pydantic import BaseModel, Field

from app.db.mongodb import get_database
from app.models.documents import Collections


class MachineInfo(BaseModel):
    sn: str
    sale_no: str
    factory: str
    mfg_order: str
    product_family: str
    actual_start_time: str | None = None
    customer_id: str | None = None


class FaultInfo(BaseModel):
    sn: str
    sale_no: str | None = None
    mfg_order: str | None = None
    product_family: str | None = None
    fault_category: str | None = None
    fault_2nd_appear: str | None = None
    fault_3rd_appear: str | None = None
    fault_desc: str | None = None
    repair_person: str | None = None
    repair_time: str | None = None
    repair_effectiveness: str | None = None

    # ==== MES 故障接口全量字段（与 QMSFaultItem 一一对应）====
    wms_location: str | None = None
    ng_spec_name: str | None = None
    ng_full_name: str | None = None
    ng_txn_date: str | None = None
    d_full_name: str | None = None
    loss_code_name: str | None = None
    twice_defect_flag: str | None = None
    involved_component: str | None = None
    reinsert_lot: str | None = None
    slot_no: str | None = None
    s_description: str | None = None
    product_name: str | None = None
    component_desc: str | None = None
    component_scan_type: str | None = None
    b_sg: str | None = None
    b_material: str | None = None
    a_bg: str | None = None
    a_material: str | None = None
    record01_repair: str | None = None
    rejudge: str | None = None
    rejudge_result: str | None = None
    rejudge_problem_desc: str | None = None
    rejudge_note: str | None = None
    user_field_03: str | None = None
    oem_no: str | None = None
    oem_desc: str | None = None
    nd_fault_category: str | None = None
    rd_fault_category: str | None = None
    th_fault_category: str | None = None
    rma_rejudge: str | None = None
    rma_rejudge_result: str | None = None
    slot_info: str | None = None
    ram_filter_flag: str | None = None
    chassis_no_cust: str | None = None
    asset_number_list: str | None = None


class AssemblyRecord(BaseModel):
    """装配记录文档模型（对应 assembly_records 集合）

    唯一约束: (mfg_order, chassis_no) 组合唯一，避免同工单同机箱重复录入。
    """
    mfg_order: str                                    # 生产工单号
    chassis_no: str                                   # 机箱序列号
    chassis_no_cust: str | None = None                # 客户机箱号
    product_no: str                                   # 产品编号
    product_desc: str                                 # 产品描述
    name: str                                         # 条码/标签号
    issued_material_name: str | None = None           # 发料物料名称
    oem_no: str | None = None                         # OEM编号
    oem_desc: str | None = None                       # OEM描述
    notes: str | None = None                          # 备注
    imported_at: datetime = Field(default_factory=datetime.utcnow)  # 导入时间


class SalesOrderBomRecord(BaseModel):
    """销售订单 BOM 物料记录

    整合 getOrderSum（订单级汇总）+ getOrderBOM（BOM 明细）。
    一条记录 = BOM 中的一行物料，附带订单级信息。
    唯一约束: (sale_no, mfg_order, bom_product_name) 组合唯一。
    """
    # === 销售订单级信息 ===
    sale_no: str                                            # 销售订单号
    mfg_order: str                                          # 生产工单号

    # === 订单级信息（来自 getOrderSum）===
    product_family_name: str | None = None                  # 产品系列名
    s_product_name: str | None = None                       # 产品名
    product_no: str | None = None                           # 产品编号
    product_desc: str | None = None                         # 产品描述
    order_type_name: str | None = None                      # 订单类型
    order_qty: int | None = None                            # 订单数量（qty）
    sale_item: str | None = None                            # 销售项次
    manufacturer_info: str | None = None                    # 制造商信息
    customer: str | None = None                             # 客户
    planned_start_date: str | None = None                   # 计划开始日期
    planned_completion_date: str | None = None              # 计划完成日期
    notes: str | None = None                                # 备注

    # === BOM 行项目信息（来自 getOrderBOM）===
    bom_product_name: str | None = None                     # BOM物料编码
    wms_location: str | None = None                         # 库位
    user_field_03: str | None = None                        # 自定义字段03
    bom_product_desc: str | None = None                     # BOM物料描述
    qty_required: float | None = None                       # 需求数量
    spec_name: str | None = None                            # 规格名
    component_scan_type: str | None = None                  # 组件扫描类型
    packing_eqp_label_flag: str | None = None               # 包装设备标签标志
    packing_box_label_flag: str | None = None               # 包装箱标签标志
    back_hdd_flag: str | None = None                        # 后置硬盘标志
    user_field_01: str | None = None                        # 自定义字段01
    oem_no: str | None = None                               # OEM编号
    oem_desc: str | None = None                             # OEM描述
    material_group: str | None = None                       # 物料组
    oem_code: str | None = None                             # OEM代码
    ecn: str | None = None                                  # ECN变更号

    imported_at: datetime = Field(default_factory=datetime.utcnow)  # 导入时间


class MongoDBClient:
    """MES 数据持久化客户端

    复用项目统一连接（app.db.mongodb.get_database()），不单独持有 MongoClient。
    索引统一在 app.db.mongodb.create_indexes() 创建，本类不再建索引。
    """

    MACHINE_COLLECTION = Collections.MACHINE_INFO
    FAULT_COLLECTION = Collections.FAULT_INFO
    ASSEMBLY_COLLECTION = Collections.ASSEMBLY_RECORDS
    BOM_COLLECTION = Collections.SALES_ORDER_BOM

    @property
    def machine_collection(self):
        return get_database()[self.MACHINE_COLLECTION]

    @property
    def fault_collection(self):
        return get_database()[self.FAULT_COLLECTION]

    @property
    def assembly_collection(self):
        return get_database()[self.ASSEMBLY_COLLECTION]

    @property
    def bom_collection(self):
        return get_database()[self.BOM_COLLECTION]

    async def save_machine(self, machine: MachineInfo, skip_existing: bool = False) -> str:
        if skip_existing:
            exists = await self.machine_collection.find_one({"sn": machine.sn}, {"_id": 1})
            if exists:
                return machine.sn
        await self.machine_collection.update_one(
            {"sn": machine.sn},
            {"$set": machine.model_dump()},
            upsert=True,
        )
        return machine.sn

    async def save_machines(self, machines: list[MachineInfo], skip_existing: bool = False) -> int:
        count = 0
        for machine in machines:
            await self.save_machine(machine, skip_existing=skip_existing)
            count += 1
        return count

    async def save_fault(self, fault: FaultInfo, skip_existing: bool = False) -> str:
        if skip_existing:
            exists = await self.fault_collection.find_one(
                {"sn": fault.sn, "fault_desc": fault.fault_desc}, {"_id": 1}
            )
            if exists:
                return fault.sn
        await self.fault_collection.update_one(
            {"sn": fault.sn, "fault_desc": fault.fault_desc},
            {"$set": fault.model_dump()},
            upsert=True,
        )
        return fault.sn

    async def save_faults(self, faults: list[FaultInfo], skip_existing: bool = False) -> int:
        count = 0
        for fault in faults:
            await self.save_fault(fault, skip_existing=skip_existing)
            count += 1
        return count

    async def get_machine(self, sn: str) -> dict | None:
        return await self.machine_collection.find_one({"sn": sn})

    async def get_machines_by_sale_no(self, sale_no: str) -> list[dict]:
        return await self.machine_collection.find({"sale_no": sale_no}).to_list(length=None)

    async def get_faults_by_sn(self, sn: str) -> list[dict]:
        return await self.fault_collection.find({"sn": sn}).to_list(length=None)

    async def get_machine_with_faults(self, sn: str) -> dict | None:
        machine = await self.get_machine(sn)
        if machine:
            machine["faults"] = await self.get_faults_by_sn(sn)
        return machine

    async def delete_machine(self, sn: str) -> int:
        result = await self.machine_collection.delete_one({"sn": sn})
        await self.fault_collection.delete_many({"sn": sn})
        return result.deleted_count

    async def count_machines(self) -> int:
        return await self.machine_collection.count_documents({})

    async def count_faults(self) -> int:
        return await self.fault_collection.count_documents({})

    async def save_assembly_record(self, record: AssemblyRecord, skip_existing: bool = False) -> str:
        """保存单条装配记录（按 mfg_order + chassis_no 去重）

        Args:
            record: 装配记录
            skip_existing: 若为 True，已存在的记录跳过不更新
        """
        if skip_existing:
            exists = await self.assembly_collection.find_one(
                {"mfg_order": record.mfg_order, "chassis_no": record.chassis_no},
                {"_id": 1},
            )
            if exists:
                return record.chassis_no
        await self.assembly_collection.update_one(
            {"mfg_order": record.mfg_order, "chassis_no": record.chassis_no},
            {"$set": record.model_dump()},
            upsert=True,
        )
        return record.chassis_no

    async def save_assembly_records(self, records: list[AssemblyRecord], skip_existing: bool = False) -> int:
        """批量保存装配记录

        Args:
            records: 装配记录列表
            skip_existing: 若为 True，已存在的记录跳过不更新
        """
        count = 0
        for record in records:
            await self.save_assembly_record(record, skip_existing=skip_existing)
            count += 1
        return count

    async def get_assembly_records_by_mfg_order(self, mfg_order: str) -> list[dict]:
        """根据生产工单号查询装配记录"""
        return await self.assembly_collection.find(
            {"mfg_order": mfg_order}
        ).to_list(length=None)

    async def get_assembly_records_by_chassis_no(self, chassis_no: str) -> list[dict]:
        """根据机箱号查询装配记录"""
        return await self.assembly_collection.find(
            {"chassis_no": chassis_no}
        ).to_list(length=None)

    async def save_sales_order_bom_records(self, records: list[SalesOrderBomRecord], skip_existing: bool = False) -> int:
        """批量保存 BOM 物料记录（按 sale_no + mfg_order + bom_product_name 去重）

        Args:
            records: BOM 记录列表
            skip_existing: 若为 True，已存在的记录跳过不更新
        """
        for record in records:
            if skip_existing:
                exists = await self.bom_collection.find_one(
                    {
                        "sale_no": record.sale_no,
                        "mfg_order": record.mfg_order,
                        "bom_product_name": record.bom_product_name,
                    },
                    {"_id": 1},
                )
                if exists:
                    continue
            await self.bom_collection.update_one(
                {
                    "sale_no": record.sale_no,
                    "mfg_order": record.mfg_order,
                    "bom_product_name": record.bom_product_name,
                },
                {"$set": record.model_dump()},
                upsert=True,
            )
        return len(records)
