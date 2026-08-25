#!/usr/bin/env python3
"""批量补采 SCS DOA 判定为“是”记录的产品实体信息。

从仓库根目录执行：
    SCS_USERNAME=<username> SCS_PASSWORD=<password> \\
    uv run --project backend python scripts/enrich_scs_doa_sales_orders.py

脚本只登录一次并复用同一个 Session。除销售订单号外，还采集物料 SN、出厂日期和
保修结束日期（SCS 页面标签为“质保到期日”）。采集状态写回 scs_doa_results，其中
``data.采集失败`` 用于标识采集失败的记录；进度汇总写入
scs_doa_sales_order_progress；中断后直接重跑即可续传。失败记录默认保留，使用
--retry-failed 才会重新请求。每条失败记录会立即输出服务单号，脚本结束时还会汇总
当前仍失败的全部服务单号。
"""

from __future__ import annotations

import argparse
import logging
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from typing import Any

import requests
from lxml import html
from pymongo import MongoClient, UpdateOne

from spider_scs import login


MONGO_URL = os.getenv("MONGODB_URL", "mongodb://10.17.154.252:27019")
DB_NAME = os.getenv("MONGODB_DB_NAME", "quality_monitoring")
COLLECTION_NAME = "scs_doa_results"
SALES_ORDERS_COLLECTION_NAME = "sales_orders_sap"
PROGRESS_COLLECTION_NAME = "scs_doa_sales_order_progress"
PROGRESS_ID = "sales_order_enrichment"
SERVICE_ORDER_URL = (
    "https://scs.sugon.com/prod/PM_so_service_order_control_static_tab_01_2026.pml"
)
SUB_SERVICE_ORDER_URL = "https://scs.sugon.com/prod/PM_so_sub_service_order_findbyso_uid_so_service_order_list_02_2026.pml"
PRODUCT_ENTITY_URL = (
    "https://scs.sugon.com/prod/PM_pd_product_entity_05_control_main_new_window.pml"
)
JUDGMENT_FIELD = "data.判定结果"
SERVICE_ORDER_ID_FIELD = "data.服务单号_id"
CONTEXT_VALUE_PATTERN = re.compile(r"contextValue=([0-9a-fA-F]+)")
ORDER_VALUE_PATTERN = re.compile(r"[A-Za-z0-9-]{6,}")
REQUEST_INTERVAL_MIN_SECONDS = 3
REQUEST_INTERVAL_MAX_SECONDS = 8

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def render_progress(
    current: int,
    total: int,
    success: int,
    failed: int,
    skipped: int,
) -> None:
    """Render an in-place terminal progress bar without extra dependencies."""
    total = max(total, 1)
    ratio = min(current / total, 1.0)
    width = 28
    filled = int(width * ratio)
    bar = "#" * filled + "-" * (width - filled)
    sys.stdout.write(
        f"\r进度 [{bar}] {current}/{total} 成功:{success} 失败:{failed} 跳过:{skipped}"
    )
    sys.stdout.flush()


def finish_progress() -> None:
    """Move subsequent log output to a new line after the progress bar."""
    sys.stdout.write("\n")
    sys.stdout.flush()


class RequestPacer:
    """Ensure a random integer delay between 5 and 15 seconds per request."""

    def __init__(
        self,
        minimum: int = REQUEST_INTERVAL_MIN_SECONDS,
        maximum: int = REQUEST_INTERVAL_MAX_SECONDS,
    ) -> None:
        if minimum < 0 or maximum < minimum:
            raise ValueError("请求间隔范围无效")
        self._minimum = minimum
        self._maximum = maximum
        self._last_completed_at: float | None = None

    def wait(self) -> None:
        """等待到达下一次请求允许时间。"""
        if self._last_completed_at is None:
            return
        interval = random.randint(self._minimum, self._maximum)
        remaining = interval - (time.monotonic() - self._last_completed_at)
        if remaining > 0:
            logger.info("随机等待 %d 秒后发送下一次 SCS 请求", interval)
            time.sleep(remaining)

    def mark_completed(self) -> None:
        """记录最近一次请求完成时间。"""
        self._last_completed_at = time.monotonic()


def clean_text(value: str) -> str:
    """归一化页面中的空白字符。"""
    return " ".join(value.replace("\xa0", " ").split())


def parse_html(content: bytes) -> html.HtmlElement:
    """显式解码中文页面，避免 lxml 对无声明 bytes 按 Latin-1 解析。"""
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("gb18030", errors="replace")
    return html.fromstring(text)


def request_service_order(
    session: requests.Session,
    service_order_id: str,
    clientstamp: str,
    timeout: float,
    pacer: RequestPacer,
) -> str:
    """请求服务单页面，并返回子服务单的 contextValue。"""
    pacer.wait()
    try:
        response = session.get(
            SERVICE_ORDER_URL,
            params=[
                ("1", "1"),
                ("1", "1"),
                ("clientstamp", clientstamp),
                ("dataBus", "setContext"),
                ("contextKey", "so_service_order"),
                ("contextValue", service_order_id),
                (
                    "target",
                    "PM_so_service_order_control_main_static_Main_2026tabcontent",
                ),
            ],
            timeout=timeout,
        )
    finally:
        pacer.mark_completed()
    response.raise_for_status()
    document = parse_html(response.content)
    links = document.xpath("//a[contains(@href, 'contextKey=so_sub_service_order')]")
    if not links:
        pacer.wait()
        try:
            sub_response = session.get(
                SUB_SERVICE_ORDER_URL,
                params=[
                    ("1", "1"),
                    ("1", "1"),
                    ("clientstamp", clientstamp),
                    ("dataBus", "setContext"),
                    ("contextKey", "so_service_order"),
                    ("contextValue", service_order_id),
                    (
                        "target",
                        "PM_so_service_order_control_main_static_Main_2026tabcontent",
                    ),
                ],
                timeout=timeout,
            )
        finally:
            pacer.mark_completed()
        sub_response.raise_for_status()
        document = parse_html(sub_response.content)
        links = document.xpath(
            "//a[contains(@href, 'contextKey=so_sub_service_order')]"
        )

    if not links:
        match = re.search(
            r"contextKey(?:=|%3D)so_sub_service_order(?:&amp;|&|%26).*?"
            r"contextValue(?:=|%3D)([0-9a-fA-F]+)",
            html.tostring(document, encoding="unicode"),
        )
        if match is None:
            raise ValueError("服务单页面未找到子服务单产品实体链接")
        return match.group(1)

    match = CONTEXT_VALUE_PATTERN.search(links[0].get("href") or "")
    if match is None:
        raise ValueError("子服务单产品实体链接缺少 contextValue")
    return match.group(1)


def request_product_entity(
    session: requests.Session,
    sub_service_order_id: str,
    clientstamp: str,
    timeout: float,
    pacer: RequestPacer,
) -> bytes:
    """请求产品实体页面。"""
    pacer.wait()
    try:
        response = session.get(
            PRODUCT_ENTITY_URL,
            params={
                "1": "1",
                "isApp": "true",
                "clientstamp": clientstamp,
                "dataBus": "setContext",
                "contextKey": "so_sub_service_order",
                "contextValue": sub_service_order_id,
                "checkinstance": sub_service_order_id,
                "checkinstance_hidden": sub_service_order_id,
                "target": "_opener_window",
            },
            timeout=timeout,
        )
    finally:
        pacer.mark_completed()
    response.raise_for_status()
    return response.content


def extract_sales_order(content: bytes) -> str | None:
    """从产品实体页面中提取“销售订单”字段的值。"""
    document = parse_html(content)

    for row in document.xpath("//tr"):
        cells = row.xpath("./th | ./td")
        if not cells:
            continue
        label = clean_text(cells[0].text_content())
        if "销售订单" not in label:
            continue

        values = row.xpath(
            ".//input/@value | .//textarea/text() | .//select/option[@selected]/text()"
        )
        values.extend(cell.text_content() for cell in cells[1:])
        for value in values:
            candidate = clean_text(value)
            match = ORDER_VALUE_PATTERN.search(candidate)
            if match:
                return match.group(0)

    named_values = document.xpath(
        "//input[contains(translate(@name, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', "
        "'abcdefghijklmnopqrstuvwxyz'), 'sale') or "
        "contains(translate(@id, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'sale')]/@value"
    )
    for value in named_values:
        candidate = clean_text(value)
        match = ORDER_VALUE_PATTERN.search(candidate)
        if match:
            return match.group(0)
    return None


def _field_label(value: str) -> str:
    """Normalize a product-entity table label for tolerant matching."""
    return clean_text(value).rstrip(":：").replace(" ", "").replace("　", "")


def _product_cell_value(cell: Any) -> str:
    """Read both visible text and values rendered in form controls."""
    candidates = [cell.text_content()]
    candidates.extend(
        cell.xpath(
            ".//input/@value | .//textarea/text() | .//select/option[@selected]/text()"
        )
    )
    for candidate in candidates:
        value = clean_text(str(candidate))
        if value:
            return value
    return ""


def extract_product_entity_fields(content: bytes) -> dict[str, str]:
    """Extract the product SN and lifecycle dates from the product entity page.

    SCS currently labels the SN as ``产品条码`` and the warranty end date as
    ``质保到期日``.  Older/newer page variants use ``物料SN`` or
    ``保修结束日期``; all are mapped to stable collector field names.
    """
    document = parse_html(content)
    extracted = {
        "material_sn": "",
        "factory_date": "",
        "warranty_end_date": "",
    }
    sn_labels = {
        "产品条码",
        "产品SN",
        "物料SN",
        "物料S/N",
        "曙光S/N",
        "序列号",
    }
    factory_labels = {"出厂日期", "生产日期", "产品出厂日期"}
    warranty_labels = {
        "保修结束日期",
        "保修到期日",
        "质保到期日",
        "质保结束日期",
    }

    # Product entity values are rendered as adjacent label/value cells:
    # <th>产品条码:</th><td>...</td><th>出厂日期:</th><td>...</td>.
    for row in document.xpath("//tr"):
        cells = row.xpath("./th | ./td")
        values = [_product_cell_value(cell) for cell in cells]
        for index in range(0, len(values) - 1, 2):
            label = _field_label(values[index])
            value = values[index + 1]
            if label in sn_labels and value and not extracted["material_sn"]:
                extracted["material_sn"] = value
            elif label in factory_labels and value and not extracted["factory_date"]:
                extracted["factory_date"] = value
            elif (
                label in warranty_labels
                and value
                and not extracted["warranty_end_date"]
            ):
                extracted["warranty_end_date"] = value

    # Keep empty values for fields that are present but blank, so a successful
    # collection is not retried forever when SCS has no warranty date.
    return extracted


def normalize_sales_order(value: Any) -> str:
    """Normalize order identifiers before comparing the two collections."""
    return clean_text(str(value)) if value is not None else ""


def load_sap_sales_orders(sales_orders_collection: Any) -> set[str]:
    """Load the distinct SAP VBELN values used by the is_5000 check."""
    values = sales_orders_collection.distinct("data.VBELN")
    return {order for value in values if (order := normalize_sales_order(value))}


def refresh_is_5000_flags(
    collection: Any,
    sales_orders_collection: Any,
    progress_collection: Any,
) -> tuple[int, int]:
    """Re-evaluate the flag for every DOA record that already has a sales order.

    Both the top-level field and the enrichment namespace are updated so API
    queries can use ``is_5000`` while the raw enrichment metadata stays grouped.
    """
    sap_orders = load_sap_sales_orders(sales_orders_collection)
    operations = []
    total = matched = 0
    cursor = collection.find(
        {
            "$or": [
                {"scs_enrichment.sales_order": {"$exists": True}},
                {"data.销售订单号": {"$exists": True}},
            ]
        },
        {"_id": 1, "scs_enrichment.sales_order": 1, "data.销售订单号": 1},
    )
    for document in cursor:
        enrichment = document.get("scs_enrichment") or {}
        data = document.get("data") or {}
        sales_order = normalize_sales_order(
            enrichment.get("sales_order") or data.get("销售订单号")
        )
        if not sales_order:
            continue
        is_5000 = sales_order in sap_orders
        total += 1
        matched += int(is_5000)
        operations.append(
            UpdateOne(
                {"_id": document["_id"]},
                {
                    "$set": {
                        "data.is_5000": is_5000,
                        "scs_enrichment.is_5000": is_5000,
                        "scs_enrichment.is_5000_checked_at": datetime.now(timezone.utc),
                    }
                },
            )
        )

    if operations:
        collection.bulk_write(operations, ordered=False)
    progress_collection.update_one(
        {"_id": PROGRESS_ID},
        {
            "$set": {
                "is_5000_refreshed_at": datetime.now(timezone.utc),
                "is_5000_checked": total,
                "is_5000_matched": matched,
            }
        },
        upsert=True,
    )
    logger.info(
        "is_5000 历史重判完成：已检查=%d，匹配 sales_orders_sap=%d",
        total,
        matched,
    )
    return total, matched


def enrich_document(
    collection: Any,
    sap_sales_orders: set[str],
    session: requests.Session,
    document: dict[str, Any],
    clientstamp: str,
    timeout: float,
    pacer: RequestPacer,
) -> dict[str, str]:
    """补采单条记录并返回销售订单号、物料 SN 和日期字段。"""
    service_order_id = document["data"]["服务单号_id"]
    sub_service_order_id = request_service_order(
        session, service_order_id, clientstamp, timeout, pacer
    )
    product_entity = request_product_entity(
        session, sub_service_order_id, clientstamp, timeout, pacer
    )
    sales_order = extract_sales_order(product_entity)
    if sales_order is None:
        raise ValueError("产品实体页面未找到销售订单号")
    product_fields = extract_product_entity_fields(product_entity)
    if not product_fields["material_sn"]:
        raise ValueError("产品实体页面未找到物料 SN/产品条码")

    collected_at = datetime.now(timezone.utc)
    is_5000 = normalize_sales_order(sales_order) in sap_sales_orders
    collection.update_one(
        {"_id": document["_id"]},
        {
            "$set": {
                "data.物料SN": product_fields["material_sn"],
                "data.出厂日期": product_fields["factory_date"],
                "data.保修结束日期": product_fields["warranty_end_date"],
                "data.is_5000": is_5000,
                "scs_enrichment.service_order_id": service_order_id,
                "scs_enrichment.sub_service_order_id": sub_service_order_id,
                "scs_enrichment.sales_order": sales_order,
                "scs_enrichment.material_sn": product_fields["material_sn"],
                "scs_enrichment.factory_date": product_fields["factory_date"],
                "scs_enrichment.warranty_end_date": product_fields["warranty_end_date"],
                "scs_enrichment.is_5000": is_5000,
                "scs_enrichment.is_5000_checked_at": collected_at,
                "scs_enrichment.product_entity_fields_collected": True,
                "scs_enrichment.enriched_at": collected_at,
            }
        },
    )

    return {"sales_order": sales_order, "is_5000": is_5000, **product_fields}


def is_terminal(document: dict[str, Any], retry_failed: bool) -> bool:
    """判断记录是否已经有最终状态，可以在续传时跳过。"""
    enrichment = document.get("scs_enrichment") or {}
    status = enrichment.get("status")
    if status == "skipped":
        return True
    if status == "success":
        return bool(enrichment.get("product_entity_fields_collected"))
    if status == "failed":
        return not retry_failed
    # 兼容脚本改造前已经写入销售订单号的记录：这些记录需要补采新增字段。
    return bool(
        enrichment.get("sales_order")
        and enrichment.get("product_entity_fields_collected")
    )


def save_record_status(
    collection: Any,
    document: dict[str, Any],
    *,
    status: str,
    error: str | None = None,
    service_order_id: str | None = None,
    increment_attempt: bool = True,
) -> None:
    """把单条记录的采集结果写回原集合。"""
    now = datetime.now(timezone.utc)
    set_fields: dict[str, Any] = {
        "data.采集失败": status == "failed",
        "scs_enrichment.status": status,
        "scs_enrichment.last_attempt_at": now,
    }
    if service_order_id:
        set_fields["scs_enrichment.service_order_id"] = service_order_id
    if error:
        set_fields["scs_enrichment.last_error"] = error
    else:
        set_fields["scs_enrichment.last_error"] = None

    update: dict[str, Any] = {"$set": set_fields}
    if increment_attempt:
        update["$inc"] = {"scs_enrichment.attempts": 1}
    collection.update_one(
        {"_id": document["_id"]},
        update,
    )


def update_progress(
    progress_collection: Any,
    *,
    scanned: int,
    success: int,
    failed: int,
    skipped: int,
    document: dict[str, Any],
    completed: bool = False,
) -> None:
    """每处理一条记录就保存批次进度，支持中断后查看和续传。"""
    now = datetime.now(timezone.utc)
    progress_collection.update_one(
        {"_id": PROGRESS_ID},
        {
            "$set": {
                "updated_at": now,
                "scanned": scanned,
                "success": success,
                "failed": failed,
                "skipped": skipped,
                "last_record_id": str(document.get("_id")),
                "last_service_order": (document.get("data") or {}).get("服务单号"),
                "completed": completed,
            },
            "$setOnInsert": {"started_at": now},
        },
        upsert=True,
    )


def format_service_order(document: dict[str, Any]) -> str:
    """Format the visible service order number, falling back to its internal ID."""
    data = document.get("data") or {}
    service_order = clean_text(str(data.get("服务单号") or ""))
    service_order_id = clean_text(
        str(
            data.get("服务单号_id")
            or (document.get("scs_enrichment") or {}).get("service_order_id")
            or ""
        )
    )
    if service_order and service_order_id and service_order != service_order_id:
        return f"{service_order} (服务单号_id={service_order_id})"
    return service_order or service_order_id or str(document.get("_id"))


def log_failed_service_orders(collection: Any) -> int:
    """输出当前集合中仍未采集成功的服务单号，便于直接重试或人工排查。"""
    query = {
        JUDGMENT_FIELD: "是",
        "$or": [
            {"scs_enrichment.status": "failed"},
            {"data.采集失败": True},
        ],
    }
    documents = collection.find(
        query,
        {"_id": 1, "data.服务单号": 1, SERVICE_ORDER_ID_FIELD: 1},
    ).sort("_id", 1)
    failed_documents = list(documents)
    logger.info("当前仍失败的服务单号（共 %d 条）", len(failed_documents))
    for document in failed_documents:
        logger.error("采集失败服务单号：%s", format_service_order(document))
    return len(failed_documents)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="补采 SCS DOA 产品实体信息")
    parser.add_argument("--username", default=os.getenv("SCS_USERNAME"))
    parser.add_argument("--password", default=os.getenv("SCS_PASSWORD"))
    parser.add_argument("--limit", type=int, help="本次最多处理记录数；不传则处理全部")
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="重试之前 status=failed 的记录；默认跳过失败记录",
    )
    parser.add_argument("--timeout", type=float, default=60, help="单次请求超时秒数")
    parser.add_argument("--clientstamp", default=str(int(time.time() * 1000)))
    args = parser.parse_args()
    if not args.username or not args.password:
        parser.error("请通过 SCS_USERNAME/SCS_PASSWORD 环境变量或命令行提供 SCS 凭据")
    if args.limit is not None and args.limit < 1:
        parser.error("--limit 必须大于 0")
    return args


def main() -> None:
    args = parse_args()
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0",
            "Referer": "http://scs.sugon.com/",
            "Origin": "http://scs.sugon.com",
        }
    )
    login(session, args.username, args.password, args.clientstamp, args.timeout)
    pacer = RequestPacer()
    pacer.mark_completed()

    mongo = MongoClient(MONGO_URL, serverSelectionTimeoutMS=int(args.timeout * 1000))
    try:
        collection = mongo[DB_NAME][COLLECTION_NAME]
        sales_orders_collection = mongo[DB_NAME][SALES_ORDERS_COLLECTION_NAME]
        progress_collection = mongo[DB_NAME][PROGRESS_COLLECTION_NAME]
        sap_sales_orders = load_sap_sales_orders(sales_orders_collection)
        refresh_is_5000_flags(
            collection,
            sales_orders_collection,
            progress_collection,
        )
        query = {JUDGMENT_FIELD: "是"}
        total_records = collection.count_documents(query)
        progress_total = total_records
        cursor = collection.find(query).sort("_id", 1)

        scanned = success = failed = skipped = handled = 0
        logger.info(
            "开始续传：集合=%s，筛选=%s，limit=%s，retry_failed=%s",
            COLLECTION_NAME,
            query,
            args.limit or "全部",
            args.retry_failed,
        )
        render_progress(0, progress_total, success, failed, skipped)
        progress_collection.update_one(
            {"_id": PROGRESS_ID},
            {
                "$set": {
                    "started_at": datetime.now(timezone.utc),
                    "updated_at": datetime.now(timezone.utc),
                    "completed": False,
                    "run_limit": args.limit,
                    "retry_failed": args.retry_failed,
                }
            },
            upsert=True,
        )

        for document in cursor:
            if args.limit is not None and handled >= args.limit:
                break
            scanned += 1
            if is_terminal(document, args.retry_failed):
                if (document.get("scs_enrichment") or {}).get("status") == "failed":
                    collection.update_one(
                        {"_id": document["_id"]},
                        {"$set": {"data.采集失败": True}},
                    )
                skipped += 1
                update_progress(
                    progress_collection,
                    scanned=scanned,
                    success=success,
                    failed=failed,
                    skipped=skipped,
                    document=document,
                )
                render_progress(scanned, progress_total, success, failed, skipped)
                continue

            data = document.get("data") or {}
            service_order_id = data.get("服务单号_id")
            handled += 1
            if not service_order_id:
                skipped += 1
                save_record_status(
                    collection,
                    document,
                    status="skipped",
                    error="缺少 服务单号_id，无法请求服务单详情",
                    increment_attempt=False,
                )
                update_progress(
                    progress_collection,
                    scanned=scanned,
                    success=success,
                    failed=failed,
                    skipped=skipped,
                    document=document,
                )
                render_progress(scanned, progress_total, success, failed, skipped)
                logger.warning("记录 %s 跳过：缺少 服务单号_id", document.get("_id"))
                continue

            save_record_status(
                collection,
                document,
                status="in_progress",
                service_order_id=service_order_id,
            )
            try:
                enrichment = enrich_document(
                    collection,
                    sap_sales_orders,
                    session,
                    document,
                    args.clientstamp,
                    args.timeout,
                    pacer,
                )
                save_record_status(
                    collection,
                    document,
                    status="success",
                    service_order_id=service_order_id,
                    increment_attempt=False,
                )
                success += 1
                logger.info(
                    "记录 %s 补采成功，销售订单号=%s is_5000=%s 物料SN=%s 出厂日期=%s 保修结束日期=%s",
                    document["_id"],
                    enrichment["sales_order"],
                    enrichment["is_5000"],
                    enrichment["material_sn"],
                    enrichment["factory_date"] or "(空)",
                    enrichment["warranty_end_date"] or "(空)",
                )
            except Exception as exc:  # 单条失败不阻断后续续传
                failed += 1
                save_record_status(
                    collection,
                    document,
                    status="failed",
                    error=f"{type(exc).__name__}: {exc}",
                    service_order_id=service_order_id,
                    increment_attempt=False,
                )
                logger.exception(
                    "服务单号=%s 记录=%s 补采失败",
                    format_service_order(document),
                    document.get("_id"),
                )

            update_progress(
                progress_collection,
                scanned=scanned,
                success=success,
                failed=failed,
                skipped=skipped,
                document=document,
            )
            render_progress(scanned, progress_total, success, failed, skipped)

        progress_collection.update_one(
            {"_id": PROGRESS_ID},
            {
                "$set": {
                    "completed": args.limit is None,
                    "completed_at": datetime.now(timezone.utc),
                }
            },
            upsert=True,
        )
        logger.info(
            "补采完成：扫描=%d 成功=%d 失败=%d 跳过=%d",
            scanned,
            success,
            failed,
            skipped,
        )
        log_failed_service_orders(collection)
    finally:
        finish_progress()
        mongo.close()


if __name__ == "__main__":
    main()
