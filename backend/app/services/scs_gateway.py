"""SCS source adapter backed by the independent data gateway."""

from __future__ import annotations

import csv
import io
from typing import Any

from app.services.data_gateway_client import DataGatewayClient, DataGatewayError, data_gateway


def _text(value: Any) -> str:
    return str(value or "").strip()


def _first(item: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in item and item[key] not in (None, ""):
            return item[key]
    return ""


def _bool(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y", "是"}


def normalize_doa(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _text(_first(item, "id", "doa_code")),
        "doa_code": _text(item.get("doa_code")),
        "service_order": _text(item.get("service_uid", item.get("service_order"))),
        "sales_order": _text(item.get("sales_order")),
        "doa_type": _text(item.get("doa_type")),
        "judgment": _text(_first(item, "doa_judge", "judgment")),
        "status": _text(item.get("status")),
        "customer": _text(_first(item, "customer_uid", "customer")),
        "host_sn": _text(_first(item, "sugon_sn", "host_sn")),
        "part_sn": _text(_first(item, "spare_part_sn", "part_sn")),
        "product": _text(_first(item, "product_name", "product")),
        "repair_count": item.get("problem_batch_number", item.get("repair_count", 0)) or 0,
        "declare_at": _text(_first(item, "declare_time", "declare_at")),
        "accepted_at": _text(_first(item, "acceptance_time", "accepted_at")),
        "factory_date": _text(item.get("factory_date")),
        "warranty_end_date": _text(item.get("warranty_end_date")),
        "is_5000_company": _bool(item.get("is_5000_company", False)),
        "raw": item,
    }


def normalize_change(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _text(_first(item, "id", "so_code")),
        "service_order": _text(_first(item, "so_code", "service_order")),
        "customer": _text(_first(item, "customer_name", "customer")),
        "device_sn": _text(_first(item, "device_sn", "sn")),
        "change_type": _text(item.get("change_type")),
        "part_number": _text(_first(item, "part_number", "pn")),
        "part_sn": _text(_first(item, "part_sn")),
        "part_name": _text(_first(item, "part_name")),
        "operator": _text(item.get("operator")),
        "need_return": _text(item.get("need_return")),
        "is_revoked": _bool(item.get("is_revoked", False)),
        "create_at": _text(_first(item, "create_time", "create_at")),
        "is_5000_company": _bool(item.get("is_5000_company", False)),
        "raw": item,
    }


class ScsGateway:
    def __init__(self, client: DataGatewayClient = data_gateway) -> None:
        self.client = client

    async def page(
        self, view_id: str, *, page: int = 1, page_size: int = 25, **filters: str
    ) -> dict[str, Any]:
        return await self.client.view(view_id, page=page, page_size=page_size, **filters)

    async def all(
        self, view_id: str, *, max_rows: int = 250_000, **filters: str
    ) -> list[dict[str, Any]]:
        text = await self.client.request_text("GET", f"/api/views/{view_id}/stream", params=filters)
        rows = list(csv.DictReader(io.StringIO(text), delimiter="\t"))
        if len(rows) > max_rows:
            raise DataGatewayError(f"SCS {view_id} 结果超过单次处理上限 {max_rows} 条")
        normalized_rows = [
            normalize_doa(row) if view_id == "SCS_DOA" else normalize_change(row) for row in rows
        ]
        # Some gateway deployments ignore company5000 on SCS_CHANGE streams.
        # Enforce the requested scope before dashboard aggregation.
        if "company5000" in filters:
            expected = _bool(filters["company5000"])
            normalized_rows = [
                row for row in normalized_rows if row["is_5000_company"] is expected
            ]
        return normalized_rows

    async def detail(self, view_id: str, record_id: str) -> dict[str, Any]:
        payload = await self.client.view_detail(view_id, record_id)
        item = payload.get("item") if isinstance(payload, dict) else {}
        return normalize_doa(item) if view_id == "SCS_DOA" else normalize_change(item)


scs_gateway = ScsGateway()
