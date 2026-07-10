
import pydantic


class CompletionRateItem(pydantic.BaseModel):
    sale_no: str
    factory: str
    mfg_order: str
    product_family: str
    qty: int | None = None
    plan_end_time: str | None = None
    actual_start_time: str | None = None


class OrderDataItem(pydantic.BaseModel):
    sn: str
    sale_no: str
    factory: str
    mfg_order: str
    product_family: str
    actual_start_time: str | None = None
    customer_id: str | None = None


class SerialNumberItem(pydantic.BaseModel):
    mfg_order: str
    product_family: str
    sn: str
    sale_no: str | None = None
    chassis_no: str | None = None
    asset_no: str | None = None


class OrderSNDetail(pydantic.BaseModel):
    sale_no: str
    factory: str
    mfg_order: str
    product_family: str
    actual_start_time: str | None = None
    customer_id: str | None = None
    sn: str


class QMSFaultItem(pydantic.BaseModel):
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

