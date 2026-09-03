"""Drop the deprecated local sales-order cache after migration verification.

The independent gateway owns the authoritative ``sales_orders_sap`` collection.
This command only drops the copy in the application database. It remains
disabled by default because the metadata browser and repair backfill tools
still use the local copy; dashboard reads have already moved to the gateway.
"""

from __future__ import annotations

import argparse
import asyncio

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import get_settings


async def drop_collection(force: bool) -> None:
    if not force:
        raise SystemExit(
            "Refusing to drop sales_orders_sap: metadata/backfill consumers remain; audit them before --force."
        )
    settings = get_settings()
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    try:
        dropped = await client[settings.MONGODB_DB_NAME].drop_collection("sales_orders_sap")
        print(f"Dropped local sales_orders_sap: {dropped}")
    finally:
        client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force", action="store_true", help="confirm that all remaining consumers were migrated"
    )
    args = parser.parse_args()
    asyncio.run(drop_collection(args.force))


if __name__ == "__main__":
    main()
