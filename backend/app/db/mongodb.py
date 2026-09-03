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

    # 机器信息索引 (machine_info 为 MES 录入机器数据，按 sn 唯一、按销售订单/生产订单批量查询)
    await mongodb.db.machine_info.create_index([("sn", 1)], unique=True)
    await mongodb.db.machine_info.create_index([("sale_no", 1)])
    await mongodb.db.machine_info.create_index([("mfg_order", 1)])
    await mongodb.db.machine_info.create_index([("customer_id", 1)])

    # 故障明细索引 (fault_info 为故障数据唯一真源，按 sn 批量查询、按分类聚合)
    await mongodb.db.fault_info.create_index([("sn", 1)])
    await mongodb.db.fault_info.create_index([("fault_category", 1)])
    await mongodb.db.fault_info.create_index([("reinsert_lot", 1)])  # LRR 故障聚合
    await mongodb.db.fault_info.create_index([("mfg_order", 1)])
    await mongodb.db.fault_info.create_index([("sale_no", 1)])

    # 用户索引
    await mongodb.db.users.create_index("itcode", unique=True)

    # 会话索引
    await mongodb.db.sessions.create_index("sessionId", unique=True)
    await mongodb.db.sessions.create_index("expiresAt")

    # 运营监控事件：按时间聚合，原始明细保留 180 天
    await mongodb.db.usage_events.create_index([("itcode", 1), ("timestamp", -1)])
    await mongodb.db.usage_events.create_index([("module", 1), ("timestamp", -1)])
    await mongodb.db.usage_events.create_index("timestamp", expireAfterSeconds=180 * 24 * 60 * 60)

    # LRR list responses are persisted briefly so the expensive gateway join
    # does not run once per dashboard visit or backend restart.
    await mongodb.db.lrr_list_cache.create_index("expiresAt", expireAfterSeconds=0)
    await mongodb.db.lrr_list_cache_locks.create_index("expiresAt", expireAfterSeconds=0)

    # The local-data fallback remains supported when no gateway is configured.
    await mongodb.db.order_bom_postings_sap.create_index(
        [("AUFNR_1", 1), ("VBELN_EX", 1), ("LGORT", 1), ("MATNR", 1)]
    )
    await mongodb.db.order_bom_postings_sap.create_index([("BUDAT_MKPF", 1), ("AUFNR_1", 1)])
    await mongodb.db.repair_records_sap.create_index([("AUFNR", 1), ("ZDATE_WX", 1)])
    await mongodb.db.repair_records_sap.create_index([("VBELN", 1), ("ZDATE_WX", 1)])

    # Sales orders are owned by the independent data gateway.  The application
    # database deliberately does not create or maintain a local copy.
    # 历史同步水位线仍由运营监控读取；运行审计已不再创建。
    await mongodb.db.rty_sync_checkpoints.create_index("updated_at")
    await mongodb.db.scs_doa_results.create_index(
        [("scs_enrichment.is_5000", 1), ("data.判定结果", 1), ("scs_enrichment.accepted_date", 1)]
    )
    await mongodb.db.scs_doa_results.create_index(
        [("is_5000", 1), ("data.判定结果", 1), ("scs_enrichment.accepted_date", 1)]
    )
    await mongodb.db.scs_doa_results.create_index("scs_enrichment.sales_order")
    await mongodb.db.scs_doa_results.create_index("data.销售订单号")
    # SCS 换上换下采集结果：按服务单号关联 DOA，支撑换件率聚合
    await mongodb.db.scs_change_results.create_index("data.服务单号")
    await mongodb.db.scs_change_results.create_index(
        [("data.操作类型", 1), ("data.操作时间", 1), ("data.服务单号", 1)]
    )
    await mongodb.db.scs_change_results.create_index(
        [("data.服务单号", 1), ("data.操作类型", 1), ("data.操作时间", 1)]
    )


def get_database() -> AsyncIOMotorDatabase:
    """获取数据库实例"""
    if mongodb.db is None:
        raise RuntimeError("Database not initialized")
    return mongodb.db
