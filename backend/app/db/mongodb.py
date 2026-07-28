"""
MongoDB connection management using Motor (async MongoDB driver)
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings


class MongoDB:
    """MongoDB 连接管理器"""

    client: AsyncIOMotorClient | None = None
    db: AsyncIOMotorDatabase | None = None


mongodb = MongoDB()


async def connect_to_mongo() -> None:
    """连接 MongoDB"""
    settings = get_settings()
    mongodb.client = AsyncIOMotorClient(settings.MONGODB_URL)
    mongodb.db = mongodb.client[settings.MONGODB_DB_NAME]

    # 创建索引以提高查询性能
    await create_indexes()

    print(f"Connected to MongoDB: {settings.MONGODB_DB_NAME}")


async def close_mongo_connection() -> None:
    """断开 MongoDB 连接"""
    if mongodb.client:
        mongodb.client.close()
        print("Closed MongoDB connection")


async def create_indexes() -> None:
    """创建必要的索引"""
    if mongodb.db is None:
        return

    # RTY 数据索引
    await mongodb.db.rty_data.create_index([("time", -1)])
    await mongodb.db.rty_data.create_index([("productModel", 1)])
    await mongodb.db.rty_data.create_index([("customer", 1)])
    await mongodb.db.rty_data.create_index([("base", 1)])
    await mongodb.db.rty_data.create_index([("model", 1)])
    await mongodb.db.rty_data.create_index([
        ("time", -1),
        ("productModel", 1),
        ("customer", 1),
        ("base", 1)
    ])

    # 机器信息索引 (machine_info 为 MES 录入机器数据，按 sn 唯一、按销售订单/生产订单批量查询)
    await mongodb.db.machine_info.create_index([("sn", 1)], unique=True)
    await mongodb.db.machine_info.create_index([("sale_no", 1)])
    await mongodb.db.machine_info.create_index([("mfg_order", 1)])
    await mongodb.db.machine_info.create_index([("customer_id", 1)])

    # 故障明细索引 (fault_info 为故障数据唯一真源，按 sn 批量查询、按分类聚合)
    await mongodb.db.fault_info.create_index([("sn", 1)])
    await mongodb.db.fault_info.create_index([("fault_category", 1)])
    await mongodb.db.fault_info.create_index([("reinsert_lot", 1)])  # LRR 故障聚合

    # 用户索引
    await mongodb.db.users.create_index("itcode", unique=True)

    # 会话索引
    await mongodb.db.sessions.create_index("sessionId", unique=True)
    await mongodb.db.sessions.create_index("expiresAt")

    # 运营监控事件：按时间聚合，原始明细保留 180 天
    await mongodb.db.usage_events.create_index([("itcode", 1), ("timestamp", -1)])
    await mongodb.db.usage_events.create_index([("module", 1), ("timestamp", -1)])
    await mongodb.db.usage_events.create_index("timestamp", expireAfterSeconds=180 * 24 * 60 * 60)

    # 无数据订单索引（按 sale_no 唯一，避免重复插入）
    await mongodb.db.no_data_orders.create_index("sale_no", unique=True)

    # 销售订单索引（按 sales_order_sn 唯一，用于采集模块）
    await mongodb.db.sales_orders.create_index("sales_order_sn", unique=True)
    await mongodb.db.sales_orders.create_index("import_status", sparse=True)

    # 装配记录索引（按 mfg_order 批量查询、chassis_no 查重）
    await mongodb.db.assembly_records.create_index([
        ("mfg_order", 1), ("chassis_no", 1)
    ], unique=True)
    await mongodb.db.assembly_records.create_index("chassis_no")

    # 销售订单 BOM 索引（按销售单号查、按 (销售单+工单+物料) 去重）
    await mongodb.db.sales_order_bom.create_index([
        ("sale_no", 1), ("mfg_order", 1), ("bom_product_name", 1)
    ], unique=True)
    await mongodb.db.sales_order_bom.create_index("sale_no")
    await mongodb.db.sales_order_bom.create_index("mfg_order")


def get_database() -> AsyncIOMotorDatabase:
    """获取数据库实例"""
    if mongodb.db is None:
        raise RuntimeError("Database not initialized")
    return mongodb.db
