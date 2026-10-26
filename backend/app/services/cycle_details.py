"""Source-backed detail rows for RTY cycle dashboard cells."""

from typing import Any

from app.schemas.rty import RTYCycleDetails
from app.services import rty_export

ORDER_DETAIL_FIELDS = tuple(
    field for field in rty_export.ORDER_FIELDS if field != "packagingQuantity"
)


async def build_cycle_details(
    filters: dict[str, str],
    *,
    product_models: list[str] | None = None,
    bases: list[str] | None = None,
    customers: list[str] | None = None,
) -> RTYCycleDetails:
    orders, faults = await rty_export._load_sources(
        filters,
        product_models=product_models,
        bases=bases,
        customers=customers,
    )
    order_rows = [
        {field: row.get(field) for field in ORDER_DETAIL_FIELDS}
        for row in orders
    ]
    fault_rows: list[dict[str, Any]] = []
    for row, matches in faults:
        for model, counted_sn in sorted(matches):
            fault_rows.append(
                {
                    **row,
                    "matchedModel": model,
                    "countedSN": counted_sn,
                }
            )
    return RTYCycleDetails(orders=order_rows, faults=fault_rows)
