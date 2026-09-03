"""
销售订单仓储层（MongoDB: sales_orders_sap）

职责：
- 初始化 sales_orders_sap.aufnr 唯一索引
- 跨来源（SG / KK）按 AUFNR 聚合
- 使用 bulk_write 批量 upsert
- 读取本次同步的订单文档
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any

from pymongo import UpdateOne

from app.db.mongodb import get_database
from app.models.documents import Collections
from app.services.rty_sync_types import SourceSyncResult
from app.services.sap_sales_order_service import SOURCE_ORDER, SourceFetchResult

logger = logging.getLogger(__name__)

# gather 顺序；聚合 `data` 时取此列表中最后一个成功来源的完整记录
AGGREGATE_ORDER = SOURCE_ORDER


async def init_sales_orders_index() -> None:
    """初始化 SAP 销售订单集合的唯一键和规范日期索引。"""
    db = get_database()
    await db[Collections.SALES_ORDERS_SAP].create_index(
        [("aufnr", 1)],
        unique=True,
        name="uniq_sales_orders_aufnr",
    )
    # 归一化后的计划开始日期，供时间范围筛选 / 月份分布使用。
    await db[Collections.SALES_ORDERS_SAP].create_index(
        [("gstrs_date", 1)],
        name="sales_orders_gstrs_date",
        sparse=True,
    )


def _normalize_aufnr(value: Any) -> str | None:
    """提取并清洗 AUFNR；为空 / None 时返回 None（表示应跳过）。"""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


# SAP GSTRS 计划开始日期可能以多种格式出现：
#   "2025/7/8 16:58:34"  "2025/07/08"  "2025-07-08"  "20250708"  等
# 全部归一化为可字典序比较、可按月截取的 ISO 日期 "YYYY-MM-DD"。
_DATE_FORMATS = (
    "%Y/%m/%d %H:%M:%S",
    "%Y/%m/%d %H:%M",
    "%Y/%m/%d",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
    "%Y%m%d",
)


def normalize_gstrs_date(value: Any) -> str | None:
    """
    将 SAP `GSTRS` 归一化为 ISO 日期字符串 (YYYY-MM-DD)。

    兼容斜杠 / 横杠 / 纯数字格式，月份与日允许不补零。
    无法解析（空、格式不符、非法日期）时返回 None，不抛异常。
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def aggregate_source_results(
    results: dict[str, SourceFetchResult],
    now_iso: str,
) -> tuple[dict[str, dict[str, dict]], dict[str, dict[str, dict]], dict[str, SourceSyncResult]]:
    """
    将双来源的抓取结果按 AUFNR 聚合。

    Returns:
        aufnr_sources:  {aufnr: {source: raw_record}}
        source_records: {aufnr: {source: {**raw_record, "fetched_at": now_iso}}}
        per_source:     {source: SourceSyncResult}  # 含 fetched/unique/skipped 统计
    """
    aufnr_sources: dict[str, dict[str, dict]] = {}
    source_records: dict[str, dict[str, dict]] = {}
    per_source: dict[str, SourceSyncResult] = {}

    for source, res in results.items():
        fetched = 0
        skipped = 0
        deduped: dict[str, dict] = {}

        if res.success:
            for rec in res.records:
                fetched += 1
                raw = rec if isinstance(rec, dict) else {}
                aufnr = _normalize_aufnr(raw.get("AUFNR"))
                if aufnr is None:
                    skipped += 1
                    continue
                # 同一来源重复 AUFNR → 保留列表中最后一条
                deduped[aufnr] = raw

        for aufnr, raw in deduped.items():
            aufnr_sources.setdefault(aufnr, {})[source] = raw
            source_records.setdefault(aufnr, {})[source] = {
                **raw,
                "fetched_at": now_iso,
            }

        per_source[source] = SourceSyncResult(
            success=res.success,
            fetched_count=fetched,
            unique_count=len(deduped),
            skipped_count=skipped,
            error=res.error,
        )

    return aufnr_sources, source_records, per_source


def _preferred_record(src_map: dict[str, dict]) -> dict | None:
    """
    选择 `data` 字段使用的"完整记录"。
    规则：取 AGGREGATE_ORDER 中最后一个、且本次成功的来源记录。
    """
    preferred: dict | None = None
    for s in AGGREGATE_ORDER:
        if s in src_map:
            preferred = src_map[s]
    return preferred


def normalize_quantity(value: Any) -> float:
    """将 SAP GAMNG 转换为稳定的数值字段；非法值按 0 处理。"""
    if value is None or isinstance(value, bool):
        return 0.0
    if isinstance(value, int | float):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


async def upsert_sales_orders(
    aufnr_sources: dict[str, dict[str, dict]],
    source_records: dict[str, dict[str, dict]],
    now_iso: str,
    db: Any | None = None,
) -> tuple[int, int]:
    """
    批量 upsert 订单文档。

    为每个 AUFNR 生成一条 UpdateOne（upsert=True），保证一次同步只让
    sync_count 增加 1。新订单用 $setOnInsert 初始化 first_seen_at / sync_count；
    已存在订单用 $set 更新来源数据并 $inc sync_count。

    Returns:
        (inserted, updated) 统计
    """
    if db is None:
        db = get_database()
    coll = db[Collections.SALES_ORDERS_SAP]
    aufnrs = list(aufnr_sources.keys())

    existing: dict[str, dict] = {}
    if aufnrs:
        cursor = coll.find({"aufnr": {"$in": aufnrs}})
        async for doc in cursor:
            existing[doc.get("aufnr")] = doc

    operations: list[UpdateOne] = []
    inserted = 0
    updated = 0

    for aufnr in aufnrs:
        src_map = aufnr_sources[aufnr]
        preferred = _preferred_record(src_map)
        # 标准化 data：优先使用最后一个成功来源的完整记录
        normalized: dict[str, Any] = dict(preferred) if preferred is not None else {}
        normalized["AUFNR"] = aufnr

        old_doc = existing.get(aufnr)
        if old_doc is not None:
            # 不删除已存的未知字段：合并旧 data 与新记录（新覆盖旧）
            old_data = old_doc.get("data")
            if isinstance(old_data, dict):
                normalized = {**old_data, **normalized}
            updated += 1
        else:
            inserted += 1

        # 销售订单的时间筛选与月度统计统一使用 GSTRS。
        gstrs_date = normalize_gstrs_date(normalized.get("GSTRS"))

        incoming_records = source_records.get(aufnr, {})
        old_records = old_doc.get("source_records") if old_doc else None
        merged_records = dict(old_records) if isinstance(old_records, dict) else {}
        merged_records.update(incoming_records)
        # 来源数组按固定顺序（SG, KK）输出，保证确定性；失败或未返回来源
        # 不会出现在 incoming_records 中，因此自然保留历史成功来源。
        sources_list = [s for s in AGGREGATE_ORDER if s in merged_records]
        quantity = normalize_quantity(normalized.get("GAMNG"))

        operations.append(
            UpdateOne(
                {"aufnr": aufnr},
                {
                    "$set": {
                        "data": normalized,
                        "quantity": quantity,
                        "source_records": merged_records,
                        "sources": sources_list,
                        "gstrs_date": gstrs_date,
                        "last_synced_at": now_iso,
                    },
                    "$setOnInsert": {
                        "aufnr": aufnr,
                        "first_seen_at": now_iso,
                    },
                    "$inc": {"sync_count": 1},
                },
                upsert=True,
            )
        )

    if operations:
        await coll.bulk_write(operations)

    return inserted, updated


async def get_orders_by_aufnrs(aufnrs: list[str]) -> list[dict]:
    """读取本次同步涉及的订单文档（按 AUFNR 查询）。"""
    db = get_database()
    coll = db[Collections.SALES_ORDERS_SAP]
    if not aufnrs:
        return []
    cursor = coll.find({"aufnr": {"$in": aufnrs}})
    docs = await cursor.to_list(length=len(aufnrs) + 100)
    return docs


# ============== 筛选 / 统计 ==============


def _build_order_filter(
    cp_xh: list[str] | None = None,
    lgort: list[str] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    keyword: str | None = None,
) -> dict:
    """
    根据机型 / 基地 / 时间范围 / 订单号关键词构造 MongoDB 查询条件。

    - cp_xh / lgort：精确匹配；传入多个时退化为 $in。
      机型取 data.MAKTX_TH（SAP 物料描述），基地取 data.LGORT。
    - date_from / date_to：作用于 data.GSTRS 派生的 gstrs_date（ISO YYYY-MM-DD），
      支持单边或双边闭区间。参数须为合法 ISO 日期，否则忽略该边。
    - keyword：对 AUFNR 做不区分大小写的模糊匹配（正则特殊字符已转义）。
    """
    f: dict[str, Any] = {}
    if cp_xh:
        f["data.MAKTX_TH"] = {"$in": cp_xh} if len(cp_xh) > 1 else cp_xh[0]
    if lgort:
        f["data.LGORT"] = {"$in": lgort} if len(lgort) > 1 else lgort[0]
    if date_from or date_to:
        ds: dict[str, str] = {}
        if date_from and normalize_gstrs_date(date_from):
            ds["$gte"] = normalize_gstrs_date(date_from)
        if date_to and normalize_gstrs_date(date_to):
            ds["$lte"] = normalize_gstrs_date(date_to)
        if ds:
            f["gstrs_date"] = ds
    if keyword:
        kw = keyword.strip()
        if kw:
            f["aufnr"] = {"$regex": re.escape(kw), "$options": "i"}
    return f


async def query_sales_orders(
    *,
    cp_xh: list[str] | None = None,
    lgort: list[str] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    keyword: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[dict], int, bool]:
    """
    分页筛选销售订单。

    Returns:
        (docs, total, has_more)
    """
    db = get_database()
    coll = db[Collections.SALES_ORDERS_SAP]
    query_filter = _build_order_filter(cp_xh, lgort, date_from, date_to, keyword)
    skip = (page - 1) * page_size
    cursor = coll.find(query_filter).sort("aufnr", 1).skip(skip).limit(page_size + 1)
    docs = await cursor.to_list(length=page_size + 1)
    has_more = len(docs) > page_size
    if has_more:
        docs = docs[:page_size]
    total = await coll.count_documents(query_filter)
    return docs, total, has_more


async def list_sales_order_customers() -> list[str]:
    """返回销售订单表中去重后的最终用户名称。"""
    db = get_database()
    coll = db[Collections.SALES_ORDERS_SAP]
    pipeline = [
        {"$match": {"data.NAME1_ZU": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$data.NAME1_ZU"}},
        {"$sort": {"_id": 1}},
    ]
    rows = await coll.aggregate(pipeline).to_list(length=None)
    return [str(row["_id"]).strip() for row in rows if str(row.get("_id") or "").strip()]


async def list_sales_order_filter_options() -> dict[str, list[str]]:
    """Return distinct model, base, and customer values in one aggregation."""
    db = get_database()
    coll = db[Collections.SALES_ORDERS_SAP]
    result = await coll.aggregate(
        [
            {
                "$facet": {
                    "models": [
                        {"$match": {"data.MAKTX_TH": {"$nin": [None, ""]}}},
                        {"$group": {"_id": "$data.MAKTX_TH"}},
                        {"$sort": {"_id": 1}},
                    ],
                    "bases": [
                        {"$match": {"data.LGORT": {"$nin": [None, ""]}}},
                        {"$group": {"_id": "$data.LGORT"}},
                        {"$sort": {"_id": 1}},
                    ],
                    "customers": [
                        {"$match": {"data.NAME1_ZU": {"$nin": [None, ""]}}},
                        {"$group": {"_id": "$data.NAME1_ZU"}},
                        {"$sort": {"_id": 1}},
                    ],
                }
            }
        ]
    ).to_list(length=1)
    facet = result[0] if result else {}

    def values(key: str) -> list[str]:
        return [
            str(row.get("_id")).strip()
            for row in facet.get(key, [])
            if str(row.get("_id") or "").strip()
        ]

    return {
        "models": values("models"),
        "bases": values("bases"),
        "customers": values("customers"),
    }


async def aggregate_sales_orders(
    *,
    cp_xh: list[str] | None = None,
    lgort: list[str] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    keyword: str | None = None,
) -> dict:
    """
    对筛选后的销售订单做多维度统计。

    Returns:
        {
            "total": int,
            "total_quantity": int,
            "by_model": [{"key": <MAKTX_TH>, "count": int}, ...],
            "by_base":  [{"key": <LGORT>, "count": int}, ...],
            "by_month": [{"key": "YYYY-MM", "count": int}, ...],
        }
    空值（None / 空串）维度不参与分组。
    """
    db = get_database()
    coll = db[Collections.SALES_ORDERS_SAP]
    match = _build_order_filter(cp_xh, lgort, date_from, date_to, keyword)
    pipeline: list[dict] = []
    if match:
        pipeline.append({"$match": match})
    pipeline.append(
        {
            "$facet": {
                "total": [{"$count": "count"}],
                "total_quantity": [
                    {"$group": {"_id": None, "sum": {"$sum": "$quantity"}}},
                ],
                "by_model": [
                    {"$match": {"data.MAKTX_TH": {"$nin": [None, ""]}}},
                    {"$group": {"_id": "$data.MAKTX_TH", "count": {"$sum": 1}}},
                    {"$sort": {"count": -1, "_id": 1}},
                ],
                "by_base": [
                    {"$match": {"data.LGORT": {"$nin": [None, ""]}}},
                    {"$group": {"_id": "$data.LGORT", "count": {"$sum": 1}}},
                    {"$sort": {"count": -1, "_id": 1}},
                ],
                "by_month": [
                    {"$match": {"gstrs_date": {"$nin": [None, ""]}}},
                    {
                        "$group": {
                            "_id": {"$substrBytes": ["$gstrs_date", 0, 7]},
                            "count": {"$sum": 1},
                        }
                    },
                    {"$sort": {"_id": 1}},
                ],
            }
        }
    )
    result = await coll.aggregate(pipeline).to_list(length=1)
    facet = result[0] if result else {}

    total = facet.get("total", [{}])[0].get("count", 0) if facet.get("total") else 0
    total_quantity = (
        float(facet["total_quantity"][0].get("sum", 0)) if facet.get("total_quantity") else 0
    )

    def _to_items(rows: list[dict]) -> list[dict]:
        return [{"key": r["_id"], "count": r["count"]} for r in rows]

    return {
        "total": total,
        "total_quantity": total_quantity,
        "by_model": _to_items(facet.get("by_model", [])),
        "by_base": _to_items(facet.get("by_base", [])),
        "by_month": _to_items(facet.get("by_month", [])),
    }
