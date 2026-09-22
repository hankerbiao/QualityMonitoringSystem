#!/usr/bin/env python3
"""One-time cleanup for users created by the retired OA login flow.

This script is intentionally explicit and is never called during application startup.
It removes legacy users without a local password hash and revokes all sessions. The
business collections are untouched.
"""

import os

from pymongo import MongoClient


def main() -> None:
    mongo_url = os.environ.get("MONGODB_URL", "mongodb://10.17.154.252:27019")
    db_name = os.environ.get("MONGODB_DB_NAME", "quality_monitoring")
    admin_username = os.environ.get("DEFAULT_ADMIN_USERNAME", "").strip()
    if not admin_username:
        raise SystemExit("DEFAULT_ADMIN_USERNAME must be set before cleanup")

    client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
    try:
        client.admin.command("ping")
        db = client[db_name]
        legacy_filter = {
            "$and": [
                {"username": {"$ne": admin_username}},
                {
                    "$or": [
                        {"passwordHash": {"$exists": False}},
                        {"profile.auth_type": {"$ne": "local"}},
                    ]
                },
            ]
        }
        users_result = db.users.delete_many(legacy_filter)
        sessions_result = db.sessions.delete_many({})
        print(f"Removed {users_result.deleted_count} legacy OA users")
        print(f"Revoked {sessions_result.deleted_count} sessions")
        print("Business collections were not modified")
    finally:
        client.close()


if __name__ == "__main__":
    main()
