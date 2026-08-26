#!/usr/bin/env python3
"""Backfill stable SCS DOA keys before enabling incremental synchronization."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from pymongo import MongoClient

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from scs_sync_lib import (  # noqa: E402
    DB_NAME,
    DOA_COLLECTION,
    MONGO_URL,
    ensure_indexes,
    migrate_stable_keys,
)

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
