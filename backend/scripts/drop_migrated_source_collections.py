"""Drop local SAP source copies after gateway migration verification.

The gateway is authoritative for these five collections. SCS and MES metadata
collections are intentionally excluded because they remain local by design.
Run without ``--apply`` first to review counts.
"""

from __future__ import annotations

import argparse
import asyncio

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import get_settings

MIGRATED_SOURCE_COLLECTIONS = (
    "sales_orders_sap",
    "order_bom_postings_sap",
    "repair_records_sap",
    "station_records_sap",
    "serial_bindings_sap",
)


async def drop(*, apply: bool) -> None:
    settings = get_settings()
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    try:
        db = client[settings.MONGODB_DB_NAME]
        existing = set(await db.list_collection_names())
        for name in MIGRATED_SOURCE_COLLECTIONS:
            if name not in existing:
                print(f"SKIP {name}: collection does not exist")
                continue
            count = await db[name].count_documents({})
            if not apply:
                print(f"DRY-RUN {name}: {count} documents")
                continue
            await db.drop_collection(name)
            print(f"DROPPED {name}: {count} documents")
    finally:
        client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="actually drop migrated source copies")
    args = parser.parse_args()
    asyncio.run(drop(apply=args.apply))


if __name__ == "__main__":
    main()
