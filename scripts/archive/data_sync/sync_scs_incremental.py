#!/usr/bin/env python3
"""Archived incremental synchronization for SCS DOA records and product entities.

The command is intentionally cron-friendly: it is single-instance, keeps its
watermark in MongoDB, and only advances that watermark after all required
detail enrichments have succeeded.
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from enrich_scs_doa_sales_orders import (
    RequestPacer,
    enrich_document,
    is_terminal,
    load_sap_sales_orders,
    save_record_status,
)
from pymongo.errors import DuplicateKeyError
from scs_sync_lib import (
    DB_NAME,
    DOA_COLLECTION,
    PROGRESS_COLLECTION,
    create_session,
    ensure_indexes,
    get_mongo,
    iter_incremental_pages,
    migrate_stable_keys,
    resolve_watermark,
    single_instance_lock,
    update_progress,
    upsert_doa_rows,
    utc_now,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="增量同步 SCS DOA 数据和产品实体信息")
    parser.add_argument("--username", default=os.getenv("SCS_USERNAME"))
    parser.add_argument("--password", default=os.getenv("SCS_PASSWORD"))
    parser.add_argument("--start-date", help="历史集合为空时的首次起始日期 YYYY-MM-DD")
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=0,
        help="在水位线前额外回看天数；默认 0（仍包含水位线当天）",
    )
    parser.add_argument("--limit", type=int, help="本次最多补采的详情记录数")
    parser.add_argument("--retry-failed", action="store_true", help="重试历史失败的详情记录")
    parser.add_argument("--timeout", type=float, default=120, help="单次 SCS 请求超时秒数")
    parser.add_argument("--page-size", type=int, default=500)
    parser.add_argument("--max-pages", type=int, default=1000)
    parser.add_argument("--clientstamp", default=str(int(time.time() * 1000)))
    parser.add_argument("--lock-path", help="实例锁路径，默认使用 SCS_INCREMENTAL_LOCK_PATH 或 /tmp")
    parser.add_argument("--migrate-keys", action="store_true", help="运行稳定键迁移并清理旧 hash 重复记录")
    parser.add_argument("--dry-run", action="store_true", help="抓取并报告，但不写入 MongoDB")
    args = parser.parse_args()
    if not args.username or not args.password:
        parser.error("请通过 SCS_USERNAME/SCS_PASSWORD 或命令行提供 SCS 凭据")
    if args.lookback_days < 0:
        parser.error("--lookback-days 不能小于 0")
    if args.limit is not None and args.limit < 1:
        parser.error("--limit 必须大于 0")
    if args.page_size < 1 or args.max_pages < 1:
        parser.error("--page-size 和 --max-pages 必须大于 0")
    return args


def _detail_candidates(collection: Any, keys: set[str], retry_failed: bool) -> list[dict[str, Any]]:
    if not keys and not retry_failed:
        return []
    selectors: list[dict[str, Any]] = []
    if keys:
        selectors.append({"scs_key": {"$in": list(keys)}})
    if retry_failed:
        selectors.append({"scs_enrichment.status": "failed"})
    query: dict[str, Any] = {
        "$or": selectors,
        "data.判定结果": "是",
    }
    documents = list(collection.find(query).sort("_id", 1))
    candidates = []
    for document in documents:
        enrichment = document.get("scs_enrichment") or {}
        if enrichment.get("needs_enrichment"):
            candidates.append(document)
            continue
        if is_terminal(document, retry_failed):
            continue
        candidates.append(document)
    return candidates


def _enrich_candidates(
    collection: Any,
    candidates: list[dict[str, Any]],
    *,
    args: argparse.Namespace,
    sap_orders: set[str],
    session: Any,
) -> dict[str, int]:
    if args.limit is not None and len(candidates) > args.limit:
        raise RuntimeError(
            f"本批需要补采 {len(candidates)} 条，超过 --limit={args.limit}；"
            "为避免水位线跳过未处理记录，本次不会推进水位线"
        )

    if args.dry_run:
        logger.info("dry-run：将补采 %d 条详情，但不执行详情请求写库", len(candidates))
        return {"success": 0, "failed": 0, "skipped": len(candidates)}

    pacer = RequestPacer()
    pacer.mark_completed()
    success = failed = skipped = 0
    for document in candidates:
        data = document.get("data") or {}
        service_order_id = data.get("服务单号_id")
        if not service_order_id:
            skipped += 1
            save_record_status(
                collection,
                document,
                status="skipped",
                error="缺少 服务单号_id，无法请求服务单详情",
                increment_attempt=False,
            )
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
                sap_orders,
                session,
                document,
                args.clientstamp,
                args.timeout,
                pacer,
            )
            collection.update_one(
                {"_id": document["_id"]},
                {"$set": {"scs_enrichment.needs_enrichment": False}},
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
                "详情补采成功 key=%s sales_order=%s material_sn=%s",
                document.get("scs_key"),
                enrichment.get("sales_order"),
                enrichment.get("material_sn"),
            )
        except Exception as exc:  # one bad detail must not hide its status
            failed += 1
            save_record_status(
                collection,
                document,
                status="failed",
                error=f"{type(exc).__name__}: {exc}",
                service_order_id=service_order_id,
                increment_attempt=False,
            )
            logger.exception("详情补采失败 key=%s", document.get("scs_key"))
    return {"success": success, "failed": failed, "skipped": skipped}


def run(args: argparse.Namespace) -> dict[str, Any]:
    with single_instance_lock(args.lock_path):
        mongo = get_mongo()
        try:
            db = mongo[DB_NAME]
            collection = db[DOA_COLLECTION]
            progress_collection = db[PROGRESS_COLLECTION]

            if args.migrate_keys:
                if args.dry_run:
                    logger.info("dry-run：跳过稳定键迁移")
                else:
                    logger.info("开始稳定键迁移")
                    logger.info("稳定键迁移结果: %s", migrate_stable_keys(collection))
            else:
                try:
                    ensure_indexes(collection)
                except DuplicateKeyError as exc:
                    raise RuntimeError(
                        "scs_key 存在重复记录，请先运行 scripts/archive/data_sync/maintenance/migrate_scs_doa_keys.py "
                        "或使用 --migrate-keys"
                    ) from exc

            watermark = resolve_watermark(collection, progress_collection, args.start_date)
            start = watermark - timedelta(days=args.lookback_days)
            end = datetime.now(timezone.utc).date()
            logger.info("增量范围: %s 至 %s，watermark=%s", start, end, watermark)

            if not args.dry_run:
                update_progress(
                    progress_collection,
                    status="running",
                    run_started_at=utc_now(),
                    run_start_date=start.isoformat(),
                    run_end_date=end.isoformat(),
                    last_error=None,
                )

            session = create_session(
                args.username,
                args.password,
                args.clientstamp,
                args.timeout,
            )
            all_keys: set[str] = set()
            accepted_dates: list[str] = []
            pages = rows_count = skipped = 0
            for page, fields, rows, source_url in iter_incremental_pages(
                session,
                start_date=start,
                end_date=end,
                page_size=args.page_size,
                max_pages=args.max_pages,
                clientstamp=args.clientstamp,
                timeout=args.timeout,
            ):
                pages += 1
                result = upsert_doa_rows(
                    collection,
                    rows,
                    fields,
                    source_url,
                    dry_run=args.dry_run,
                )
                all_keys.update(result["keys"])
                accepted_dates.extend(result["accepted_dates"])
                rows_count += len(rows)
                skipped += result["skipped"]
                logger.info(
                    "第 %d 页完成: rows=%d keys=%d changed=%d skipped=%d",
                    page,
                    len(rows),
                    len(result["keys"]),
                    len(result["changed_keys"]),
                    result["skipped"],
                )

            candidates = _detail_candidates(collection, all_keys, args.retry_failed)
            sap_orders = set()
            if not args.dry_run:
                sap_orders = load_sap_sales_orders(db["sales_orders_sap"])
            detail_stats = _enrich_candidates(
                collection,
                candidates,
                args=args,
                sap_orders=sap_orders,
                session=session,
            )
            if detail_stats["failed"]:
                raise RuntimeError(f"详情补采失败 {detail_stats['failed']} 条，水位线保持不变")

            new_watermark = max(accepted_dates, default=None)
            if not args.dry_run:
                values: dict[str, Any] = {
                    "status": "success",
                    "last_success_at": utc_now(),
                    "stats": {
                        "pages": pages,
                        "rows": rows_count,
                        "keys": len(all_keys),
                        "skipped": skipped,
                        "details": detail_stats,
                    },
                }
                if new_watermark:
                    values["watermark_date"] = new_watermark
                update_progress(progress_collection, **values)

            result = {
                "pages": pages,
                "rows": rows_count,
                "keys": len(all_keys),
                "details": detail_stats,
                "watermark": new_watermark or watermark.isoformat(),
            }
            logger.info("SCS 增量同步完成: %s", result)
            return result
        except Exception as exc:
            if not args.dry_run:
                update_progress(
                    progress_collection,
                    status="failed",
                    last_error=f"{type(exc).__name__}: {exc}",
                )
            logger.exception("SCS 增量同步失败，水位线保持不变")
            raise
        finally:
            mongo.close()


def main() -> None:
    run(parse_args())


if __name__ == "__main__":
    main()
