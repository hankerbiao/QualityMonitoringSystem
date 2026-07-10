"""
统计 fault_info 中的故障明细并输出分析报告。

fault_info 是故障数据的唯一真源，API (get_defect_details / get_defect_details_by_order)
直接读取它；原先复制到 defect_details 集合的冗余逻辑已移除，本脚本仅做统计分析。

用法:
    cd backend
    uv run python export_defect_details.py
"""
import asyncio

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import get_settings
from app.models.documents import Collections


async def main():
    settings = get_settings()
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.MONGODB_DB_NAME]

    print(f"正在统计故障数据: {settings.MONGODB_DB_NAME}")

    # 故障类型统计 (按 fault_category 分组)
    stats_pipeline = [
        {"$group": {
            "_id": {"$ifNull": ["$fault_category", "未知"]},
            "count": {"$sum": 1},
            "sns": {"$addToSet": "$sn"},
        }},
        {"$sort": {"count": -1}},
    ]
    cursor = db[Collections.FAULT_INFO].aggregate(stats_pipeline)
    stats = await cursor.to_list(length=None)

    total = sum(s["count"] for s in stats)
    print("\n===== 故障统计完成 =====")
    print(f"总故障记录: {total}")
    print(f"故障类型: {len(stats)} 种")
    for s in stats:
        print(f"  {s['_id']}: {s['count']} 条 ({len(s['sns'])} 台机器)")

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
