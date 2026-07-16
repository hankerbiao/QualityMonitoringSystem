"""
数据采集模块

整合 hana 销售订单同步 + MES 机器/故障数据导入 + 装配记录采集。
取代中间 CSV 文件，通过 MongoDB 的 sales_orders 集合串联多个阶段。

阶段一（sync）：
    调用 integrate_mongo_data.main() 从 hana 查询销售订单，
    去重后写入 sales_orders 集合，标记 import_status="pending"。

阶段二（import）：
    从 sales_orders 读取 pending 状态的订单，
    逐个调用 import_sale_order 从 MES 拉取机器/故障并写入 machine_info/fault_info，
    完成后更新 import_status 为 "done" 或 "no_data"。

阶段三（assembly）：
    从 sales_orders 读取 assembly_status="pending" 的订单，
    逐个调用 import_assembly_records 从 MES 拉取装配记录并写入 assembly_records，
    完成后更新 assembly_status 为 "done" 或 "no_data"。
"""

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from app.db.mongodb import get_database
from app.models.documents import Collections
from app.services.mes_import import import_assembly_records, import_sale_order

# 支持 scripts/ 下脚本 import integrate_mongo_data
_SCRIPTS_DIR = Path(__file__).resolve().parent.parent.parent / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

# 导入状态
ImportStatus = Literal["pending", "done", "no_data", "error"]


async def sync_sales_orders() -> int:
    """阶段一：从 hana 同步销售订单号到 sales_orders 集合。

    运行 integrate_mongo_data.main()（SSH 隧道 + hana 多表查询），
    从整合结果的 sales_order_sn 字段提取唯一订单号，
    upsert 写入 sales_orders 集合（新单标记 pending，已有单跳过）。

    Returns:
        新增的订单数（首次标记为 pending 的数量）。
    """
    import integrate_mongo_data  # type: ignore[import-untyped]

    result, _ = await integrate_mongo_data.main()

    # 提取唯一 sales_order_sn
    seen: set[str] = set()
    orders: list[str] = []
    for item in result:
        o = (item.get("sales_order_sn") or "").strip()
        if o and o not in seen:
            seen.add(o)
            orders.append(o)

    print(f"hana 整合完成: {len(result)} 行, 唯一订单 {len(orders)} 个", flush=True)

    # 写入 sales_orders 集合（只新增，不覆盖已有）
    db = get_database()
    col = db[Collections.SALES_ORDERS]
    new_count = 0
    now = datetime.now(timezone.utc)
    for sale_no in orders:
        result = await col.update_one(
            {"sales_order_sn": sale_no},
            {
                "$setOnInsert": {
                    "sales_order_sn": sale_no,
                    "import_status": "pending",
                    "assembly_status": "pending",
                    "machine_count": 0,
                    "fault_count": 0,
                    "created_at": now,
                    "checked_at": None,
                }
            },
            upsert=True,
        )
        if result.upserted_id:
            new_count += 1

    print(
        f"sales_orders 集合: 新增 {new_count} 单, "
        f"累计 {await col.count_documents({})} 单",
        flush=True,
    )
    return new_count


async def import_sales_orders(
    concurrency: int = 3,
    limit: int | None = None,
    dry_run: bool = False,
    incremental: bool = False,
) -> dict:
    """阶段二：从 sales_orders 读取 pending 订单，逐单导入 MES 数据。

    流程：
      1. 从 sales_orders 读取 import_status="pending" 的订单
      2. 默认跳过已在 machine_info 中存在数据的订单 → 标记 "done"
         （incremental=True 时跳过此步，直接处理所有 pending 订单）
      3. 调用 import_sale_order 查询 MES 并写入
         （incremental=True 时传 skip_existing=True，只追加新 SN）
      4. 有数据 → "done"，无数据 → "no_data"，异常 → "error"

    Args:
        concurrency: 并发数。
        limit: 最多处理 N 单（用于测试）。
        dry_run: 只打印不执行。
        incremental: 增量模式，不清除旧数据、不跳过已有订单，只追加新机器/故障。
    """
    db = get_database()
    col = db[Collections.SALES_ORDERS]
    machine_col = db[Collections.MACHINE_INFO]

    # 1) 读取 pending 订单
    pending = await col.find({"import_status": "pending"}).to_list(length=None)
    pending_orders = [doc["sales_order_sn"] for doc in pending]

    if not pending_orders:
        print("没有待处理的订单", flush=True)
        return {"total": 0, "done": 0, "no_data": 0, "error": 0, "skipped": 0}

    if not incremental:
        # 2) 跳过已在 machine_info 中有数据的订单（全量模式）
        existing = await machine_col.distinct(
            "sale_no", {"sale_no": {"$in": pending_orders}}
        )
        existing_set = set(existing)
        orders = [o for o in pending_orders if o not in existing_set]

        # 将已有数据的订单标记为 done
        if existing_set:
            await col.update_many(
                {"sales_order_sn": {"$in": list(existing_set)}},
                {"$set": {"import_status": "done", "checked_at": datetime.now(timezone.utc)}},
            )
            print(f"跳过已有数据: {len(existing_set)} 单, 标记为 done", flush=True)
    else:
        # 增量模式：处理所有 pending 订单（不清除旧数据，不跳过）
        orders = pending_orders
        print(f"增量模式: 处理全部 {len(orders)} 单（已存在的机器/故障跳过）", flush=True)

    if limit:
        orders = orders[:limit]

    total = len(orders)
    if total == 0:
        print("没有待处理的订单（全部已处理或跳过）", flush=True)
        return {"total": 0, "done": 0, "no_data": 0, "error": 0, "skipped": len(existing_set) if not incremental else 0}

    print(f"待导入: {total} 单" + (f" (已跳过 {len(existing_set)} 单)" if not incremental else ""), flush=True)

    if dry_run:
        print("DRY-RUN: 仅列出前 10 单：")
        for o in orders[:10]:
            print(f"  {o}")
        return {"total": total, "dry_run": True}

    # 3) 并发导入
    sem = asyncio.Semaphore(concurrency)
    skipped = len(existing_set) if not incremental else 0
    stats = {"total": total, "done": 0, "no_data": 0, "error": 0, "skipped": skipped}
    start_time = datetime.now(timezone.utc)

    async def process(sale_no: str):
        nonlocal stats
        async with sem:
            now = datetime.now(timezone.utc)
            try:
                result = await import_sale_order(sale_no, skip_existing=incremental)
                if result.machine_count > 0 or result.fault_count > 0:
                    status: ImportStatus = "done"
                    print(
                        f"  [OK] {sale_no}: 机器 {result.machine_count} 台"
                        f" / 故障 {result.fault_count} 条",
                        flush=True,
                    )
                    stats["done"] += 1
                else:
                    status = "no_data"
                    print(f"  [--] {sale_no}: 无数据", flush=True)
                    stats["no_data"] += 1
                await col.update_one(
                    {"sales_order_sn": sale_no},
                    {
                        "$set": {
                            "import_status": status,
                            "assembly_status": "pending" if status == "done" else "no_data",
                            "machine_count": result.machine_upserted,
                            "fault_count": result.fault_upserted,
                            "checked_at": now,
                        }
                    },
                )
            except Exception as e:
                stats["error"] += 1
                print(f"  [ERR] {sale_no}: {type(e).__name__}: {e}", flush=True)
                await col.update_one(
                    {"sales_order_sn": sale_no},
                    {"$set": {"import_status": "error", "checked_at": now}},
                )

    await asyncio.gather(*(process(o) for o in orders))

    elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
    print()
    print("=" * 60)
    print("导入完成")
    print("=" * 60)
    print(f"总耗时:        {elapsed:.1f} 秒")
    print(f"待处理:        {total}")
    print(f"已完成(done):  {stats['done']}")
    print(f"无数据:        {stats['no_data']}")
    print(f"错误:          {stats['error']}")
    print(f"已跳过:        {stats['skipped']}")

    return stats


async def import_sales_orders_assembly(
    concurrency: int = 3,
    limit: int | None = None,
    dry_run: bool = False,
) -> dict:
    """阶段三：从 sales_orders 读取待处理的订单，逐单导入装配记录。

    流程：
      1. 从 sales_orders 读取 assembly_status="pending" 的订单
      2. 调用 import_assembly_records 从 MES 拉取装配记录并写入 assembly_records
      3. 有数据 → "done"，无数据 → "no_data"，异常 → "error"

    Args:
        concurrency: 并发数。
        limit: 最多处理 N 单（用于测试）。
        dry_run: 只打印不执行。

    Returns:
        汇总统计字典。
    """
    db = get_database()
    col = db[Collections.SALES_ORDERS]

    # 1) 读取 pending 订单
    pending = await col.find({"assembly_status": "pending"}).to_list(length=None)
    pending_orders = [doc["sales_order_sn"] for doc in pending]

    if not pending_orders:
        print("没有待处理的装配记录订单", flush=True)
        return {"total": 0, "done": 0, "no_data": 0, "error": 0, "skipped": 0}

    if limit:
        orders = pending_orders[:limit]
    else:
        orders = pending_orders

    total = len(orders)
    print(f"待导入装配记录: {total} 单", flush=True)

    if dry_run:
        print("DRY-RUN: 仅列出前 10 单：")
        for o in orders[:10]:
            print(f"  {o}")
        return {"total": total, "dry_run": True}

    # 2) 并发导入
    sem = asyncio.Semaphore(concurrency)
    stats = {"total": total, "done": 0, "no_data": 0, "error": 0, "skipped": 0}
    start_time = datetime.now(timezone.utc)

    async def process(sale_no: str):
        nonlocal stats
        async with sem:
            now = datetime.now(timezone.utc)
            try:
                result = await import_assembly_records(sale_no)
                if result.record_count > 0:
                    status: ImportStatus = "done"
                    print(
                        f"  [OK] {sale_no}: {result.record_count} 条装配记录"
                        f" ({len(result.mfg_orders)} 个工单)",
                        flush=True,
                    )
                    stats["done"] += 1
                else:
                    status = "no_data"
                    print(f"  [--] {sale_no}: 无装配记录", flush=True)
                    stats["no_data"] += 1
                await col.update_one(
                    {"sales_order_sn": sale_no},
                    {
                        "$set": {
                            "assembly_status": status,
                            "assembly_record_count": result.record_count,
                            "assembly_mfg_orders": result.mfg_orders,
                            "assembly_checked_at": now,
                        }
                    },
                )
            except Exception as e:
                stats["error"] += 1
                print(f"  [ERR] {sale_no}: {type(e).__name__}: {e}", flush=True)
                await col.update_one(
                    {"sales_order_sn": sale_no},
                    {"$set": {"assembly_status": "error", "assembly_checked_at": now}},
                )

    await asyncio.gather(*(process(o) for o in orders))

    elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
    print()
    print("=" * 60)
    print("装配记录导入完成")
    print("=" * 60)
    print(f"总耗时:        {elapsed:.1f} 秒")
    print(f"待处理:        {total}")
    print(f"已完成(done):  {stats['done']}")
    print(f"无数据:        {stats['no_data']}")
    print(f"错误:          {stats['error']}")

    return stats
