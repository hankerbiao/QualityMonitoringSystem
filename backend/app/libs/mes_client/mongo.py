"""
MES 数据持久化层

复用项目统一的 MongoDB 连接（app.db.mongodb），不再单独维护 MongoClient / 索引。
所有集合的索引统一在 app.db.mongodb.create_indexes() 中定义。
"""


from pydantic import BaseModel

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


class MongoDBClient:
    """MES 数据持久化客户端

    复用项目统一连接（app.db.mongodb.get_database()），不单独持有 MongoClient。
    索引统一在 app.db.mongodb.create_indexes() 创建，本类不再建索引。
    """

    MACHINE_COLLECTION = Collections.MACHINE_INFO
    FAULT_COLLECTION = Collections.FAULT_INFO

    @property
    def machine_collection(self):
        return get_database()[self.MACHINE_COLLECTION]

    @property
    def fault_collection(self):
        return get_database()[self.FAULT_COLLECTION]

    async def save_machine(self, machine: MachineInfo) -> str:
        await self.machine_collection.update_one(
            {"sn": machine.sn},
            {"$set": machine.model_dump()},
            upsert=True,
        )
        return machine.sn

    async def save_machines(self, machines: list[MachineInfo]) -> int:
        count = 0
        for machine in machines:
            await self.save_machine(machine)
            count += 1
        return count

    async def save_fault(self, fault: FaultInfo) -> str:
        await self.fault_collection.update_one(
            {"sn": fault.sn, "fault_desc": fault.fault_desc},
            {"$set": fault.model_dump()},
            upsert=True,
        )
        return fault.sn

    async def save_faults(self, faults: list[FaultInfo]) -> int:
        count = 0
        for fault in faults:
            await self.save_fault(fault)
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
