#!/usr/bin/env python3
"""采集 SCS 换件登记列表（PM_sp_change_Result_01）。

从仓库根目录执行：
    SCS_USERNAME=<username> SCS_PASSWORD=<password> \\
        uv run --project backend python scripts/archive/data_sync/spider_change_result.py

按页面分页采集 ``PM_sp_change_Result_01.pml`` 的完整表格，保存到 MongoDB
集合 ``scs_change_results``。登录、请求间隔、页面解析与断点续传均复用
``scripts/archive/data_sync/spider_scs.py`` 的成熟逻辑；每两页请求之间随机间隔 5-10 秒。

同一登记记录（服务单号+客户+设备+PN+SN+原厂原码+操作人+操作时间）以稳定键
``record_key`` 幂等保存，重复运行不会产生重复文档。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timezone

import requests
from pymongo import MongoClient, UpdateOne

from spider_scs import (
    clean,
    finish_page_progress,
    render_page_progress,
    wait_random_interval,
)

RESULT_URL = "https://scs.sugon.com/prod/PM_sp_change_Result_01.pml"
FORM_ID = "a8a80e692948867c501948be54ba50b6f"
TABLE_ID = "g8a80e692948867c501948be54ba50b6f"

MONGO_URL = os.getenv("MONGODB_URL", "mongodb://10.17.154.252:27019")
DB_NAME = os.getenv("MONGODB_DB_NAME", "quality_monitoring")
RESULT_COLLECTION = "scs_change_results"
REQUEST_INTERVAL_MIN_SECONDS = 5
REQUEST_INTERVAL_MAX_SECONDS = 10
PROGRESS_ID = "PM_sp_change_Result_01"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def parse_form(content: bytes):
    """按固定 FORM 目标解析页面，返回字段与表格行。"""

    from lxml import html

    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("gb18030", errors="replace")
    document = html.fromstring(text)
    targets = document.xpath(f'//*[@id="{FORM_ID}"]')
    if not targets:
        raise RuntimeError(f"未找到元素: {FORM_ID}")
    target = targets[0]

    fields = {}
    controls = target.xpath(".//input | .//select | .//textarea")
    for index, node in enumerate(controls, 1):
        key = clean(node.get("name") or node.get("id") or f"field_{index}")
        value = clean(node.get("value") or node.text_content())
        if key in fields:
            fields[key] = f"{fields[key]},{value}"
        else:
            fields[key] = value

    rows = []
    table_nodes = target.xpath(f'.//*[@id="{TABLE_ID}"] | .//table')
    for table in table_nodes:
        table_rows = table.xpath(".//tr")
        if not table_rows:
            continue
        header_nodes = table_rows[0].xpath("./th | ./td")
        headers = [clean(node.text_content()) for node in header_nodes]
        headers = [h for h in headers if h]
        if not headers:
            headers = [f"column_{i}" for i in range(1, len(header_nodes) + 1)]

        for row in table_rows[1:]:
            cells = row.xpath("./th | ./td")
            values = [clean(cell.text_content()) for cell in cells]
            if not values or not any(values):
                continue
            record = {
                headers[i] if i < len(headers) else f"column_{i + 1}": value
                for i, value in enumerate(values)
            }
            rows.append(record)

    return fields, rows


def make_record_key(record: dict[str, str]) -> str:
    """由可读字段构造稳定业务键；操作时间相同的一页通常无唯一 ID。"""
    parts = [
        record.get("服务单号", ""),
        record.get("客户名称", ""),
        record.get("报修设备", ""),
        record.get("操作类型", ""),
        record.get("PN", ""),
        record.get("SN", ""),
        record.get("原厂原码", ""),
        record.get("操作人", ""),
        record.get("操作时间", ""),
    ]
    return "|".join(parts).replace("\n", " ").strip()


def build_query_params(
    clientstamp: str,
    page: int,
    page_size: int,
    *,
    so_code: str = "",
    prd_sn: str = "",
    customer_name: str = "",
    mtr_sn: str = "",
    mtr_code: str = "",
    mtr_name: str = "",
    original_code: str = "",
    uname: str = "",
    create_time: str = "",
    create_time2: str = "",
) -> dict[str, str]:
    return {
        "1": "1",
        "clientstamp": clientstamp,
        "so_code": so_code,
        "prd_sn": prd_sn,
        "customer_name": customer_name,
        "mtr_sn": mtr_sn,
        "mtr_code": mtr_code,
        "mtr_name": mtr_name,
        "original_code": original_code,
        "uname": uname,
        "create_time": create_time,
        "create_time2": create_time2,
        "pageNo": page,
        "pageSize": page_size,
        "target": "PM_sp_change_Result_01",
    }


def fetch_page(session, page, page_size, clientstamp, timeout, retries=3):
    last_exc = None
    for attempt in range(1, retries + 1):
        started = time.perf_counter()
        try:
            resp = session.get(
                RESULT_URL,
                params=build_query_params(clientstamp, page, page_size),
                timeout=(15.0, timeout),
            )
            elapsed = time.perf_counter() - started
            logger.info(
                "响应第 %d 页(尝试 %d/%d): status=%d elapsed=%.2fs size=%d bytes",
                page,
                attempt,
                retries,
                resp.status_code,
                elapsed,
                len(resp.content),
            )
            resp.raise_for_status()
            return resp
        except Exception as exc:
            elapsed = time.perf_counter() - started
            last_exc = exc
            logger.warning(
                "第 %d 页第 %d/%d 次请求失败: %s (elapsed=%.2fs)",
                page,
                attempt,
                retries,
                exc,
                elapsed,
            )
            if attempt < retries:
                wait_random_interval()
    raise last_exc


def save_page(collection, progress_collection, page, fields, rows, source_url):
    timestamp = datetime.now(timezone.utc)
    operations = []
    for row_index, row in enumerate(rows):
        record_key = make_record_key(row)
        if not record_key:
            continue
        canonical = json.dumps(
            row,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        record_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        operations.append(
            UpdateOne(
                {"record_key": record_key},
                {
                    "$set": {
                        "record_key": record_key,
                        "page": page,
                        "row_index": row_index,
                        "fields": fields,
                        "data": row,
                        "record_hash": record_hash,
                        "source_url": source_url,
                        "updated_at": timestamp,
                    },
                    "$setOnInsert": {"created_at": timestamp},
                },
                upsert=True,
            )
        )

    if operations:
        result = collection.bulk_write(operations, ordered=False)
        logger.info(
            "写入 %d 条: upserted=%d matched=%d modified=%d",
            len(operations),
            result.upserted_count,
            result.matched_count,
            result.modified_count,
        )
    if not rows:
        logger.warning("第 %d 页未解析到任何行，未标记完成，下次重跑会重试", page)
        return 0

    progress_collection.update_one(
        {"_id": "PM_sp_change_Result_01"},
        {
            "$addToSet": {"completed_pages": page},
            "$set": {
                "last_page": page,
                "last_count": len(rows),
                "updated_at": timestamp,
            },
            "$setOnInsert": {"created_at": timestamp},
        },
        upsert=True,
    )
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description="采集 SCS 换件登记列表")
    parser.add_argument("--username", default=os.getenv("SCS_USERNAME"))
    parser.add_argument("--password", default=os.getenv("SCS_PASSWORD"))
    parser.add_argument("--page-count", type=int, default=686)
    parser.add_argument("--start-page", type=int, default=1)
    parser.add_argument("--page-size", type=int, default=500)
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--clientstamp", default=str(int(time.time() * 1000)))
    parser.add_argument("--collection", default=RESULT_COLLECTION)
    args = parser.parse_args()

    if not args.username or not args.password:
        parser.error("请通过 SCS_USERNAME/SCS_PASSWORD 或命令行提供 SCS 凭据")
    if args.start_page < 1 or args.page_count < 1:
        parser.error("--start-page 与 --page-count 必须大于 0")

    collection_name = args.collection
    progress_name = f"{collection_name}_progress"

    logger.info("=" * 60)
    logger.info("SCS 换件登记爬虫启动")
    logger.info(
        "参数: username=%s page_count=%d page_size=%d interval=%d-%ds timeout=%.1fs",
        args.username,
        args.page_count,
        args.page_size,
        REQUEST_INTERVAL_MIN_SECONDS,
        REQUEST_INTERVAL_MAX_SECONDS,
        args.timeout,
    )
    logger.info(
        "存储: mongo=%s db=%s collection=%s progress=%s",
        MONGO_URL,
        DB_NAME,
        collection_name,
        progress_name,
    )

    session = requests.Session()
    session.trust_env = False  # 直达 SCS，避免本机失效代理
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0",
            "Referer": "http://scs.sugon.com/",
            "Origin": "http://scs.sugon.com",
        }
    )
    from scs_sync_lib import login_with_error_check

    login_with_error_check(
        session,
        args.username,
        args.password,
        args.clientstamp,
        args.timeout,
    )
    logger.info("SCS 登录授权成功，开始采集")

    mongo = MongoClient(MONGO_URL, serverSelectionTimeoutMS=int(args.timeout * 1000))
    db = mongo[DB_NAME]
    collection = db[collection_name]
    progress_collection = db[progress_name]
    collection.create_index("record_key", unique=True)
    logger.info("MongoDB 连接成功，record_key 唯一索引已就绪")

    progress = progress_collection.find_one({"_id": "PM_sp_change_Result_01"}) or {}
    completed_pages = set(progress.get("completed_pages", []))
    end_page = args.start_page + args.page_count - 1
    page_total = max(args.page_count, 1)
    render_page_progress(
        len([p for p in completed_pages if args.start_page <= p <= end_page]),
        page_total,
    )
    logger.info(
        "进度恢复: 已完成 %d/%d 页, last_page=%s last_count=%s",
        len(completed_pages),
        args.page_count,
        progress.get("last_page"),
        progress.get("last_count"),
    )

    try:
        for page in range(args.start_page, end_page + 1):
            if page in completed_pages:
                logger.info("第 %d 页已采集，跳过", page)
                render_page_progress(len(completed_pages), page_total)
                continue

            logger.info("请求第 %d/%d 页 (pageSize=%d): %s", page, end_page, args.page_size, RESULT_URL)
            started = time.perf_counter()
            try:
                response = fetch_page(session, page, args.page_size, args.clientstamp, args.timeout)
            except Exception as exc:
                logger.error("第 %d 页连续失败，跳过该页（不标记完成，可后续补采）: %s", page, exc)
                if page < end_page:
                    wait_random_interval()
                render_page_progress(len(completed_pages), page_total)
                continue
            elapsed = time.perf_counter() - started

            fields, rows = parse_form(response.content)
            logger.info("解析第 %d 页: fields=%d rows=%d", page, len(fields), len(rows))

            count = save_page(collection, progress_collection, page, fields, rows, response.url)
            completed_pages.add(page)
            render_page_progress(len(completed_pages), page_total)
            logger.info("第 %d/%d 页完成: 保存 %d 条 (页面耗时 %.2fs)", page, args.page_count, count, elapsed)

            if page < end_page:
                wait_random_interval()

        logger.info("=" * 60)
        logger.info("全部采集完成: 已完成 %d/%d 页, 结果集合=%s", len(completed_pages), page_total, collection_name)
    except Exception:
        logger.exception("采集过程发生异常")
        raise
    finally:
        finish_page_progress()
        mongo.close()
        logger.info("MongoDB 连接已关闭")


if __name__ == "__main__":
    main()
