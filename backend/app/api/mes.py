"""
MES 数据录入 API

将指定销售订单号下的机器明细、故障信息、装配记录从 MES 拉取并写入 MongoDB。
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.auth import get_current_user
from app.schemas.common import Response
from app.services.mes_import import (
    AssemblyImportRequest,
    AssemblyImportResult,
    SaleOrderImportRequest,
    SaleOrderImportResult,
    SalesOrderBomImportResult,
)

router = APIRouter()


@router.post("/import-order", response_model=Response[SaleOrderImportResult])
async def import_order(
    req: SaleOrderImportRequest,
    _user=Depends(get_current_user),  # noqa: B008
) -> Response[SaleOrderImportResult]:
    """按销售订单号录入机器明细与故障信息到 MongoDB（machine_info / fault_info）"""
    from app.services import mes_import

    result = await mes_import.import_sale_order(
        sale_no=req.sale_no,
        base=req.base,
        base_url=req.base_url,
    )
    return Response(success=True, data=result)


@router.post("/import-assembly", response_model=Response[AssemblyImportResult])
async def import_assembly(
    req: AssemblyImportRequest,
    _user=Depends(get_current_user),  # noqa: B008
) -> Response[AssemblyImportResult]:
    """按销售订单号导入装配记录到 MongoDB（assembly_records 集合）

    流程：
      1. 通过销售订单号查出所有生产工单（MfgOrder）
      2. 对每个工单调用 MES 装配记录接口
      3. 写入 assembly_records 集合（按 mfg_order + chassis_no 去重）
    """
    from app.services import mes_import

    result = await mes_import.import_assembly_records(
        sale_no=req.sale_no,
        base=req.base,
        base_url=req.base_url,
    )
    return Response(success=True, data=result)


class SalesOrderBomRequest(BaseModel):
    """销售订单 BOM 导入请求参数"""
    sale_no: str = Field(..., description="销售订单号，如 XNC2552070")
    base_url: str | None = Field(
        default=None,
        description="MES 服务地址，默认取项目内置地址 MES_BASE_URL",
    )


@router.post("/import-sales-order-bom", response_model=Response[SalesOrderBomImportResult])
async def import_sales_order_bom(
    req: SalesOrderBomRequest,
    _user=Depends(get_current_user),  # noqa: B008
) -> Response[SalesOrderBomImportResult]:
    """按销售订单号导入 BOM 物料数据到 MongoDB（sales_order_bom 集合）

    流程：
      1. 通过销售订单号查出所有生产工单（MfgOrder）
      2. 对每个工单调 getOrderSum + getOrderBOM
      3. 合并后 upsert 到 sales_order_bom 集合
    """
    from app.services import mes_import

    result = await mes_import.import_sales_order_bom(
        sale_no=req.sale_no,
        base_url=req.base_url,
    )
    return Response(success=True, data=result)
