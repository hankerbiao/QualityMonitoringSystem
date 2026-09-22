"""通过整机 SN 查询销售订单和生产订单。"""

from __future__ import annotations

from collections import OrderedDict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.api.auth import get_current_user
from app.auth_permissions import dashboard_dependency
from app.schemas.common import Response
from app.schemas.sn_info import (
    SnInfoItem,
    SnInfoQueryResponse,
    SnInfoRequest,
    SnInfoSourceResult,
)
from app.services.sap_sn_info_service import SapSnInfoService

router = APIRouter(dependencies=[Depends(dashboard_dependency("rty"))])


def _normalize_item(record: dict, source: str) -> SnInfoItem:
    """Map SAP uppercase fields and normalize the zero-date sentinel."""
    data = {
        key: str(record.get(key) or "").strip()
        for key in ("PCODE", "AUFNR", "MATNR", "MAKTX", "CDATE_S", "CDATE_E", "CDATE_I", "CDATE_O")
    }
    for key in ("CDATE_S", "CDATE_E", "CDATE_I", "CDATE_O"):
        if data[key] == "0000-00-00":
            data[key] = ""
    item = SnInfoItem(**data)
    item.sources = [source]
    return item


def _merge_records(results: dict) -> list[SnInfoItem]:
    merged: OrderedDict[str, SnInfoItem] = OrderedDict()
    for source, result in results.items():
        if not result.success:
            continue
        for record in result.records:
            item = _normalize_item(record, source)
            key = item.pcode or item.aufnr or f"{source}:{len(merged)}"
            if key not in merged:
                merged[key] = item
                continue
            existing = merged[key]
            for field in ("aufnr", "matnr", "maktx", "cdate_s", "cdate_e", "cdate_i", "cdate_o"):
                if not getattr(existing, field) and getattr(item, field):
                    setattr(existing, field, getattr(item, field))
            existing.sources = sorted(set(existing.sources + item.sources))
    return list(merged.values())


@router.post("/query", response_model=Response[SnInfoQueryResponse])
async def query_sn_info(
    body: SnInfoRequest,
    _: Annotated[dict, Depends(get_current_user)],
):
    """通过 SN_LIST 查询 SAP 中的销售订单、生产订单和关键日期。"""
    results = await SapSnInfoService().fetch_all(body.sn_list)
    successful = [result for result in results.values() if result.success]
    if not successful:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Both SAP SN sources failed",
                "sources": {
                    source: {"success": result.success, "error": result.error}
                    for source, result in results.items()
                },
            },
        )

    items = _merge_records(results)
    response = SnInfoQueryResponse(
        requested_count=len(body.sn_list),
        matched_count=len(items),
        items=items,
        sources={
            source: SnInfoSourceResult(
                success=result.success,
                error=result.error,
                fetched_count=len(result.records),
            )
            for source, result in results.items()
        },
    )
    return Response(success=True, data=response, message="SN 信息查询成功")
