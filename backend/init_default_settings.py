#!/usr/bin/env python3
"""
初始化默认配置数据到 MongoDB

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
        client.admin.command('ping')
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

    # 2. 邮件预警配置
    email_config = {
        "key": "email_alert_config",
        "enabled": True,
        "emails": "manager@company.com; quality-team@company.com",
        "attachReport": True,
        "updatedAt": now,
    }
    configs.update_one({"key": "email_alert_config"}, {"$set": email_config}, upsert=True)
    print("✓ 邮件预警配置已写入（默认启用）")

    # 3. AI 模型配置
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


if __name__ == "__main__":
    main()
