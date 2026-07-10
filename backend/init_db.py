"""
脚本: 初始化默认配置数据
"""
import asyncio
from datetime import datetime


async def init_default_configs(db):
    """初始化默认配置数据

    注意：机型目标直通率不再在此写入假值。目标率由用户在设置页配置，
    未配置时后端按 100 处理，避免把假数据当真实指标。
    """

    # 默认邮件预警配置
    await db.configs.update_one(
        {"key": "email_alert_config"},
        {
            "$set": {
                "key": "email_alert_config",
                "enabled": True,
                "emails": "manager@company.com; quality-team@company.com",
                "attachReport": True,
                "updatedAt": datetime.utcnow(),
            }
        },
        upsert=True
    )
    print("✓ 已初始化默认邮件预警配置")

    # 默认功能开关
    await db.configs.update_one(
        {"key": "feature_flags"},
        {
            "$set": {
                "key": "feature_flags",
                "voiceInputEnabled": False,
                "updatedAt": datetime.utcnow(),
            }
        },
        upsert=True
    )
    print("✓ 已初始化默认功能开关配置")


async def main():
    """主函数"""
    from app.db.mongodb import connect_to_mongo, get_database

    print("正在连接 MongoDB...")
    await connect_to_mongo()

    db = get_database()

    print("开始初始化数据...")
    await init_default_configs(db)

    print("\n初始化完成！")
    print("\n可以通过以下命令启动后端服务:")
    print("  cd backend")
    print("  pip install -r requirements.txt")
    print("  uvicorn app.main:app --reload --port 8000")


if __name__ == "__main__":
    asyncio.run(main())
