"""批次异常看板 API：实时代理上游异常查询系统。"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth_permissions import dashboard_dependency
from app.base_access import base_allowed, current_base_permissions, require_base_access
from app.db.mongodb import get_database
from app.schemas.common import Response
from app.services.batch_exception import (
    FACTORY_OPTIONS,
    BatchExceptionUpstreamError,
    fetch_options,
    query_batch_exceptions,
)
from app.services.settings_service import SettingsService


async def require_batch_exception_access(
    user: Annotated[dict, Depends(dashboard_dependency("batch-exception"))],
):
    if user.get("role") != "admin":
        statuses = await SettingsService(get_database()).get_dashboard_statuses()
        if statuses["batch-exception"] == "admin-only":
            raise HTTPException(status_code=403, detail="批次异常看板仅管理员可见")
    return user


router = APIRouter(dependencies=[Depends(require_batch_exception_access)])

_FACTORY_CODES = {code for code, _ in FACTORY_OPTIONS}


def _validate_factory(factory: str) -> str:
    """校验上游工厂编码，并按基地权限收敛可查询范围。"""
    value = factory.strip()
    if not value:
        if current_base_permissions() is not None:
            raise HTTPException(status_code=403, detail="当前账号仅能查看指定基地，请先选择基地")
        return ""
    if value not in _FACTORY_CODES:
        raise HTTPException(status_code=400, detail="无效的基地编码")
    # 青岛在权限体系里是 QD，上游工厂编码是 Q000。
    require_base_access("QD" if value == "Q000" else value)
    return value


def _factory_options_for_scope() -> list[dict[str, str]]:
    scope = current_base_permissions()
    options = [
        {"value": code, "label": label}
        for code, label in FACTORY_OPTIONS
        if scope is None or base_allowed("QD" if code == "Q000" else code)
    ]
    if scope is None:
        options.insert(0, {"value": "", "label": "全部基地"})
    return options


@router.get("/query")
async def query(
    create_time_start: Annotated[date, Query(alias="createTimeStart")],
    create_time_end: Annotated[date, Query(alias="createTimeEnd")],
    factory: str = Query("", max_length=10),
    models: str = Query("", max_length=100),
    order_id: str = Query("", max_length=50, alias="orderID"),
    err_type_first: str = Query("", max_length=100, alias="errTypeFirst"),
    err_type_second: str = Query("", max_length=100, alias="errTypeSecond"),
    sales_receipts: str = Query("", max_length=100, alias="salesReceipts"),
    state: str = Query("", max_length=20),
    caused_by: str = Query("", max_length=100, alias="causedBy"),
):
    if create_time_start > create_time_end:
        raise HTTPException(status_code=400, detail="录入开始日期不能晚于结束日期")
    factory = _validate_factory(factory)
    try:
        data = await query_batch_exceptions(
            factory=factory,
            create_time_start=create_time_start,
            create_time_end=create_time_end,
            models=models.strip(),
            order_id=order_id.strip(),
            err_type_first=err_type_first.strip(),
            err_type_second=err_type_second.strip(),
            sales_receipts=sales_receipts.strip(),
            state=state.strip(),
            caused_by=caused_by.strip(),
        )
    except BatchExceptionUpstreamError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(success=True, data=data)


@router.get("/options")
async def options(factory: str = Query("", max_length=10)):
    factory = _validate_factory(factory)
    try:
        data = await fetch_options(factory)
    except BatchExceptionUpstreamError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(success=True, data={**data, "factories": _factory_options_for_scope()})
