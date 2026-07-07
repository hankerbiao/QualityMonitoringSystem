"""
脚本: 初始化默认配置数据
"""
import asyncio
from datetime import datetime


async def init_default_configs(db):
    """初始化默认配置数据"""

    # 默认机型指标
    default_targets = {
        "6210 C21 BOX": 99.5,
        "6210 C21": 99.0,
        "6210 C31": 98.5,
        "普通机型": 99.0,
        "复合机型": 98.5,
        "Qiandaohu 一拖多机型": 98.0,
    }

    await db.configs.update_one(
        {"key": "model_targets"},
        {
            "$set": {
                "key": "model_targets",
                "targets": default_targets,
                "updatedAt": datetime.utcnow(),
            }
        },
        upsert=True
    )
    print("✓ 已初始化默认机型指标配置")

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