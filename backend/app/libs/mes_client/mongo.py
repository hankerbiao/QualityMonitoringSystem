
from pydantic import BaseModel
from pymongo import ASCENDING, MongoClient


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
    DB_NAME = "quality_monitoring"
    MACHINE_COLLECTION = "machine_info"
    FAULT_COLLECTION = "fault_info"

    def __init__(self, mongo_url: str = "mongodb://10.17.154.252:27019"):
        self._client = MongoClient(mongo_url)
        self._db = self._client[self.DB_NAME]
        self._ensure_indexes()

    def _ensure_indexes(self):
        self._db[self.MACHINE_COLLECTION].create_index([("sn", ASCENDING)], unique=True)
        self._db[self.MACHINE_COLLECTION].create_index([("sale_no", ASCENDING)])
        self._db[self.MACHINE_COLLECTION].create_index([("mfg_order", ASCENDING)])
        self._db[self.MACHINE_COLLECTION].create_index([("customer_id", ASCENDING)])
        self._db[self.FAULT_COLLECTION].create_index([("sn", ASCENDING)])
        self._db[self.FAULT_COLLECTION].create_index([("fault_category", ASCENDING)])

    @property
    def machine_collection(self):
        return self._db[self.MACHINE_COLLECTION]

    @property
    def fault_collection(self):
        return self._db[self.FAULT_COLLECTION]

    def save_machine(self, machine: MachineInfo) -> str:
        self.machine_collection.update_one(
            {"sn": machine.sn},
            {"$set": machine.model_dump()},
            upsert=True
        )
        return machine.sn

    def save_machines(self, machines: list[MachineInfo]) -> int:
        count = 0
        for machine in machines:
            self.save_machine(machine)
            count += 1
        return count

    def save_fault(self, fault: FaultInfo) -> str:
        self.fault_collection.update_one(
            {"sn": fault.sn, "fault_desc": fault.fault_desc},
            {"$set": fault.model_dump()},
            upsert=True
        )
        return fault.sn

    def save_faults(self, faults: list[FaultInfo]) -> int:
        count = 0
        for fault in faults:
            self.save_fault(fault)
            count += 1
        return count

    def get_machine(self, sn: str) -> dict | None:
        return self.machine_collection.find_one({"sn": sn})

    def get_machines_by_sale_no(self, sale_no: str) -> list[dict]:
        return list(self.machine_collection.find({"sale_no": sale_no}))

    def get_faults_by_sn(self, sn: str) -> list[dict]:
        return list(self.fault_collection.find({"sn": sn}))

    def get_machine_with_faults(self, sn: str) -> dict:
        machine = self.get_machine(sn)
        if machine:
            machine["faults"] = self.get_faults_by_sn(sn)
        return machine

    def delete_machine(self, sn: str) -> int:
        result = self.machine_collection.delete_one({"sn": sn})
        self.fault_collection.delete_many({"sn": sn})
        return result.deleted_count

    def count_machines(self) -> int:
        return self.machine_collection.count_documents({})

    def count_faults(self) -> int:
        return self.fault_collection.count_documents({})

