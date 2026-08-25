#!/usr/bin/env python3
"""Backfill stable SCS DOA keys before enabling incremental synchronization."""

from __future__ import annotations

import logging
import argparse

from pymongo import MongoClient

from scs_sync_lib import DB_NAME, DOA_COLLECTION, MONGO_URL, ensure_indexes, migrate_stable_keys

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description="迁移 SCS DOA 稳定业务键并清理重复记录")
    parser.parse_args()
    mongo = MongoClient(MONGO_URL, serverSelectionTimeoutMS=30_000)
    try:
        collection = mongo[DB_NAME][DOA_COLLECTION]
        result = migrate_stable_keys(collection)
        ensure_indexes(collection)
        logger.info("SCS 稳定键迁移完成: %s", result)
    finally:
        mongo.close()


if __name__ == "__main__":
    main()
