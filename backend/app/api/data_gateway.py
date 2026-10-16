"""Authenticated diagnostics for the optional independent data gateway."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth import get_current_user, require_admin
from app.services.data_gateway_client import DataGatewayError, data_gateway


async def require_unrestricted_admin(
    current_user: Annotated[dict, Depends(require_admin)],
) -> dict:
    if current_user.get("basePermissions") is not None:
        raise HTTPException(status_code=403, detail="当前基地权限不允许访问全量数据源接口")
    return current_user


router = APIRouter(dependencies=[Depends(require_unrestricted_admin)])


@router.get("/status")
async def gateway_status(_: Annotated[dict, Depends(get_current_user)]):
    """Report configuration and reachability without exposing gateway internals."""
    if not data_gateway.enabled:
        return {"configured": False, "reachable": False, "message": "DATA_GATEWAY_URL 未配置"}
    try:
        payload = await data_gateway.health()
    except DataGatewayError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"configured": True, "reachable": True, "health": payload}


async def _request(call):
    try:
        return await call()
    except DataGatewayError as exc:
        status = 502 if exc.status_code is None or exc.status_code >= 500 else exc.status_code
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@router.get("/faults")
async def gateway_faults(
    _: Annotated[dict, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    keyword: str = "",
    hostBarcode: str = "",
    defectResponsibility: str = "",
    ngStation: str = "",
    salesOrder: str = "",
    productionOrder: str = "",
):
    return await _request(
        lambda: data_gateway.faults(
            page=page,
            page_size=pageSize,
            keyword=keyword,
            hostBarcode=hostBarcode,
            defectResponsibility=defectResponsibility,
            ngStation=ngStation,
            salesOrder=salesOrder,
            productionOrder=productionOrder,
        )
    )


@router.get("/faults/detail")
async def gateway_fault_detail(
    _: Annotated[dict, Depends(get_current_user)], id: str = Query(..., min_length=1)
):
    return await _request(lambda: data_gateway.fault_detail(id))


@router.get("/faults/stats")
async def gateway_fault_stats(
    _: Annotated[dict, Depends(get_current_user)],
    keyword: str = "",
    hostBarcode: str = "",
    defectResponsibility: str = "",
    ngStation: str = "",
    salesOrder: str = "",
    productionOrder: str = "",
):
    return await _request(
        lambda: data_gateway.request_json(
            "GET",
            "/api/faults/stats",
            params={
                key: value
                for key, value in {
                    "keyword": keyword,
                    "hostBarcode": hostBarcode,
                    "defectResponsibility": defectResponsibility,
                    "ngStation": ngStation,
                    "salesOrder": salesOrder,
                    "productionOrder": productionOrder,
                }.items()
                if value
            },
        )
    )


@router.get("/orders")
async def gateway_orders(
    _: Annotated[dict, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    keyword: str = "",
    source: str = "",
    gstrsFrom: str = "",
    gstrsTo: str = "",
):
    return await _request(
        lambda: data_gateway.orders(
            page=page,
            page_size=pageSize,
            keyword=keyword,
            source=source,
            gstrsFrom=gstrsFrom,
            gstrsTo=gstrsTo,
        )
    )


@router.get("/orders/detail")
async def gateway_order_detail(
    _: Annotated[dict, Depends(get_current_user)], id: str = Query(..., min_length=1)
):
    return await _request(lambda: data_gateway.order_detail(id))


@router.get("/orders/stats")
async def gateway_order_stats(
    _: Annotated[dict, Depends(get_current_user)],
    keyword: str = "",
    source: str = "",
    gstrsFrom: str = "",
    gstrsTo: str = "",
):
    return await _request(
        lambda: data_gateway.order_stats(
            keyword=keyword, source=source, gstrsFrom=gstrsFrom, gstrsTo=gstrsTo
        )
    )


@router.get("/views/{view_id}")
async def gateway_view(
    view_id: str,
    _: Annotated[dict, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    keyword: str = "",
    dateFrom: str = "",
    dateTo: str = "",
):
    return await _request(
        lambda: data_gateway.view(
            view_id,
            page=page,
            page_size=pageSize,
            keyword=keyword,
            date_from=dateFrom,
            date_to=dateTo,
        )
    )


@router.get("/views/{view_id}/stats")
async def gateway_view_stats(
    view_id: str,
    _: Annotated[dict, Depends(get_current_user)],
    keyword: str = "",
    dateFrom: str = "",
    dateTo: str = "",
):
    return await _request(
        lambda: data_gateway.view_stats(
            view_id, keyword=keyword, date_from=dateFrom, date_to=dateTo
        )
    )


@router.get("/views/{view_id}/detail")
async def gateway_view_detail(
    view_id: str,
    _: Annotated[dict, Depends(get_current_user)],
    id: str = Query(..., min_length=1),
):
    return await _request(lambda: data_gateway.view_detail(view_id, id))
