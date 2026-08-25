"""DOA 领域服务：销售订单出货、SCS 报修和原始明细查询。"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime
from typing import Any

from app.models.documents import Collections
from app.repositories.sales_order_repository import normalize_gstrs_date
from app.schemas.doa import (
    DoaDashboardResponse,
    DoaDimensionItem,
    DoaFilters,
    DoaRepairItem,
    DoaRepairsResponse,
    DoaSummary,
    DoaTrendItem,
    ReplacementDashboardResponse,
    ReplacementDimensionItem,
    ReplacementSummary,
    ReplacementTrendItem,
)


def _date(value: Any) -> str | None:
    """兼容展示用原始日期，查询一律使用规范化字段。"""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    for candidate in (text[:10], text.split(" ", 1)[0]):
        try:
            return datetime.strptime(candidate.replace("/", "-"), "%Y-%m-%d").strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _number(value: Any) -> float:
    if value is None or isinstance(value, bool):
        return 0.0
    if isinstance(value, int | float):
        return float(value)
    match = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
    return float(match.group(0)) if match else 0.0


def _rate(repairs: float, shipped: float) -> float | None:
    return round(repairs / shipped * 100, 2) if shipped else None


def _normalize_filter_date(value: str | None) -> str | None:
    return normalize_gstrs_date(value) if value else None


def _order_query(filters: DoaFilters | None = None) -> dict[str, Any]:
    """构造只命中规范化销售订单字段的查询。"""
    query: dict[str, Any] = {}
    if filters is None:
        return query
    date_query: dict[str, str] = {}
    if date_from := _normalize_filter_date(filters.dateFrom):
        date_query["$gte"] = date_from
    if date_to := _normalize_filter_date(filters.dateTo):
        date_query["$lte"] = date_to
    if date_query:
        query["gstrs_date"] = date_query
    if filters.customer:
        query["data.NAME1_ZU"] = filters.customer
    if filters.model:
        query["data.MAKTX_TH"] = filters.model
    return query


def _scs_query(filters: DoaFilters | None = None) -> dict[str, Any]:
    query: dict[str, Any] = {
        "$or": [{"is_5000": True}, {"scs_enrichment.is_5000": True}],
        "data.判定结果": "是",
    }
    if filters is None:
        return query
    date_query: dict[str, str] = {}
    if date_from := _normalize_filter_date(filters.dateFrom):
        date_query["$gte"] = date_from
    if date_to := _normalize_filter_date(filters.dateTo):
        date_query["$lte"] = date_to
    if date_query:
        query["scs_enrichment.accepted_date"] = date_query
    return query


def _period_expression(field: str, granularity: str) -> Any:
    if granularity == "year":
        return {"$substrBytes": [field, 0, 4]}
    if granularity == "day":
        return field
    return {"$substrBytes": [field, 0, 7]}


def _number_expression(field: str) -> dict[str, Any]:
    return {"$convert": {"input": field, "to": "double", "onError": 0, "onNull": 0}}


_REGEX_META = r"\^$|.?*+()[]{}"


def _regex_literal(pattern: Any) -> Any:
    """逐字符转义聚合表达式中的正则元字符，使前缀匹配按字面进行。"""
    expr: Any = pattern
    for char in _REGEX_META:
        find: Any = {"$literal": char} if char == "$" else char
        expr = {
            "$replaceAll": {
                "input": expr,
                "find": find,
                "replacement": f"\\{char}",
            }
        }
    return expr


def _order_stats_pipeline(filters: DoaFilters) -> list[dict[str, Any]]:
    return [
        {"$match": _order_query(filters)},
        {
            "$project": {
                "customer": "$data.NAME1_ZU",
                "model": {"$ifNull": ["$data.MAKTX_TH", "$data.CPXH"]},
                "shipped_date": "$gstrs_date",
                "shipped_count": _number_expression("$data.WMENG"),
            }
        },
        {
            "$facet": {
                "total": [{"$count": "count"}],
                "shipped": [{"$group": {"_id": None, "sum": {"$sum": "$shipped_count"}}}],
                "by_customer": [
                    {"$match": {"customer": {"$nin": [None, ""]}}},
                    {"$group": {"_id": "$customer", "shipped": {"$sum": "$shipped_count"}}},
                ],
                "by_model": [
                    {"$match": {"model": {"$nin": [None, ""]}}},
                    {"$group": {"_id": "$model", "shipped": {"$sum": "$shipped_count"}}},
                ],
                "trend": [
                    {"$match": {"shipped_date": {"$nin": [None, ""]}}},
                    {
                        "$group": {
                            "_id": _period_expression("$shipped_date", filters.timeGranularity),
                            "shipped": {"$sum": "$shipped_count"},
                        }
                    },
                ],
            }
        },
    ]


def _repair_pipeline(
    filters: DoaFilters,
    *,
    page: int | None = None,
    limit: int | None = None,
    include_data: bool = False,
    replacement_only: bool = False,
) -> list[dict[str, Any]]:
    order_query = _order_query(filters)
    order_pipeline: list[dict[str, Any]] = [
        {"$match": {"$expr": {"$eq": ["$data.VBELN", "$$sales_order"]}}},
    ]
    if order_query:
        order_pipeline.append({"$match": order_query})
    order_pipeline.append(
        {
            "$project": {
                "customer": "$data.NAME1_ZU",
                "model": {"$ifNull": ["$data.MAKTX_TH", "$data.CPXH"]},
                "shipped_date": "$gstrs_date",
                "shipped_count": _number_expression("$data.WMENG"),
            }
        }
    )
    fields: dict[str, Any] = {
        "id": {"$toString": "$_id"},
        "sales_order": "$scs_enrichment.sales_order",
        "material_serial": {"$ifNull": ["$data.曙光S/N", "$data.备件S/N"]},
        "accepted_at": "$scs_enrichment.accepted_date",
        "customer": "$orders.customer",
        "model": "$orders.model",
        "shipped_date": "$orders.shipped_date",
        "shipped_count": "$orders.shipped_count",
        "repair_count": _number_expression("$data.问题批次数量"),
        "has_change": {"$gt": [{"$size": "$changes"}, 0]},
    }
    if include_data:
        fields["data"] = "$data"
    facet: dict[str, Any] = {
        "matched": [{"$count": "count"}],
        "repair_total": [{"$group": {"_id": None, "sum": {"$sum": "$repair_count"}}}],
        "replacement_total": [
            {"$match": {"has_change": True}},
            {"$count": "count"},
        ],
        "by_customer": [
            {
                "$group": {
                    "_id": "$customer",
                    "repair": {"$sum": "$repair_count"},
                    "replacement": {
                        "$sum": {"$cond": [{"$eq": ["$has_change", True]}, 1, 0]}
                    },
                }
            }
        ],
        "by_model": [
            {
                "$group": {
                    "_id": "$model",
                    "repair": {"$sum": "$repair_count"},
                    "replacement": {
                        "$sum": {"$cond": [{"$eq": ["$has_change", True]}, 1, 0]}
                    },
                }
            }
        ],
        "trend": [
            {
                "$group": {
                    "_id": _period_expression("$accepted_at", filters.timeGranularity),
                    "repair": {"$sum": "$repair_count"},
                    "replacement": {
                        "$sum": {"$cond": [{"$eq": ["$has_change", True]}, 1, 0]}
                    },
                }
            }
        ],
        "servers": [
            {"$match": {"material_serial": {"$nin": [None, ""]}}},
            {
                "$group": {
                    "_id": {
                        "period": _period_expression("$accepted_at", filters.timeGranularity),
                        "serial": "$material_serial",
                    }
                }
            },
            {"$group": {"_id": "$_id.period", "count": {"$sum": 1}}},
        ],
    }
    if page is not None and limit is not None:
        facet["items"] = [
            {"$sort": {"accepted_at": -1, "id": -1}},
            {"$skip": (page - 1) * limit},
            {"$limit": limit},
        ]
    pipeline: list[dict[str, Any]] = [
        {"$match": _scs_query(filters)},
        {
            "$lookup": {
                "from": Collections.SALES_ORDERS_SAP,
                "let": {"sales_order": "$scs_enrichment.sales_order"},
                "pipeline": order_pipeline,
                "as": "orders",
            }
        },
        {"$unwind": "$orders"},
        {
            "$match": {
                "$expr": {
                    "$or": [
                        {
                            "$regexMatch": {
                                "input": {"$ifNull": ["$data.产品/备件名称", ""]},
                                "regex": {"$concat": ["^", _regex_literal("$orders.model")]},
                                "options": "i",
                            }
                        },
                        {
                            "$regexMatch": {
                                "input": "$orders.model",
                                "regex": {
                                    "$concat": [
                                        "^",
                                        _regex_literal(
                                            {"$ifNull": ["$data.产品/备件名称", ""]}
                                        ),
                                    ]
                                },
                                "options": "i",
                            }
                        },
                    ]
                }
            }
        },
        {
            "$lookup": {
                "from": Collections.SCS_CHANGE_RESULTS,
                "let": {"service_no": "$data.服务单号"},
                "pipeline": [
                    {
                        "$match": {
                            "$expr": {
                                "$and": [
                                    {"$ne": ["$data.服务单号", None]},
                                    {"$ne": ["$data.服务单号", ""]},
                                    {"$eq": ["$data.服务单号", "$$service_no"]},
                                ]
                            }
                        }
                    },
                    {"$limit": 1},
                ],
                "as": "changes",
            }
        },
        {"$project": fields},
    ]
    if replacement_only:
        pipeline.append({"$match": {"has_change": True}})
    pipeline.append({"$facet": facet})
    return pipeline


async def _aggregate_one(collection: Any, pipeline: list[dict[str, Any]]) -> dict[str, Any]:
    rows = await collection.aggregate(pipeline).to_list(length=1)
    return rows[0] if rows else {}


async def _latest_data_time(db: Any) -> datetime | None:
    """返回 DOA 集合最近一次 enrichment 完成时间。"""
    rows = await (
        db[Collections.SCS_DOA_RESULTS]
        .find(
            {"scs_enrichment.enriched_at": {"$exists": True}},
            {
                "_id": 0,
                "scs_enrichment.enriched_at": 1,
            },
        )
        .sort("scs_enrichment.enriched_at", -1)
        .limit(1)
        .to_list(length=1)
    )
    if not rows:
        return None
    value = (rows[0].get("scs_enrichment") or {}).get("enriched_at")
    return value if isinstance(value, datetime) else None


def _facet_total(facet: dict[str, Any], key: str, field: str) -> float:
    rows = facet.get(key) or []
    return float(rows[0].get(field, 0)) if rows else 0.0


def _dimension_rows(
    rows: list[dict[str, Any]], *fields: str
) -> dict[str, dict[str, float]]:
    result: dict[str, dict[str, float]] = {}
    for row in rows:
        key = str(row.get("_id"))
        if not key:
            continue
        result.setdefault(key, {}).update({f: float(row.get(f, 0)) for f in fields})
    return result


async def build_doa_dashboard(db: Any, filters: DoaFilters) -> DoaDashboardResponse:
    """在 MongoDB 中完成订单/SCS 聚合，应用层只组装已聚合的结果。"""
    orders_facet, repairs_facet, eligible, latest_data_at = await asyncio.gather(
        _aggregate_one(db[Collections.SALES_ORDERS_SAP], _order_stats_pipeline(filters)),
        _aggregate_one(db[Collections.SCS_DOA_RESULTS], _repair_pipeline(filters)),
        db[Collections.SCS_DOA_RESULTS].count_documents(_scs_query(filters)),
        _latest_data_time(db),
    )
    shipped = _facet_total(orders_facet, "shipped", "sum")
    repair_count = _facet_total(repairs_facet, "repair_total", "sum")
    matched = int(_facet_total(repairs_facet, "matched", "count"))
    excluded = max(0, eligible - matched)

    def dimensions(order_key: str, repair_key: str) -> list[DoaDimensionItem]:
        shipped_rows = _dimension_rows(orders_facet.get(order_key, []), "shipped")
        repair_rows = _dimension_rows(repairs_facet.get(repair_key, []), "repair")
        keys = sorted(set(shipped_rows) | set(repair_rows))
        return [
            DoaDimensionItem(
                key=key,
                shippedCount=shipped_rows.get(key, {}).get("shipped", 0),
                repairCount=repair_rows.get(key, {}).get("repair", 0),
                repairRate=_rate(
                    repair_rows.get(key, {}).get("repair", 0),
                    shipped_rows.get(key, {}).get("shipped", 0),
                ),
            )
            for key in keys
        ]

    trend_ship = {
        str(row["_id"]): float(row.get("shipped", 0)) for row in orders_facet.get("trend", [])
    }
    trend_repair = {
        str(row["_id"]): float(row.get("repair", 0)) for row in repairs_facet.get("trend", [])
    }
    trend_servers = {
        str(row["_id"]): int(row.get("count", 0)) for row in repairs_facet.get("servers", [])
    }
    periods = sorted(set(trend_ship) | set(trend_repair))
    trend = [
        DoaTrendItem(
            period=period,
            shippedCount=trend_ship.get(period, 0),
            repairCount=trend_repair.get(period, 0),
            repairServerCount=trend_servers.get(period, 0),
            repairRate=_rate(trend_repair.get(period, 0), trend_ship.get(period, 0)),
        )
        for period in periods
    ]
    return DoaDashboardResponse(
        filters=filters,
        summary=DoaSummary(
            shippedCount=shipped,
            repairCount=repair_count,
            repairRate=_rate(repair_count, shipped),
            matchedRepairRecords=matched,
            excludedRepairRecords=excluded,
            latestDataAt=latest_data_at,
        ),
        trend=trend,
        byCustomer=dimensions("by_customer", "by_customer"),
        byModel=dimensions("by_model", "by_model"),
    )


async def build_replacement_dashboard(
    db: Any, filters: DoaFilters
) -> ReplacementDashboardResponse:
    """独立换件率看板：DOA 换件数 = 报修数中按服务单号匹配换上换下的记录数。"""
    orders_facet, repairs_facet, latest_data_at = await asyncio.gather(
        _aggregate_one(db[Collections.SALES_ORDERS_SAP], _order_stats_pipeline(filters)),
        _aggregate_one(db[Collections.SCS_DOA_RESULTS], _repair_pipeline(filters)),
        _latest_data_time(db),
    )
    shipped = _facet_total(orders_facet, "shipped", "sum")
    replacement_count = int(_facet_total(repairs_facet, "replacement_total", "count"))
    matched = int(_facet_total(repairs_facet, "matched", "count"))

    def dimensions(order_key: str, repair_key: str) -> list[ReplacementDimensionItem]:
        shipped_rows = _dimension_rows(orders_facet.get(order_key, []), "shipped")
        repair_rows = _dimension_rows(repairs_facet.get(repair_key, []), "replacement")
        keys = sorted(set(shipped_rows) | set(repair_rows))
        return [
            ReplacementDimensionItem(
                key=key,
                shippedCount=shipped_rows.get(key, {}).get("shipped", 0),
                replacementCount=repair_rows.get(key, {}).get("replacement", 0),
                replacementRate=_rate(
                    repair_rows.get(key, {}).get("replacement", 0),
                    shipped_rows.get(key, {}).get("shipped", 0),
                ),
            )
            for key in keys
        ]

    trend_ship = {
        str(row["_id"]): float(row.get("shipped", 0)) for row in orders_facet.get("trend", [])
    }
    trend_replacement = {
        str(row["_id"]): float(row.get("replacement", 0))
        for row in repairs_facet.get("trend", [])
    }
    periods = sorted(set(trend_ship) | set(trend_replacement))
    trend = [
        ReplacementTrendItem(
            period=period,
            shippedCount=trend_ship.get(period, 0),
            replacementCount=trend_replacement.get(period, 0),
            replacementRate=_rate(
                trend_replacement.get(period, 0), trend_ship.get(period, 0)
            ),
        )
        for period in periods
    ]
    return ReplacementDashboardResponse(
        filters=filters,
        summary=ReplacementSummary(
            shippedCount=shipped,
            replacementCount=replacement_count,
            replacementRate=_rate(replacement_count, shipped),
            matchedRepairRecords=matched,
            latestDataAt=latest_data_at,
        ),
        trend=trend,
        byCustomer=dimensions("by_customer", "by_customer"),
        byModel=dimensions("by_model", "by_model"),
    )


async def get_doa_repairs(
    db: Any, filters: DoaFilters, page: int, limit: int, replacement_only: bool = False
) -> DoaRepairsResponse:
    facet = await _aggregate_one(
        db[Collections.SCS_DOA_RESULTS],
        _repair_pipeline(
            filters,
            page=page,
            limit=limit,
            include_data=True,
            replacement_only=replacement_only,
        ),
    )
    items = [
        DoaRepairItem(
            id=str(item.get("id", "")),
            salesOrder=str(item.get("sales_order") or ""),
            materialSerial=str(item.get("material_serial") or ""),
            acceptedAt=str(item.get("accepted_at") or ""),
            customer=str(item.get("customer") or ""),
            model=str(item.get("model") or ""),
            shippedDate=str(item.get("shipped_date") or ""),
            shippedCount=float(item.get("shipped_count") or 0),
            repairCount=float(item.get("repair_count") or 0),
            data=item.get("data") or {},
        )
        for item in facet.get("items", [])
    ]
    total = int(_facet_total(facet, "matched", "count"))
    return DoaRepairsResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
        has_more=page * limit < total,
    )


async def get_doa_options(db: Any) -> dict[str, list[str]]:
    """通过 MongoDB 分组取得筛选项，不加载全量订单。"""
    facet = await _aggregate_one(
        db[Collections.SALES_ORDERS_SAP],
        [
            {
                "$facet": {
                    "customers": [
                        {"$match": {"data.NAME1_ZU": {"$nin": [None, ""]}}},
                        {"$group": {"_id": "$data.NAME1_ZU"}},
                        {"$sort": {"_id": 1}},
                    ],
                    "models": [
                        {"$match": {"data.MAKTX_TH": {"$nin": [None, ""]}}},
                        {"$group": {"_id": "$data.MAKTX_TH"}},
                        {"$sort": {"_id": 1}},
                    ],
                }
            }
        ],
    )
    return {
        "customers": [str(row["_id"]) for row in facet.get("customers", []) if row.get("_id")],
        "models": [str(row["_id"]) for row in facet.get("models", []) if row.get("_id")],
    }


DOA_RAW_QUERY = {"$or": [{"is_5000": True}, {"scs_enrichment.is_5000": True}]}


def _raw_status_query(status: str) -> dict[str, Any]:
    query: dict[str, Any] = {**DOA_RAW_QUERY}
    if status == "success":
        query["$or"] = [
            {"is_5000": True, "scs_enrichment.status": "success"},
            {"scs_enrichment.is_5000": True, "scs_enrichment.status": "success"},
            {"is_5000": True, "scs_enrichment.sales_order": {"$nin": [None, ""]}},
            {"scs_enrichment.is_5000": True, "scs_enrichment.sales_order": {"$nin": [None, ""]}},
        ]
    elif status in {"failed", "skipped"}:
        query["scs_enrichment.status"] = status
    return query


async def get_doa_raw(db: Any, page: int = 1, limit: int = 50) -> dict[str, Any]:
    """原始 SCS 明细接口；统计与分页均由 MongoDB 完成。"""
    collection = db[Collections.SCS_DOA_RESULTS]
    total = await collection.count_documents(DOA_RAW_QUERY)
    page_documents = (
        await collection.find(DOA_RAW_QUERY)
        .sort([("scs_enrichment.accepted_date", -1), ("_id", -1)])
        .skip((page - 1) * limit)
        .limit(limit)
        .to_list(length=limit)
    )
    stats = await _aggregate_one(
        collection,
        [
            {"$match": DOA_RAW_QUERY},
            {
                "$facet": {
                    "by_type": [{"$group": {"_id": "$data.DOA类型", "count": {"$sum": 1}}}],
                    "by_processing": [{"$group": {"_id": "$data.处理状态", "count": {"$sum": 1}}}],
                    "trend": [
                        {"$match": {"scs_enrichment.accepted_date": {"$nin": [None, ""]}}},
                        {
                            "$group": {
                                "_id": "$scs_enrichment.accepted_date",
                                "count": {"$sum": 1},
                            }
                        },
                        {"$sort": {"_id": 1}},
                    ],
                }
            },
        ],
    )
    success = await collection.count_documents(_raw_status_query("success"))
    failed = await collection.count_documents(_raw_status_query("failed"))
    skipped = await collection.count_documents(_raw_status_query("skipped"))
    pending = max(0, total - success - failed - skipped)
    yes = await collection.count_documents({**DOA_RAW_QUERY, "data.判定结果": "是"})
    no = await collection.count_documents({**DOA_RAW_QUERY, "data.判定结果": "否"})
    latest = (
        await collection.find(DOA_RAW_QUERY)
        .sort([("scs_enrichment.accepted_date", -1), ("_id", -1)])
        .limit(1)
        .to_list(length=1)
    )
    latest_raw = (latest[0].get("data") or {}).get("受理时间") if latest else None

    def ranked(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {"key": str(row.get("_id") or "未填写"), "count": row.get("count", 0)}
            for row in sorted(
                rows, key=lambda row: (-row.get("count", 0), str(row.get("_id") or ""))
            )
        ]

    items = []
    for document in page_documents:
        enrichment = document.get("scs_enrichment") or {}
        status = enrichment.get("status")
        if status not in {"failed", "skipped", "success"}:
            status = "success" if enrichment.get("sales_order") else "pending"
        items.append(
            {
                "id": str(document.get("_id", "")),
                "data": document.get("data") or {},
                "enrichment": {**enrichment, "status": status},
            }
        )
    return {
        "summary": {
            "total": total,
            "judgmentYes": yes,
            "judgmentNo": no,
            "enrichedSuccess": success,
            "enrichmentFailed": failed,
            "enrichmentPending": pending,
            "enrichmentSkipped": skipped,
            "latestAcceptedAt": latest_raw,
        },
        "trend": [
            {"date": row["_id"], "label": row["_id"][5:], "count": row["count"]}
            for row in stats.get("trend", [])
        ],
        "byType": ranked(stats.get("by_type", [])),
        "byProcessingStatus": ranked(stats.get("by_processing", [])),
        "byEnrichmentStatus": [
            {"key": key, "count": count}
            for key, count in {
                "success": success,
                "failed": failed,
                "pending": pending,
                "skipped": skipped,
            }.items()
        ],
        "items": items,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "hasMore": page * limit < total,
        },
    }
