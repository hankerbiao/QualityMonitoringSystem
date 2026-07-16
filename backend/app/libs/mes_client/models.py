
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

    # ==== MES 故障接口全量字段（以下均为原始 JSON 映射）====
    wms_location: str | None = None           # s_WMSLOCATIONNAME
    ng_spec_name: str | None = None           # nG_SPECNAME
    ng_full_name: str | None = None           # nG_FULLNAME
    ng_txn_date: str | None = None            # nG_TXNDATE
    d_full_name: str | None = None            # d_FULLNAME
    loss_code_name: str | None = None         # s_3RDLOSSCODENAME
    twice_defect_flag: str | None = None      # s_TWICEDEFECTFLAGNAME
    involved_component: str | None = None     # s_INVOLVEDCOMPONENTNAME
    reinsert_lot: str | None = None           # s_REINSERTLOT
    slot_no: str | None = None                # s_SLOTNO
    s_description: str | None = None          # s_DESCRIPTION
    product_name: str | None = None           # productname
    component_desc: str | None = None         # description（MES 中第二个描述字段）
    component_scan_type: str | None = None    # s_COMPONENTSCANTYPE
    b_sg: str | None = None                   # b_SG
    b_material: str | None = None             # b_MATERIAL
    a_bg: str | None = None                   # a_BG
    a_material: str | None = None             # a_MATERIAL
    record01_repair: str | None = None        # s_RECORD01REPAIRM
    rejudge: str | None = None                # s_ReJudge
    rejudge_result: str | None = None         # s_ReJudgeResult
    rejudge_problem_desc: str | None = None   # s_ReJudgeProblemDesc
    rejudge_note: str | None = None           # s_ReJudgeNote
    user_field_03: str | None = None          # s_USERFIELD03
    oem_no: str | None = None                 # s_OEMNO
    oem_desc: str | None = None               # s_OEMDESC
    nd_fault_category: str | None = None      # s_NDFAULTCATEGORY
    rd_fault_category: str | None = None      # s_RDFAULTCATEGORY
    th_fault_category: str | None = None      # s_THFAULTCATEGORY
    rma_rejudge: str | None = None            # s_RMAReJudge
    rma_rejudge_result: str | None = None     # s_RMAReJudgeResult
    slot_info: str | None = None              # slot（避免 Python 内置 slot 冲突）
    ram_filter_flag: str | None = None        # s_RAMFILTERFLAG
    chassis_no_cust: str | None = None        # s_CHASSISNOCUST
    asset_number_list: str | None = None      # s_ASSETNUMBERLIST


class AssemblyRecordItem(pydantic.BaseModel):
    """MES 装配记录条目

    映射接口 QueryAssemble/getQueryAssemble 的返回字段。
    每条记录代表某生产工单下的一条物料/组件装配信息。
    """
    mfg_order: str                                    # s_MFGORDERNAME - 生产工单号
    chassis_no: str                                   # s_CHASSISNO - 机箱序列号
    chassis_no_cust: str | None = None                # s_CHASSISNOCUST - 客户机箱号
    product_no: str                                   # s_PRODUCTNO - 产品编号
    product_desc: str                                 # s_PRODUCTDESC - 产品描述
    name: str                                         # s_NAME - 条码/标签号
    issued_material_name: str | None = None           # s_ISSUEDMATERIALNAME - 发料物料名称
    oem_no: str | None = None                         # s_OEMNO - OEM编号
    oem_desc: str | None = None                       # s_OEMDESC - OEM描述
    notes: str | None = None                          # s_NOTES - 备注


class OrderSumItem(pydantic.BaseModel):
    """订单级物料汇总（接口 getOrderSum 返回项）"""
    mfgordername: str
    productfamilyname: str | None = None
    s_productname: str | None = None
    productname: str | None = None
    s_PRODUCTDESC: str | None = None
    ordertypename: str | None = None
    qty: int | None = None
    s_SaleNo: str | None = None
    s_SaleItem: str | None = None
    s_manufacturerinfo: str | None = None
    s_customer: str | None = None
    plannedstartdate: str | None = None
    plannedcompletiondate: str | None = None
    notes: str | None = None


class OrderBomItem(pydantic.BaseModel):
    """BOM 物料明细行项（接口 getOrderBOM 返回项）"""
    mfgordername: str
    productname: str | None = None
    s_WMSLOCATIONNAME: str | None = None
    s_USERFIELD03: str | None = None
    s_PRODUCTDESC: str | None = None
    qtyrequired: float | None = None
    specname: str | None = None
    s_Componentscantype: str | None = None
    s_PACKINGEQPLABELFLAG: str | None = None
    s_PACKINGBOXLABELFLAG: str | None = None
    s_backhddflag: str | None = None
    s_USERFIELD01: str | None = None
    s_OEMNO: str | None = None
    s_OEMDESC: str | None = None
    s_materialgroup: str | None = None
    s_OEMCODE: str | None = None
    s_ECN: str | None = None

