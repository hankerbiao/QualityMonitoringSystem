"""MFR (整机现网月化故障率) API routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth import get_current_user
from app.auth_permissions import dashboard_dependency
from app.schemas.mfr import MFRDashboardResponse, MFRFilters
from app.services.mfr_service import build_mfr_dashboard

router = APIRouter(dependencies=[Depends(dashboard_dependency("mfr"))])


@router.get("/dashboard", response_model=MFRDashboardResponse)
async def mfr_dashboard(
    _: Annotated[dict, Depends(get_current_user)],
    dateFrom: str = Query(..., description="统计开始日期 YYYY-MM-DD"),
    dateTo: str = Query(..., description="统计结束日期 YYYY-MM-DD"),
    model: str = Query("", description="机型"),
):
    try:
        return await build_mfr_dashboard(MFRFilters(dateFrom=dateFrom, dateTo=dateTo, model=model))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
