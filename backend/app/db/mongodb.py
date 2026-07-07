"""
MongoDB connection management using Motor (async MongoDB driver)
"""
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from typing import Optional

from app.core.config import get_settings


class MongoDB:
    """MongoDB 连接管理器"""

    client: Optional[AsyncIOMotorClient] = None
    db: Optional[AsyncIOMotorDatabase] = None


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

    # 故障明细索引
    await mongodb.db.defect_details.create_index([("recordId", 1)])

    # 投入明细索引
    await mongodb.db.input_details.create_index([("recordId", 1)])

    # 用户索引
    await mongodb.db.users.create_index("itcode", unique=True)

    # 会话索引
    await mongodb.db.sessions.create_index("sessionId", unique=True)
    await mongodb.db.sessions.create_index("expiresAt")


def get_database() -> AsyncIOMotorDatabase:
    """获取数据库实例"""
    if mongodb.db is None:
        raise RuntimeError("Database not initialized")
    return mongodb.db