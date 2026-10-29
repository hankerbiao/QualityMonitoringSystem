"""Shared exact-match filters for dashboard order populations."""

from __future__ import annotations

import asyncio
from typing import Any

from app.services.lrr_normalization import normalize_sales_order
from app.services.rty_shared import normalize_order


def values(items: list[str] | tuple[str, ...] | None) -> set[str]:
    return {str(item).strip() for item in items or () if str(item).strip()}


def order_matches(
    production: Any, sales: Any, production_orders: set[str], sales_orders: set[str]
) -> bool:
    return (not production_orders or normalize_order(production) in production_orders) and (
        not sales_orders or normalize_sales_order(sales) in sales_orders
    )


async def orders_for_sns(
    sns: set[str], date_from: str, date_to: str, *, include_faults: bool = True
) -> set[str]:
    """Resolve SNs through station and repair records, then apply base scope on orders."""
    from app.services import rty_gateway

    if not sns:
        return set()
    semaphore = asyncio.Semaphore(8)

    async def station_rows(sn: str):
        async with semaphore:
            if date_from and date_to:
                start, end = rty_gateway._date_range(date_from, date_to)
                return await rty_gateway._station_records_in_range(start, end, serial_number=sn)
            return await rty_gateway.data_gateway.all_station_rows(
                dateFrom=date_from, dateTo=date_to, timeField="planned", sn=sn
            )

    batches = await asyncio.gather(*(station_rows(sn) for sn in sorted(sns)))
    faults = (
        await rty_gateway._faults_for_sns(
            sns, date_from=date_from.replace("-", ""), date_to=date_to.replace("-", "")
        )
        if include_faults
        else []
    )
    result = {
        normalize_order(raw.get("AUFNR"))
        for batch in batches
        for item in batch
        if (raw := rty_gateway._raw(item)) and str(raw.get("PCODE") or "").strip() in sns
    }
    result.update(
        normalize_order(row.get("AUFNR"))
        for row in faults
        if str(row.get("PCODE") or "").strip() in sns
    )
    result.discard("")
    return result
