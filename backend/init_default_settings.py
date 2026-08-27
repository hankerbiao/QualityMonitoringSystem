#!/usr/bin/env python3
"""
初始化默认配置数据到 MongoDB

合并了原 init_db.py 的全部功能（feature_flags），该文件已删除。
保持独立无依赖（直接使用 pymongo，不依赖 FastAPI/Motor 项目包）。

用法: python init_default_settings.py
"""

import os
from datetime import datetime, timezone

from pymongo import MongoClient

# MongoDB 连接配置（可通过环境变量覆盖）
MONGODB_URL = os.environ.get("MONGODB_URL", "mongodb://10.17.154.252:27019")
DB_NAME = os.environ.get("MONGODB_DB_NAME", "quality_monitoring")
CONNECT_TIMEOUT_MS = 5000  # 5 秒超时


def utcnow():
    return datetime.now(timezone.utc)


def main():
    print(f"正在连接 MongoDB: {MONGODB_URL}...")
    try:
        client = MongoClient(MONGODB_URL, serverSelectionTimeoutMS=CONNECT_TIMEOUT_MS)
        client.admin.command("ping")
    except Exception as e:
        print(f"✗ MongoDB 连接失败: {e}")
        print("请确保后端服务已启动，或通过环境变量指定正确的 MONGODB_URL")
        return

    db = client[DB_NAME]
    configs = db["configs"]
    now = utcnow()

    # 1. MES 系统接入配置
    mes_config = {
        "key": "mes_config",
        "username": "liushy2",
        "password": "Lsy825516",
        "updatedAt": now,
    }
    configs.update_one({"key": "mes_config"}, {"$set": mes_config}, upsert=True)
    print("✓ MES 配置已写入: liushy2 / ********")

    # 2. 关键工位影像追溯（两个实时数据源共用凭据）
    process_record_config = {"key": "process_record_config", "username": "caokp"}
    configs.update_one(
        {"key": "process_record_config"},
        {"$setOnInsert": process_record_config},
        upsert=True,
    )
    print("✓ 关键工位影像追溯默认账号已初始化（密码请在系统设置中保存）")

    # 3. 邮件预警配置
    email_config = {
        "key": "email_alert_config",
        "enabled": True,
        "emails": "manager@company.com; quality-team@company.com",
        "triggerCondition": "当某机型周生产量达到设定阈值（默认 50 台），且实际 RTY 低于目标直通率时，系统将在每天 17:00 自动发送预警邮件。",
        "weeklyProductionThreshold": 50,
        "updatedAt": now,
    }
    configs.update_one(
        {"key": "email_alert_config"},
        {"$set": email_config, "$unset": {"lrrAlertThreshold": ""}},
        upsert=True,
    )
    print("✓ 邮件预警配置已写入（默认启用）")

    # 4. AI 模型配置
    ai_config = {
        "key": "ai_config",
        "apiUrl": "http://10.41.101.220:8000/v1/chat/completions",
        "modelId": "/models/coder/minimax/MiniMax-M2",
        "apiKey": "",
        "maxTokens": 4096,
        "updatedAt": now,
    }
    configs.update_one({"key": "ai_config"}, {"$set": ai_config}, upsert=True)
    print("✓ AI 模型配置已写入")
    print("  - API: http://10.41.101.220:8000/v1/chat/completions")
    print("  - Model: /models/coder/minimax/MiniMax-M2")

    # 5. 功能开关（原 init_db.py）
    feature_flags = {
        "key": "feature_flags",
        "voiceInputEnabled": False,
        "updatedAt": now,
    }
    configs.update_one({"key": "feature_flags"}, {"$set": feature_flags}, upsert=True)
    print("✓ 功能开关配置已写入（voiceInputEnabled: false）")

    # 验证写入
    print("\n当前 configs 集合中的数据:")
    for doc in configs.find():
        key = doc.pop("key")
        doc.pop("_id", None)
        doc.pop("updatedAt", None)
        if "password" in doc:
            doc["password"] = "********"
        print(f"  [{key}] {doc}")

    client.close()
    print("\n初始化完成！")
    print("注：已合并原 init_db.py 的全部配置，该文件已删除。")


if __name__ == "__main__":
    main()
