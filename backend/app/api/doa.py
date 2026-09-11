"""DOA 报修率 API。"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.auth import get_current_user
from app.schemas.doa import (
    DoaDashboardResponse,
    DoaFilters,
    DoaRawFilters,
    DoaRepairsResponse,
)
from app.services.doa_service import (
    build_doa_dashboard,
    get_doa_options,
    get_doa_raw,
    get_doa_repairs,
)

router = APIRouter()


def _filters(
    dateFrom: str | None = None,
    dateTo: str | None = None,
    customer: str | None = None,
    model: str | None = None,
    timeGranularity: str = "month",
    acceptedDateFrom: str | None = None,
    acceptedDateTo: str | None = None,
) -> DoaFilters:
    if timeGranularity not in {"year", "month", "day"}:
        timeGranularity = "month"
    return DoaFilters(
        dateFrom=dateFrom,
        dateTo=dateTo,
        acceptedDateFrom=acceptedDateFrom,
        acceptedDateTo=acceptedDateTo,
        customer=customer,
        model=model,
        timeGranularity=timeGranularity,
    )  # type: ignore[arg-type]


@router.get("/options")
async def doa_options(_: Annotated[dict, Depends(get_current_user)]):
    return await get_doa_options()


@router.get("/raw")
async def doa_raw(
    _: Annotated[dict, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    acceptedDateFrom: str | None = Query(None),
    acceptedDateTo: str | None = Query(None),
    keyword: str | None = Query(None, max_length=100),
    serviceNumber: str | None = Query(None, max_length=100),
    salesOrder: str | None = Query(None, max_length=100),
    serialNumber: str | None = Query(None, max_length=100),
    customer: str | None = Query(None, max_length=100),
    product: str | None = Query(None, max_length=100),
    doaType: str | None = Query(None, max_length=100),
    judgment: str | None = Query(None, max_length=20),
    processingStatus: str | None = Query(None, max_length=100),
):
    return await get_doa_raw(
        page,
        limit,
        DoaRawFilters(
            acceptedDateFrom=acceptedDateFrom,
            acceptedDateTo=acceptedDateTo,
            keyword=keyword,
            serviceNumber=serviceNumber,
            salesOrder=salesOrder,
            serialNumber=serialNumber,
            customer=customer,
            product=product,
            doaType=doaType,
            judgment=judgment,
            processingStatus=processingStatus,
        ),
    )


@router.get("/dashboard", response_model=DoaDashboardResponse)
async def doa_dashboard(
    _: Annotated[dict, Depends(get_current_user)],
    dateFrom: str | None = Query(None),
    dateTo: str | None = Query(None),
    customer: str | None = Query(None),
    model: str | None = Query(None),
    timeGranularity: str = Query("month"),
    acceptedDateFrom: str | None = Query(None),
    acceptedDateTo: str | None = Query(None),
):
    return await build_doa_dashboard(
        _filters(
            dateFrom,
            dateTo,
            customer,
            model,
            timeGranularity,
            acceptedDateFrom,
            acceptedDateTo,
        ),
    )


@router.get("/repairs", response_model=DoaRepairsResponse)
async def doa_repairs(
    _: Annotated[dict, Depends(get_current_user)],
    dateFrom: str | None = Query(None),
    dateTo: str | None = Query(None),
    customer: str | None = Query(None),
    model: str | None = Query(None),
    timeGranularity: str = Query("month"),
    acceptedDateFrom: str | None = Query(None),
    acceptedDateTo: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=50000),
    replacementOnly: bool = Query(False),
):
    return await get_doa_repairs(
        _filters(
            dateFrom,
            dateTo,
            customer,
            model,
            timeGranularity,
            acceptedDateFrom,
            acceptedDateTo,
        ),
        page,
        limit,
        replacement_only=replacementOnly,
    )
