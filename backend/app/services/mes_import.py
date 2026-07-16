"""
MES 销售订单数据录入服务

将指定销售订单号下的「机器明细」与「故障信息」从 MES 拉取并写入项目统一 MongoDB：
- machine_info 集合（按 sn upsert）
- fault_info 集合（按 sn + fault_desc upsert）

复用：
- MES HTTP 客户端：app.libs.mes_client.MesClient（凭据从 configs.mes_config 读取）
- MongoDB 连接：app.db.mongodb（异步 Motor，由 app 启动时 connect_to_mongo 建立）
"""

import asyncio
from datetime import datetime

from pydantic import BaseModel, Field

from app.db.mongodb import get_database
from app.libs.mes_client import (
    AssemblyRecord,
    AssemblyRecordItem,
    FaultInfo,
    MachineInfo,
    MesClient,
    MongoDBClient,
)
from app.libs.mes_client.const import ALL_BASES_SQL, BASE_NAME_TO_ID
from app.models.documents import Collections

# MES 服务地址。
# 说明：configs.mes_config 当前仅存 username/password，未含 base_url，
# 此处沿用项目既有默认值（README / __init__ 示例同值）。
# 后续建议将 base_url 一并纳入 mes_config 配置以支持环境切换。
MES_BASE_URL = "http://10.8.101.49:9991"

# 默认基地 ID，未匹配时回落（覆盖全部基地）
_DEFAULT_BASE_ID = ALL_BASES_SQL


def get_base_id(factory_name: str) -> str:
    """根据工厂名（中文）获取 MES base ID。

    例：get_base_id("天津") -> "1000"
    未匹配时返回 ALL_BASES_SQL 覆盖全基地。

    Args:
        factory_name: 工厂中文名，如 "天津"、"盘锦"、"昆山" 等
                      （来自 machine_info.factory 字段）。
    """
    return BASE_NAME_TO_ID.get(factory_name, _DEFAULT_BASE_ID)


class SaleOrderImportRequest(BaseModel):
    """按销售订单号录入的请求参数"""

    sale_no: str = Field(..., description="销售订单号，如 XNC2632780")
    base: str = Field(
        default=ALL_BASES_SQL,
        description="MES 基地 ID（SQL in 片段，默认覆盖全部基地）",
    )
    base_url: str | None = Field(
        default=None,
        description="MES 服务地址，默认取项目内置地址 MES_BASE_URL",
    )


class SaleOrderImportResult(BaseModel):
    """录入结果"""

    sale_no: str
    machine_count: int = Field(description="从 MES 拉取到的机器条数")
    fault_count: int = Field(description="写入 fault_info 的故障条数")
    machine_upserted: int = Field(description="写入 machine_info 的条数（upsert）")
    fault_upserted: int = Field(description="写入 fault_info 的条数（upsert）")
    sn_list: list[str] = Field(default_factory=list, description="本次录入的 SN 列表")
    imported_at: datetime = Field(default_factory=datetime.utcnow)

    # 装配记录导入结果
    assembly_mfg_orders: list[str] = Field(
        default_factory=list, description="涉及的工单号列表"
    )
    assembly_record_count: int = Field(
        default=0, description="从 MES 拉取到的装配记录总数"
    )
    assembly_record_upserted: int = Field(
        default=0, description="写入 assembly_records 的条数（upsert）"
    )


async def _build_mes_client(base_url: str | None) -> MesClient:
    """从 configs.mes_config 读取凭据，构建已登录的 MesClient。"""
    doc = await get_database()[Collections.CONFIGS].find_one({"key": "mes_config"})
    if not doc or not doc.get("username") or not doc.get("password"):
        raise RuntimeError("MES 配置缺失：请在系统设置中配置 MES 账号与密码（mes_config）")
    client = MesClient(
        base_url=(base_url or MES_BASE_URL).rstrip("/"),
        username=doc["username"],
        password=doc["password"],
    )
    # login 为同步阻塞调用（requests），放入线程池避免阻塞事件循环
    await asyncio.to_thread(client.login)
    return client


async def _save_import_result(result: SaleOrderImportResult) -> None:
    """将导入结果写入 sales_orders 集合"""
    await get_database()[Collections.SALES_ORDERS].update_one(
        {"sales_order_sn": result.sale_no},
        {"$set": {
            "sales_order_sn": result.sale_no,
            "import_status": "no_data" if result.machine_count == 0 else "done",
            "machine_count": result.machine_count,
            "fault_count": result.fault_count,
            "machine_upserted": result.machine_upserted,
            "fault_upserted": result.fault_upserted,
            "sn_list": result.sn_list,
            "checked_at": result.imported_at,
            # 装配记录
            "assembly_status": "no_data" if not result.assembly_mfg_orders else "done",
            "assembly_mfg_orders": result.assembly_mfg_orders,
            "assembly_record_count": result.assembly_record_count,
            "assembly_record_upserted": result.assembly_record_upserted,
            "assembly_checked_at": result.imported_at,
        }},
        upsert=True,
    )


async def import_sale_order(
    sale_no: str,
    base: str = ALL_BASES_SQL,
    base_url: str | None = None,
    issue_time1: str = "2025-01-01 00:00:00",
    issue_time2: str = "2030-12-31 23:59:59",
    skip_existing: bool = False,
) -> SaleOrderImportResult:
    """
    按销售订单号录入机器明细、故障信息与装配记录到 MongoDB。

    流程：
      1. 构建并登录 MesClient（凭据来自 mes_config）
      2. collect_order_data(sale_no) 拉取该订单下所有机器明细
      3. 写入 machine_info（skip_existing=True 时只追加新 SN）
      4. 逐 SN 调 get_fault_info 拉取故障，写入 fault_info（skip_existing=True 时只追加）
      5. 从机器明细提取生产工单号，逐工单调 get_assembly_records 拉取装配记录，
         写入 assembly_records（按 mfg_order + chassis_no 去重）
    """
    print(f"  [{sale_no}] 正在构建 MES 客户端...", flush=True)
    client = await _build_mes_client(base_url)

    # MES 查询为同步阻塞（requests），在线程池执行，避免阻塞事件循环
    print(f"  [{sale_no}] 正在从 MES 拉取机器明细...", flush=True)
    items = await asyncio.to_thread(
        client.collect_order_data, sale_no, base, issue_time1, issue_time2
    )

    if not items:
        print(f"  [{sale_no}] MES 无机器数据（空结果）", flush=True)
        result = SaleOrderImportResult(
            sale_no=sale_no,
            machine_count=0,
            fault_count=0,
            machine_upserted=0,
            fault_upserted=0,
            sn_list=[],
        )
        await _save_import_result(result)
        return result

    print(f"  [{sale_no}] MES 返回 {len(items)} 条机器记录", flush=True)

    mongo = MongoDBClient()

    # 1) 写入机器明细（OrderDataItem -> MachineInfo）
    machines = [MachineInfo(**item.model_dump()) for item in items]
    print(f"  [{sale_no}] 写入 machine_info（skip_existing={skip_existing}）...", flush=True)
    machine_upserted = await mongo.save_machines(machines, skip_existing=skip_existing)
    sn_list = [m.sn for m in machines]
    print(f"  [{sale_no}] machine_info 写入完成: {machine_upserted}/{len(machines)} 条", flush=True)

    # 2) 逐 SN 拉取并写入故障信息（QMSFaultItem -> FaultInfo）
    fault_upserted = 0
    fault_total = 0
    total_machines = len(machines)
    for idx, mach in enumerate(machines, start=1):
        print(f"  [{sale_no}] 拉取故障 ({idx}/{total_machines}): SN {mach.sn} (基地={mach.factory})", flush=True)
        base_id = get_base_id(mach.factory)  # mach.factory： 天津 -> 1000
        faults = await asyncio.to_thread(client.get_fault_info, mach.sn, base_id)
        if faults:
            print(f"  [{sale_no}]   SN {mach.sn}: 获取到 {len(faults)} 条故障", flush=True)
            fault_docs = [FaultInfo(**f.model_dump()) for f in faults]
            saved = await mongo.save_faults(fault_docs, skip_existing=skip_existing)
            fault_upserted += saved
            fault_total += len(fault_docs)
            print(f"  [{sale_no}]   SN {mach.sn}: 写入 fault_info {saved}/{len(fault_docs)} 条", flush=True)
        else:
            print(f"  [{sale_no}]   SN {mach.sn}: 无故障数据", flush=True)

    print(
        f"  [{sale_no}] 完成: 机器 {machine_upserted}/{len(machines)} 条, "
        f"故障 {fault_upserted}/{fault_total} 条",
        flush=True,
    )

    # 3) 导入装配记录（从机器明细中提取唯一工单号）
    mfg_orders = list(dict.fromkeys(item.mfg_order for item in items if item.mfg_order))
    assembly_records_all: list[AssemblyRecordItem] = []
    for mfg in mfg_orders:
        recs = await asyncio.to_thread(client.get_assembly_records, mfg)
        assembly_records_all.extend(recs)

    assembly_upserted = 0
    if assembly_records_all:
        docs = [AssemblyRecord(**r.model_dump()) for r in assembly_records_all]
        assembly_upserted = await mongo.save_assembly_records(docs, skip_existing=True)
        print(
            f"  [{sale_no}] 装配记录: {len(mfg_orders)} 个工单, "
            f"写入 {assembly_upserted}/{len(assembly_records_all)} 条",
            flush=True,
        )
    else:
        print(f"  [{sale_no}] 装配记录: 无装配数据", flush=True)

    result = SaleOrderImportResult(
        sale_no=sale_no,
        machine_count=len(machines),
        fault_count=fault_upserted,
        machine_upserted=machine_upserted,
        fault_upserted=fault_upserted,
        sn_list=sn_list,
        assembly_mfg_orders=mfg_orders,
        assembly_record_count=len(assembly_records_all),
        assembly_record_upserted=assembly_upserted,
    )
    await _save_import_result(result)
    return result


# ============== 装配记录导入 ==============


class AssemblyImportRequest(BaseModel):
    """装配记录导入请求参数"""

    sale_no: str = Field(..., description="销售订单号，如 XNC2632780")
    base: str = Field(
        default=ALL_BASES_SQL,
        description="MES 基地 ID（SQL in 片段，默认覆盖全部基地）",
    )
    base_url: str | None = Field(
        default=None,
        description="MES 服务地址，默认取项目内置地址 MES_BASE_URL",
    )


class AssemblyImportResult(BaseModel):
    """装配记录导入结果"""

    sale_no: str
    mfg_orders: list[str] = Field(default_factory=list, description="涉及的工单号列表")
    record_count: int = Field(description="拉取到的装配记录总数")
    record_upserted: int = Field(description="写入 assembly_records 的条数（upsert）")
    imported_at: datetime = Field(default_factory=datetime.utcnow)


async def import_assembly_records(
    sale_no: str,
    base: str = ALL_BASES_SQL,
    base_url: str | None = None,
    issue_time1: str = "2025-01-01 00:00:00",
    issue_time2: str = "2030-12-31 23:59:59",
) -> AssemblyImportResult:
    """
    按销售订单号获取并保存装配记录到 assembly_records 集合。

    流程：
      1. 构建并登录 MesClient（凭据来自 mes_config）
      2. 通过 get_completion_rate(sale_no) 获取该销售订单下的所有生产工单
      3. 对每个生产工单，调用 get_assembly_records(mfg_order) 拉取装配记录
      4. 全部 upsert 到 assembly_records 集合（按 mfg_order + chassis_no 去重）
    """
    client = await _build_mes_client(base_url)

    # 1) 获取该销售订单下的所有生产工单
    orders = await asyncio.to_thread(
        client.get_completion_rate, [base], "PlanTime", issue_time1, issue_time2, "k2", sale_no
    )

    mfg_orders = list(dict.fromkeys(o.mfg_order for o in orders if o.mfg_order))
    if not mfg_orders:
        return AssemblyImportResult(
            sale_no=sale_no, mfg_orders=[], record_count=0, record_upserted=0
        )

    # 2) 逐一拉取装配记录
    all_records: list[AssemblyRecordItem] = []
    for mfg in mfg_orders:
        records = await asyncio.to_thread(client.get_assembly_records, mfg)
        all_records.extend(records)

    # 3) 写入 MongoDB
    mongo = MongoDBClient()
    docs = [AssemblyRecord(**r.model_dump()) for r in all_records]
    record_upserted = await mongo.save_assembly_records(docs)

    return AssemblyImportResult(
        sale_no=sale_no,
        mfg_orders=mfg_orders,
        record_count=len(all_records),
        record_upserted=record_upserted,
    )


# ============== 销售订单 BOM 导入 ==============


class SalesOrderBomImportResult(BaseModel):
    """销售订单 BOM 导入结果"""
    sale_no: str
    mfg_orders: list[str] = Field(default_factory=list, description="涉及的工单列表")
    mfg_count: int = Field(description="BOM 有数据的工单数")
    record_count: int = Field(description="拉取到的 BOM 行总数")
    record_upserted: int = Field(description="写入 sales_order_bom 的条数")
    imported_at: datetime = Field(default_factory=datetime.utcnow)


async def import_sales_order_bom(
    sale_no: str,
    base_url: str | None = None,
) -> SalesOrderBomImportResult:
    """按销售订单号导入 BOM 物料数据到 sales_order_bom 集合。

    流程：
      1. 从 machine_info 读取该销售订单下的所有生产工单（distinct mfg_order）
      2. 对每个工单调 getOrderSum + getOrderBOM（MES 接口）
      3. 合并后统一 upsert 到 sales_order_bom 集合
    """
    from app.libs.mes_client.mongo import MongoDBClient, SalesOrderBomRecord

    print(f"  [{sale_no}] 正在构建 MES 客户端...", flush=True)
    try:
        client = await _build_mes_client(base_url)
    except Exception as e:
        print(f"  [{sale_no}] MES 客户端构建失败: {type(e).__name__}: {e}", flush=True)
        return SalesOrderBomImportResult(
            sale_no=sale_no, mfg_orders=[], mfg_count=0, record_count=0, record_upserted=0
        )
    mongo = MongoDBClient()

    # 1) 从 machine_info 获取该销售订单下的所有生产工单（去重）
    print(f"  [{sale_no}] 从 machine_info 查询生产工单...", flush=True)
    db = get_database()
    machine_col = db[Collections.MACHINE_INFO]
    mfg_orders = await machine_col.distinct("mfg_order", {"sale_no": sale_no})
    mfg_orders = [m for m in mfg_orders if m]
    print(f"  [{sale_no}] 获取到 {len(mfg_orders)} 个生产工单: {mfg_orders}", flush=True)

    if not mfg_orders:
        print(f"  [{sale_no}] 无生产工单", flush=True)
        return SalesOrderBomImportResult(
            sale_no=sale_no, mfg_orders=[], mfg_count=0, record_count=0, record_upserted=0
        )

    # 2) 逐工单拉取 getOrderSum + getOrderBOM
    all_records: list[SalesOrderBomRecord] = []
    bom_mfg_count = 0
    for mfg in mfg_orders:
        print(f"  [{sale_no}] 拉取工单 {mfg} BOM...", flush=True)

        # 获取订单级汇总（含 qty）
        try:
            sums = await asyncio.to_thread(client.get_order_sum, mfg)
            order_sum = sums[0] if sums else None
        except Exception as e:
            print(f"  [{sale_no}]   工单 {mfg}: getOrderSum 失败: {type(e).__name__}: {e}", flush=True)
            continue
        if not order_sum:
            print(f"  [{sale_no}]   工单 {mfg}: 无 getOrderSum 数据，跳过", flush=True)
            continue
        bom_mfg_count += 1

        # 获取 BOM 明细
        try:
            bom_items = await asyncio.to_thread(client.get_order_bom, mfg)
        except Exception as e:
            print(f"  [{sale_no}]   工单 {mfg}: getOrderBOM 失败: {type(e).__name__}: {e}", flush=True)
            continue
        print(f"  [{sale_no}]   工单 {mfg}: BOM 行 {len(bom_items)} 条", flush=True)

        for item in bom_items:
            all_records.append(SalesOrderBomRecord(
                sale_no=sale_no,
                mfg_order=mfg,
                product_family_name=order_sum.productfamilyname,
                s_product_name=order_sum.s_productname,
                product_no=order_sum.productname,
                product_desc=order_sum.s_PRODUCTDESC,
                order_type_name=order_sum.ordertypename,
                order_qty=order_sum.qty,
                sale_item=order_sum.s_SaleItem,
                manufacturer_info=order_sum.s_manufacturerinfo,
                customer=order_sum.s_customer,
                planned_start_date=order_sum.plannedstartdate,
                planned_completion_date=order_sum.plannedcompletiondate,
                notes=order_sum.notes,
                bom_product_name=item.productname,
                wms_location=item.s_WMSLOCATIONNAME,
                user_field_03=item.s_USERFIELD03,
                bom_product_desc=item.s_PRODUCTDESC,
                qty_required=item.qtyrequired,
                spec_name=item.specname,
                component_scan_type=item.s_Componentscantype,
                packing_eqp_label_flag=item.s_PACKINGEQPLABELFLAG,
                packing_box_label_flag=item.s_PACKINGBOXLABELFLAG,
                back_hdd_flag=item.s_backhddflag,
                user_field_01=item.s_USERFIELD01,
                oem_no=item.s_OEMNO,
                oem_desc=item.s_OEMDESC,
                material_group=item.s_materialgroup,
                oem_code=item.s_OEMCODE,
                ecn=item.s_ECN,
            ))

    # 3) 批量写入（跳过已有记录）
    record_upserted = await mongo.save_sales_order_bom_records(all_records, skip_existing=True)
    print(
        f"  [{sale_no}] 完成: {bom_mfg_count}/{len(mfg_orders)} 个工单有 BOM 数据, "
        f"共 {len(all_records)} 条 BOM 行, 写入 {record_upserted} 条",
        flush=True,
    )

    return SalesOrderBomImportResult(
        sale_no=sale_no,
        mfg_orders=mfg_orders,
        mfg_count=bom_mfg_count,
        record_count=len(all_records),
        record_upserted=record_upserted,
    )
