"""RTY calculations backed by the independent data gateway.

The gateway returns source rows only.  All grouping, SN de-duplication and
composite-model rules live here so the public RTY API remains unchanged.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from fastapi import HTTPException

from app.schemas.rty import (
    DefectDetail,
    RTYData,
    SalesOrderSummary,
    StationPassDetail,
    StationPassRate,
)
from app.services.data_gateway_client import data_gateway
from app.services.rty_queries import (
    COMPOSITE_MODEL_ITEMS,
    EXCLUDED_ORDER_STATUSES,
    EXCLUDED_ORDER_TYPES,
    MAX_BINDING_ROW_COUNT,
    MAX_DETAIL_ROW_COUNT,
    REPAIR_YEAR_END,
    REPAIR_YEAR_START,
    YEAR_END,
    YEAR_START,
    normalize_order,
    order_variants,
    validate_date,
)
from app.services.station_pass_fields import normalize_station_code


def _raw(item: dict[str, Any]) -> dict[str, Any]:
    raw = item.get("raw")
    return raw if isinstance(raw, dict) else item


def normalize_order_row(item: dict[str, Any]) -> dict[str, Any]:
    raw = _raw(item)
    nested = raw.get("data") if isinstance(raw.get("data"), dict) else raw
    data = dict(nested)
    for key, value in {
        "VBELN": item.get("salesOrder"),
        "KID": item.get("customerId"),
        "NAME1_ZU": item.get("finalUser"),
        "MAKTX": item.get("materialDescription"),
        "MAKTX_TH": item.get("productionModel"),
        "LGORT": item.get("inventoryLocation"),
        "GSTRS": item.get("plannedStartDate"),
        "WMENG": item.get("orderQuantity"),
    }.items():
        if key not in data and value is not None:
            data[key] = value
    aufnr = str(item.get("aufnr") or data.get("AUFNR") or raw.get("AUFNR") or "").strip()
    return {
        "aufnr": aufnr,
        "data": data,
        "gstrs_date": str(item.get("plannedStartDate") or data.get("GSTRS") or "")[:10],
        "source": item.get("source") or raw.get("source") or "",
    }


def normalize_fault_row(item: dict[str, Any]) -> dict[str, Any]:
    raw = _raw(item)
    return {
        **raw,
        "_id": item.get("id") or raw.get("_source_key") or raw.get("_id"),
        "PCODE": raw.get("PCODE") or item.get("serialNumber") or item.get("hostBarcode") or "",
        "AUFNR": item.get("productionOrder") or raw.get("AUFNR") or "",
        "VBELN": item.get("salesOrder") or raw.get("VBELN") or "",
        "ZDATE_WX": raw.get("ZDATE_WX") or str(item.get("repairAt") or "")[:10].replace("-", ""),
        "ZTIME": raw.get("ZTIME") or "",
        "ZNGGZ": raw.get("ZNGGZ") or item.get("ngStation") or "",
        "ZNGWD": raw.get("ZNGWD") or item.get("errorCode") or "",
        "ZWXWD": raw.get("ZWXWD")
        or item.get("faultDescription")
        or item.get("errorDescription")
        or "",
        "ZJXMC": raw.get("ZJXMC") or item.get("materialDescription") or "",
        "ZUSER": raw.get("ZUSER") or item.get("repairPerson") or "",
    }


async def _orders(filters: dict[str, Any]) -> list[dict[str, Any]]:
    gateway_filters = {
        key: value for key, value in filters.items() if key != "orderScope" and value
    }
    rows = [normalize_order_row(item) for item in await data_gateway.all_orders(**gateway_filters)]
    return [
        row for row in rows if row["aufnr"] and _eligible(row, filters.get("orderScope", "normal"))
    ]


def _eligible(row: dict[str, Any], scope: str) -> bool:
    data = row.get("data") or {}
    if str(data.get("ZSTAT") or "").strip() in EXCLUDED_ORDER_STATUSES:
        return False
    if str(data.get("AUART") or "").strip() in EXCLUDED_ORDER_TYPES:
        return False
    return (str(data.get("IF_L6") or "") == "X") == (scope == "l6")


async def _faults(filters: dict[str, Any]) -> list[dict[str, Any]]:
    rows = [normalize_fault_row(item) for item in await data_gateway.all_faults(**filters)]
    return rows


async def _bindings(filters: dict[str, Any]) -> list[dict[str, Any]]:
    return await data_gateway.all_view("ZSGV_ZPP_SERNOLIST", **filters)


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _date_range(date_from: str | None, date_to: str | None) -> tuple[str, str]:
    start = validate_date(date_from).replace("-", "") if date_from else REPAIR_YEAR_START
    end = validate_date(date_to).replace("-", "") if date_to else REPAIR_YEAR_END
    if start > end:
        raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期")
    return start, end


def _dedup_faults(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, ...]] = set()
    result = []
    for row in rows:
        key = tuple(
            str(row.get(field) or "").strip()
            for field in (
                "PCODE",
                "AUFNR",
                "VBELN",
                "ZDATE_WX",
                "ZTIME",
                "ZNGWD",
                "ZNGGZ",
                "ZWXWD",
                "ZUSER",
            )
        )
        if key not in seen:
            seen.add(key)
            result.append(row)
    return result


async def _fault_sns_by_orders(
    orders: set[str], *, model: str | None = None
) -> dict[str, set[str]]:
    if not orders:
        return {}
    rows = await _faults(
        {
            "productionOrders": ",".join(order_variants(sorted(orders))),
            "dateFrom": REPAIR_YEAR_START,
            "dateTo": REPAIR_YEAR_END,
        }
    )
    result: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        order = normalize_order(row.get("AUFNR"))
        sn = str(row.get("PCODE") or "").strip()
        if order and sn:
            result[order].add(sn)
    # Composite models count a child/BOX repair against the bound head SN.
    if model in COMPOSITE_MODEL_ITEMS and orders:
        bindings = await _bindings({"headOrder": ",".join(order_variants(sorted(orders)))})
        item_to_heads: dict[str, set[str]] = defaultdict(set)
        item_orders: set[str] = set()
        for item in bindings:
            raw = _raw(item)
            head_order = normalize_order(raw.get("AUFNR_HEAD"))
            item_order = str(raw.get("AUFNR_ITEM") or "").strip()
            head_sn = str(raw.get("ZCODE_HEAD") or "").strip()
            item_sn = str(raw.get("ZCODE_ITEM") or "").strip()
            if item_order:
                item_orders.add(item_order)
            if head_order and head_sn and item_sn:
                item_to_heads[item_sn].add(head_sn)
        if len(bindings) > MAX_BINDING_ROW_COUNT:
            raise HTTPException(
                status_code=413, detail="刀片绑定记录超过上限 100000，请缩小筛选范围"
            )
        if item_orders:
            child_rows = await _faults(
                {
                    "productionOrders": ",".join(order_variants(sorted(item_orders))),
                    "dateFrom": REPAIR_YEAR_START,
                    "dateTo": REPAIR_YEAR_END,
                }
            )
            for row in child_rows:
                child_sn = str(row.get("PCODE") or "").strip()
                if child_sn in item_to_heads:
                    for head_order in orders:
                        if any(
                            normalize_order(str(raw.get("AUFNR_HEAD") or ""))
                            == normalize_order(head_order)
                            for raw in bindings
                        ):
                            result.setdefault(normalize_order(head_order), set()).update(
                                item_to_heads[child_sn]
                            )
    return result


async def rty_list(
    filters: dict[str, Any], page: int, limit: int, targets: dict[str, float]
) -> dict[str, Any]:
    orders = await _orders(filters)
    group_by = (
        "aufnr"
        if filters.get("productionOrder")
        else "VBELN"
        if filters.get("salesOrder")
        else "KID"
        if filters.get("customer")
        else "MAKTX_TH"
        if filters.get("productModel") not in (None, "all")
        else "LGORT"
        if filters.get("base") not in (None, "all")
        else "VBELN"
    )
    groups: dict[str, dict[str, Any]] = {}
    for row in orders:
        data = row["data"]
        key = str(row["aufnr"] if group_by == "aufnr" else data.get(group_by) or "").strip()
        if not key:
            continue
        group = groups.setdefault(
            key, {"first": row, "input": 0.0, "orders": set(), "sales": set(), "customers": set()}
        )
        group["input"] += _num(data.get("WMENG"))
        group["orders"].add(row["aufnr"])
        group["sales"].add(str(data.get("VBELN") or "").strip())
        group["customers"].add(str(data.get("KID") or "").strip())
    for _key, group in groups.items():
        model = str((group["first"].get("data") or {}).get("MAKTX_TH") or "")
        fault_map = await _fault_sns_by_orders(group["orders"], model=model)
        defects = set().union(
            *(fault_map.get(normalize_order(order), set()) for order in group["orders"])
        )
        group["defects"] = defects
        group["model"] = model
    keys = sorted(groups)
    items: list[RTYData] = []
    for key in keys[(page - 1) * limit : page * limit]:
        group = groups[key]
        first = group["first"]
        data = first["data"]
        inp = round(group["input"])
        defects = len(group["defects"])
        items.append(
            RTYData(
                id=key,
                time=first["gstrs_date"],
                model="复合机型" if group["model"] in COMPOSITE_MODEL_ITEMS else "普通机型",
                productModel=group["model"],
                customer=next(iter(group["customers"]), ""),
                base=str(data.get("LGORT") or ""),
                defectCount=defects,
                inputCount=inp,
                rtyRate=round((1 - defects / inp) * 100, 2) if inp else 100.0,
                targetRate=float(targets.get(group["model"], 100)),
                salesOrder=next(iter(group["sales"]), ""),
                productionOrder=next(iter(group["orders"]), ""),
                salesOrders=sorted(x for x in group["sales"] if x),
                productionOrders=sorted(group["orders"]),
                serialNumbers=sorted(group["defects"]),
                productLine="",
                status="",
            )
        )
    return {
        "items": items,
        "total": len(keys),
        "page": page,
        "limit": limit,
        "has_more": page * limit < len(keys),
    }


async def cycle_data(
    order_scope: str, customer: str | None, targets: dict[str, float]
) -> list[RTYData]:
    orders = await _orders(
        {
            "orderScope": order_scope,
            "customer": customer or "",
            "dateFrom": YEAR_START,
            "dateTo": YEAR_END,
        }
    )
    groups: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in orders:
        data = row["data"]
        key = (row["gstrs_date"][:7], str(data.get("MAKTX_TH") or ""), str(data.get("LGORT") or ""))
        group = groups.setdefault(key, {"input": 0.0, "orders": set()})
        group["input"] += _num(data.get("WMENG"))
        group["orders"].add(row["aufnr"])
    rows = []
    for (month, model, base), group in sorted(groups.items()):
        faults = await _fault_sns_by_orders(group["orders"], model=model)
        defect_sns = set().union(*(faults.get(normalize_order(o), set()) for o in group["orders"]))
        inp = round(group["input"])
        defects = len(defect_sns)
        rows.append(
            RTYData(
                id=f"cycle:{month}:{model}:{base}",
                time=month,
                model="复合机型" if model in COMPOSITE_MODEL_ITEMS else "普通机型",
                productModel=model,
                customer=customer or "",
                base=base,
                defectCount=defects,
                inputCount=inp,
                rtyRate=round((1 - defects / inp) * 100, 2) if inp else 100.0,
                targetRate=float(targets.get(model, 100)),
                salesOrders=[],
                productionOrders=[],
                serialNumbers=defect_sns,
                salesOrder="",
                productionOrder="",
                productLine="",
                status="",
            )
        )
    return rows


async def station_rates(date_from: str | None, date_to: str | None) -> list[StationPassRate]:
    start, end = _date_range(date_from, date_to)
    records = await data_gateway.all_view(
        "Z_V_ZMES_T_001",
        dateFrom=f"{start[:4]}-{start[4:6]}-{start[6:]}",
        dateTo=f"{end[:4]}-{end[4:6]}-{end[6:]}",
    )
    by_station: dict[str, dict[str, Any]] = {}
    for item in records:
        raw = _raw(item)
        sn = str(raw.get("PCODE") or "").strip()
        station = str(
            item.get("stationCode")
            or raw.get("LINE_CODE")
            or raw.get("SPEC")
            or raw.get("OPERATION")
            or ""
        ).strip()
        station = normalize_station_code(station)
        if sn and station:
            by_station.setdefault(station, {"sns": set(), "name": station})["sns"].add(sn)
    all_sns = {sn for value in by_station.values() for sn in value["sns"]}
    repairs = (
        await _faults({"sns": ",".join(sorted(all_sns)), "dateFrom": start, "dateTo": end})
        if all_sns
        else []
    )
    defect_by_station = {
        station: {
            str(row.get("PCODE") or "")
            for row in repairs
            if normalize_station_code(str(row.get("ZNGGZ") or "")) == station
        }
        for station in by_station
    }
    return [
        StationPassRate(
            stationCode=station,
            stationName=value["name"],
            inputCount=len(value["sns"]),
            defectCount=len(defect_by_station.get(station, set())),
            passRate=round(
                (1 - len(defect_by_station.get(station, set())) / len(value["sns"])) * 100, 2
            )
            if value["sns"]
            else 100.0,
        )
        for station, value in sorted(by_station.items())
    ]


async def station_details(
    station: str, date_from: str | None, date_to: str | None, detail_type: str
) -> list[StationPassDetail]:
    start, end = _date_range(date_from, date_to)
    records = await data_gateway.all_view(
        "Z_V_ZMES_T_001",
        dateFrom=f"{start[:4]}-{start[4:6]}-{start[6:]}",
        dateTo=f"{end[:4]}-{end[4:6]}-{end[6:]}",
    )
    unique: dict[str, dict[str, Any]] = {}
    for item in records:
        raw = _raw(item)
        sn = str(raw.get("PCODE") or "").strip()
        code = normalize_station_code(
            str(item.get("stationCode") or raw.get("SPEC") or raw.get("OPERATION") or "")
        )
        if sn and code == station:
            unique.setdefault(sn, {"raw": raw, "code": code})
    if detail_type == "input":
        return [
            StationPassDetail(
                id=f"{station}:{sn}",
                sn=sn,
                stationCode=station,
                stationName=station,
                passDate=str(
                    item["raw"].get("ACTUAL_START_TIME") or item["raw"].get("GSTRS") or ""
                ),
                status="passed",
            )
            for sn, item in sorted(unique.items())
        ]
    if not unique:
        return []
    repairs = await _faults(
        {"sns": ",".join(sorted(unique)), "dateFrom": start, "dateTo": end, "station": station}
    )
    seen: set[str] = set()
    result: list[StationPassDetail] = []
    for row in repairs:
        sn = str(row.get("PCODE") or "").strip()
        if not sn or sn in seen:
            continue
        seen.add(sn)
        result.append(
            StationPassDetail(
                id=f"{station}:{sn}:defect",
                sn=sn,
                stationCode=station,
                stationName=station,
                passDate=str(unique[sn]["raw"].get("ACTUAL_START_TIME") or ""),
                status="defect",
                repairTime=f"{row.get('ZDATE_WX') or ''} {row.get('ZTIME') or ''}".strip(),
                defectCode=str(row.get("ZNGWD") or ""),
                description=str(row.get("ZWXWD") or ""),
                repairPerson=str(row.get("ZUSER") or ""),
            )
        )
    return result


def to_detail(row: dict[str, Any]) -> DefectDetail:
    return DefectDetail(
        id=str(row.get("_id") or ""),
        defectCode=str(row.get("ZNGWD") or "未知"),
        description=str(row.get("ZWXWD") or ""),
        count=1,
        sn=str(row.get("PCODE") or ""),
        sale_no=str(row.get("VBELN") or ""),
        mfg_order=str(row.get("AUFNR") or ""),
        product_family=str(row.get("ZJXMC") or ""),
        fault_2nd_appear="",
        fault_3rd_appear="",
        repairTime=f"{row.get('ZDATE_WX') or ''} {row.get('ZTIME') or ''}".strip(),
        repairPerson=str(row.get("ZUSER") or ""),
        repair_effectiveness="",
        customer=str(row.get("customer") or ""),
    )


async def details_by_orders(orders: set[str], model: str | None = None) -> list[DefectDetail]:
    rows = (
        _dedup_faults(
            await _faults(
                {
                    "productionOrders": ",".join(order_variants(sorted(orders))),
                    "dateFrom": REPAIR_YEAR_START,
                    "dateTo": REPAIR_YEAR_END,
                }
            )
        )
        if orders
        else []
    )
    return [
        to_detail(row)
        for row in sorted(
            rows,
            key=lambda row: (str(row.get("ZDATE_WX") or ""), str(row.get("ZTIME") or "")),
            reverse=True,
        )[:MAX_DETAIL_ROW_COUNT]
    ]


async def sales_order_summary(
    sales_orders: list[str], order_scope: str, targets: dict[str, float] | None = None
) -> list[SalesOrderSummary]:
    result = []
    for sales_order in sales_orders:
        rows = await _orders({"salesOrder": sales_order, "orderScope": order_scope})
        orders = {row["aufnr"] for row in rows}
        model = str((rows[0]["data"] or {}).get("MAKTX_TH") or "") if rows else None
        faults = await _fault_sns_by_orders(orders, model=model)
        inp = round(sum(_num((row["data"] or {}).get("WMENG")) for row in rows))
        defect_sns = set().union(*(faults.get(normalize_order(o), set()) for o in orders))
        result.append(
            SalesOrderSummary(
                salesOrder=sales_order,
                inputCount=inp,
                defectCount=len(defect_sns),
                rtyRate=round((1 - len(defect_sns) / inp) * 100, 2) if inp else 100.0,
            )
        )
    return result
