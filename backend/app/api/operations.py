"""运营监控 API。"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field

from app.api.auth import get_current_user, require_admin
from app.db.mongodb import get_database
from app.services.operations_service import build_operations_dashboard, record_page_view

router = APIRouter()


class UsageEventRequest(BaseModel):
    event_type: Literal["page_view"] = "page_view"
    path: str = Field(min_length=1, max_length=160)


@router.post("/events", status_code=status.HTTP_204_NO_CONTENT)
async def create_usage_event(
    payload: UsageEventRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
) -> Response:
    await record_page_view(get_database(), current_user["itcode"], payload.path)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/dashboard")
async def get_operations_dashboard(
    _: Annotated[dict, Depends(require_admin)],
    days: Annotated[int, Query(ge=7, le=90)] = 30,
    activity_page: Annotated[int, Query(alias="activityPage", ge=1)] = 1,
    activity_page_size: Annotated[int, Query(alias="activityPageSize", ge=1, le=100)] = 20,
):
    return await build_operations_dashboard(get_database(), days, activity_page, activity_page_size)
