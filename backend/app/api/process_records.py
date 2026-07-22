"""关键工位影像追溯实时查询 API。"""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi import Response as FastAPIResponse

from app.schemas.common import Response
from app.schemas.process_records import ProcessRecordFilterOptions, ProcessRecordRealtimeData
from app.services.process_record_service import (
    CredentialsNotConfiguredError,
    get_filter_options,
    process_record_gateway,
)

router = APIRouter()


@router.get("/realtime", response_model=Response[ProcessRecordRealtimeData])
async def get_realtime_records(
    source: Literal["all", "system1", "system2"] = "all",
    sn: str = Query("", max_length=100),
    base: str = Query("", max_length=20),
    station: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
    pageSize: int = Query(30, ge=1, le=100),
):
    try:
        data = await process_record_gateway.query(
            source,
            page,
            pageSize,
            sn.strip(),
            base.strip(),
            station.strip(),
        )
    except CredentialsNotConfiguredError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(success=True, data=data)


@router.get("/filter-options", response_model=Response[ProcessRecordFilterOptions])
async def get_record_filter_options():
    return Response(success=True, data=get_filter_options())


@router.get("/image")
async def get_record_image(
    source: Literal["system1", "system2"],
    path: str = Query(..., min_length=1, max_length=1000),
):
    try:
        content, content_type = await process_record_gateway.fetch_image(source, path)
    except CredentialsNotConfiguredError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"图片获取失败: {exc}") from exc
    return FastAPIResponse(
        content=content,
        media_type=content_type,
        headers={"Cache-Control": "private, max-age=60"},
    )
