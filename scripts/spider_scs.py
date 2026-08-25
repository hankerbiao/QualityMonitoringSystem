#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import random
import re
import sys
import time
from datetime import datetime, timezone

import requests
from lxml import html
from pymongo import MongoClient, UpdateOne

LOGIN_URL = "https://scs.sugon.com/prod/ssocontroller"
RESULT_URL = "https://scs.sugon.com/prod/PM_sp_doa_Result.pml"
FORM_ID = "g8a80e69292b8364e0192bd28d8220c1c"

MONGO_URL = os.getenv("MONGODB_URL", "mongodb://10.17.154.252:27019")
DB_NAME = os.getenv("MONGODB_DB_NAME", "quality_monitoring")
RESULT_COLLECTION = "scs_doa_results"
PROGRESS_COLLECTION = "scs_doa_progress"
REQUEST_INTERVAL_MIN_SECONDS = 5
REQUEST_INTERVAL_MAX_SECONDS = 15

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


def wait_random_interval() -> int:
    """Wait a random integer number of seconds between SCS requests."""
    seconds = random.randint(REQUEST_INTERVAL_MIN_SECONDS, REQUEST_INTERVAL_MAX_SECONDS)
    logger.info("随机等待 %d 秒后发送下一次 SCS 请求", seconds)
    time.sleep(seconds)
    return seconds


def render_page_progress(current: int, total: int) -> None:
    """Render page-level collection progress in the terminal."""
    total = max(total, 1)
    ratio = min(current / total, 1.0)
    width = 28
    filled = int(width * ratio)
    bar = "#" * filled + "-" * (width - filled)
    sys.stdout.write(f"\r页进度 [{bar}] {current}/{total}")
    sys.stdout.flush()


def finish_page_progress() -> None:
    sys.stdout.write("\n")
    sys.stdout.flush()


def now():
    return datetime.now(timezone.utc)


def normalize_accepted_date(value):
    """Normalize the SCS accepted timestamp for indexed date filtering."""
    text = clean(value)
    if not text:
        return None
    try:
        return datetime.strptime(text[:10].replace("/", "-"), "%Y-%m-%d").strftime(
            "%Y-%m-%d"
        )
    except ValueError:
        return None


def clean(value):
    value = (value or "").replace("\xa0", " ")
    return " ".join(value.split())


def control_value(node):
    tag = node.tag.lower()

    if tag == "textarea":
        return clean(node.text_content())

    if tag == "select":
        selected = node.xpath(".//option[@selected]") or node.xpath(".//option")
        return clean(selected[0].text_content()) if selected else ""

    if tag == "input":
        input_type = (node.get("type") or "text").lower()
        if input_type in {"checkbox", "radio"} and node.get("checked") is None:
            return ""
        return clean(node.get("value", ""))

    return clean(node.text_content())


def parse_form(content: bytes):
    # 显式按 UTF-8 解码：lxml 对无编码声明的 bytes 默认按 Latin-1 解析，中文会乱码
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
        value = control_value(node)

        if key in fields:
            fields[key] = f"{fields[key]},{value}"
        else:
            fields[key] = value

    rows = []

    # id 可能位于 <table> 本身，也可能位于包裹 <table> 的容器上，两者都覆盖
    for table in target.xpath(".//table | self::table"):
        table_rows = table.xpath(".//tr")
        if not table_rows:
            continue

        header_nodes = table_rows[0].xpath("./th | ./td")
        # 丢弃空表头：页面存在 display:none 的占位列（无对应数据列），
        # 丢弃后剩余表头与数据列按位置一一对应
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

        # 提取行内链接 href 中的 contextValue（页面内部主键，如服务单号/客户/工程师等，
        # 显示文本只有名称/单号，反查详情需要该 ID）。lxml 会自动解码 &amp; 为 &。
        for i, cell in enumerate(cells):
            uid = None
            for a in cell.xpath(".//a"):
                m = re.search(r"contextValue=([0-9a-fA-F]+)", a.get("href") or "")
                if m:
                    uid = m.group(1)
                    break
            if uid:
                col_name = headers[i] if i < len(headers) else f"column_{i + 1}"
                record[f"{col_name}_id"] = uid

        rows.append(record)

    if not rows and fields:
        rows = [fields.copy()]

    return fields, rows


def query_params(clientstamp, page, page_size, start_date=None, end_date=None):
    """Build SCS DOA query parameters.

    ``declare_time`` and ``declare_time2`` are intentionally optional so the
    original full-sync entry point keeps its existing behaviour.
    """
    return {
        "1": "1",
        "clientstamp": clientstamp,
        "doa_code": "",
        "service_uid": "",
        "customer_uid": "",
        "sugon_sn_multi": "",
        "contract": "",
        "declare_time": start_date or "",
        "declare_time2": end_date or "",
        "detail_problem": "",
        "problem_conclusion": "",
        "pageNo": page,
        "pageSize": page_size,
        "target": "PM_sp_doa_Result",
    }


def login(session, username, password, clientstamp, timeout):
    logger.info("开始登录: user=%s url=%s", username, LOGIN_URL)
    payload = {
        "name": username,
        "password": password,
        "randcode": "",
        "contextServiceName": "do_org_user_findbynameandpwd_sugon",
        "mobileclient": "false",
        "clientstamp": clientstamp,
    }

    started = time.perf_counter()
    response = session.post(LOGIN_URL, data=payload, timeout=timeout)
    elapsed = time.perf_counter() - started
    response.raise_for_status()
    logger.info(
        "登录成功: status=%d elapsed=%.2fs cookies=%d",
        response.status_code,
        elapsed,
        len(session.cookies),
    )


def save_page(collection, progress_collection, page, fields, rows, source_url):
    timestamp = now()
    operations = []

    for row_index, row in enumerate(rows):
        canonical = json.dumps(
            row,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        record_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

        operations.append(
            UpdateOne(
                {"record_hash": record_hash},
                {
                    "$set": {
                        "page": page,
                        "row_index": row_index,
                        "fields": fields,
                        "data": row,
                        "scs_enrichment.accepted_date": normalize_accepted_date(
                            row.get("受理时间")
                        ),
                        "source_url": source_url,
                        "updated_at": timestamp,
                    },
                    "$setOnInsert": {
                        "record_hash": record_hash,
                        "created_at": timestamp,
                    },
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
    # 空页不标记完成：可能是解析异常或临时网络问题，留到下次重跑
    if not rows:
        logger.warning("第 %d 页未解析到任何行，未标记完成，下次重跑会重试", page)
        return 0

    progress_collection.update_one(
        {"_id": "PM_sp_doa_Result"},
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


def fetch_page(
    session,
    page,
    page_size,
    clientstamp,
    timeout,
    retries=3,
    start_date=None,
    end_date=None,
):
    """拉取单页，失败自动重试 retries 次，全部失败则抛出最后一次异常。

    每页约 1.8MB、正常耗时 20s+，网络偶发抖动很容易打满 30s 超时，
    因此读取超时放宽到 timeout 秒，并带重试；连续失败才上抛，由调用方决定跳过。
    """
    last_exc = None
    for attempt in range(1, retries + 1):
        started = time.perf_counter()
        try:
            resp = session.get(
                RESULT_URL,
                params=query_params(
                    clientstamp,
                    page,
                    page_size,
                    start_date=start_date,
                    end_date=end_date,
                ),
                timeout=(15.0, timeout),  # (connect, read)
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", default=os.getenv("SCS_USERNAME", "fengyb1"))
    parser.add_argument("--password", default=os.getenv("SCS_PASSWORD", "666666"))
    parser.add_argument("--page-count", type=int, default=15)
    parser.add_argument("--page-size", type=int, default=500)
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--clientstamp", default=str(int(time.time() * 1000)))
    parser.add_argument("--collection", default=RESULT_COLLECTION)
    args = parser.parse_args()

    password = args.password
    collection_name = args.collection
    progress_name = f"{collection_name}_progress"

    logger.info("=" * 60)
    logger.info("SCS DOA 数据爬虫启动")
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
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0",
            "Referer": "http://scs.sugon.com/",
            "Origin": "http://scs.sugon.com",
        }
    )

    login(
        session,
        args.username,
        password,
        args.clientstamp,
        args.timeout,
    )

    mongo = MongoClient(
        MONGO_URL,
        serverSelectionTimeoutMS=int(args.timeout * 1000),
    )
    db = mongo[DB_NAME]

    collection = db[collection_name]
    progress_collection = db[progress_name]

    collection.create_index("record_hash", unique=True)
    logger.info("MongoDB 连接成功，record_hash 唯一索引已就绪")

    progress = progress_collection.find_one({"_id": "PM_sp_doa_Result"}) or {}
    completed_pages = set(progress.get("completed_pages", []))
    render_page_progress(len(completed_pages), args.page_count)
    logger.info(
        "进度恢复: 已完成 %d/%d 页, last_page=%s last_count=%s",
        len(completed_pages),
        args.page_count,
        progress.get("last_page"),
        progress.get("last_count"),
    )

    try:
        for page in range(1, args.page_count + 1):
            if page in completed_pages:
                logger.info("第 %d 页已采集，跳过", page)
                render_page_progress(len(completed_pages), args.page_count)
                continue

            logger.info(
                "请求第 %d/%d 页 (pageSize=%d): %s",
                page,
                args.page_count,
                args.page_size,
                RESULT_URL,
            )
            started = time.perf_counter()
            try:
                response = fetch_page(
                    session,
                    page,
                    args.page_size,
                    args.clientstamp,
                    args.timeout,
                )
            except Exception as exc:
                logger.error(
                    "第 %d 页连续失败，跳过该页（不标记完成，可后续补采）: %s",
                    page,
                    exc,
                )
                if len(completed_pages) < args.page_count - 1:
                    wait_random_interval()
                render_page_progress(len(completed_pages), args.page_count)
                continue
            elapsed = time.perf_counter() - started

            fields, rows = parse_form(response.content)
            logger.info(
                "解析第 %d 页: fields=%d rows=%d",
                page,
                len(fields),
                len(rows),
            )

            count = save_page(
                collection,
                progress_collection,
                page,
                fields,
                rows,
                response.url,
            )

            completed_pages.add(page)
            render_page_progress(len(completed_pages), args.page_count)
            logger.info(
                "第 %d/%d 页完成: 保存 %d 条 (页面耗时 %.2fs)",
                page,
                args.page_count,
                count,
                elapsed,
            )

            if len(completed_pages) < args.page_count:
                wait_random_interval()

        logger.info("=" * 60)
        logger.info(
            "全部采集完成: 已完成 %d/%d 页, 结果集合=%s",
            len(completed_pages),
            args.page_count,
            collection_name,
        )

    except Exception:
        logger.exception("采集过程发生异常")
        raise
    finally:
        finish_page_progress()
        mongo.close()
        logger.info("MongoDB 连接已关闭")


if __name__ == "__main__":
    main()
