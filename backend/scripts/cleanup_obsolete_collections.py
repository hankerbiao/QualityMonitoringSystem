"""Remove MongoDB collections that are no longer used by the application.

The allowlist is intentionally conservative.  The command is a dry-run unless
``--apply`` is supplied, and it never drops business source collections or
``assembly_records_bak`` (the retained backup copy).
"""

from __future__ import annotations

import argparse
import asyncio

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import get_settings

OBSOLETE_COLLECTIONS = (
    # No runtime readers; historical backfill/sync audit only.
    "repair_order_backfill_runs",
    "repair_sn_api_backfill_runs",
    "repair_customer_backfill_runs",
    "order_bom_gstrs_backfill_runs",
    "order_bom_sales_order_cleanup_runs",
    "station_pass_field_backfill_checkpoints",
    "station_pass_field_backfill_runs",
    "scs_doa_progress",
    "scs_doa_sales_order_progress",
    "rty_sync_runs",
    "_hana_sync_runs",
    # Legacy generic/SCS progress collections with no current-code readers.
    "_sync_runs",
    "_sync_checkpoints",
    "scs_doa_results_progress",
    "scs_change_results_progress",
    # Empty legacy collections with no current-code readers.
    "rty_data",
    "sales_orders",
    "sales_order_bom",
    "no_data_orders",
    # MES assembly source is no longer consumed by the application.
    "assembly_records",
)


async def cleanup(*, apply: bool) -> None:
    settings = get_settings()
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    try:
        db = client[settings.MONGODB_DB_NAME]
        existing = set(await db.list_collection_names())
        for name in OBSOLETE_COLLECTIONS:
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
    parser.add_argument(
        "--apply",
        action="store_true",
        help="actually drop the allowlisted collections (default: dry-run)",
    )
    args = parser.parse_args()
    asyncio.run(cleanup(apply=args.apply))


if __name__ == "__main__":
    main()
