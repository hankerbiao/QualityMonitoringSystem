"""MongoDB query and aggregation builders for the DOA domain."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.models.documents import Collections
from app.schemas.doa import DoaFilters


def _normalize_filter_date(value: str | None) -> str | None:
    if not value:
        return None
    for pattern in ("%Y-%m-%d", "%Y/%m/%d", "%Y%m%d"):
        try:
            return datetime.strptime(value[:10], pattern).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def build_order_query(
    filters: DoaFilters | None = None, *, include_date: bool = True
) -> dict[str, Any]:
    """Build a query against normalized SAP sales-order fields."""
    query: dict[str, Any] = {}
    if filters is None:
        return query
    date_query: dict[str, str] = {}
    if include_date:
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


def build_scs_query(filters: DoaFilters | None = None) -> dict[str, Any]:
    query: dict[str, Any] = {
        "$or": [{"is_5000": True}, {"scs_enrichment.is_5000": True}],
        "data.判定结果": "是",
    }
    if filters is None:
        return query
    date_query: dict[str, str] = {}
    if date_from := _normalize_filter_date(filters.acceptedDateFrom or filters.dateFrom):
        date_query["$gte"] = date_from
    if date_to := _normalize_filter_date(filters.acceptedDateTo or filters.dateTo):
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
    """Escape regex metacharacters inside a Mongo aggregation expression."""
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


def build_order_stats_pipeline(filters: DoaFilters) -> list[dict[str, Any]]:
    return [
        {"$match": build_order_query(filters)},
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


def build_repair_pipeline(
    filters: DoaFilters,
    *,
    page: int | None = None,
    limit: int | None = None,
    include_data: bool = False,
    replacement_only: bool = False,
) -> list[dict[str, Any]]:
    """Build the SCS-to-SAP repair aggregation without executing it."""
    order_query = build_order_query(filters, include_date=not replacement_only)
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
        "replacement_total": [{"$match": {"has_change": True}}, {"$count": "count"}],
        "by_customer": [
            {
                "$group": {
                    "_id": "$customer",
                    "repair": {"$sum": "$repair_count"},
                    "replacement": {"$sum": {"$cond": [{"$eq": ["$has_change", True]}, 1, 0]}},
                }
            }
        ],
        "by_model": [
            {
                "$group": {
                    "_id": "$model",
                    "repair": {"$sum": "$repair_count"},
                    "replacement": {"$sum": {"$cond": [{"$eq": ["$has_change", True]}, 1, 0]}},
                }
            }
        ],
        "trend": [
            {
                "$group": {
                    "_id": _period_expression("$accepted_at", filters.timeGranularity),
                    "repair": {"$sum": "$repair_count"},
                    "replacement": {"$sum": {"$cond": [{"$eq": ["$has_change", True]}, 1, 0]}},
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
        {"$match": build_scs_query(filters)},
        {
            "$lookup": {
                "from": Collections.SALES_ORDERS_SAP,
                "let": {"sales_order": "$scs_enrichment.sales_order"},
                "pipeline": order_pipeline,
                "as": "orders",
            }
        },
        {"$unwind": "$orders"},
    ]
    if not replacement_only:
        pipeline.append(
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
                                            _regex_literal({"$ifNull": ["$data.产品/备件名称", ""]}),
                                        ]
                                    },
                                    "options": "i",
                                }
                            },
                        ]
                    }
                }
            }
        )
    pipeline.extend(
        [
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
            {
                "$group": {
                    "_id": "$_id",
                    "data": {"$first": "$data"},
                    "scs_enrichment": {"$first": "$scs_enrichment"},
                    "orders": {"$first": "$orders"},
                    "changes": {"$first": "$changes"},
                }
            },
            {"$project": fields},
        ]
    )
    if replacement_only:
        pipeline.append({"$match": {"has_change": True}})
    pipeline.append({"$facet": facet})
    return pipeline
