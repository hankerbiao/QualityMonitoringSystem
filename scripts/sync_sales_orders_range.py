"""
按日期范围同步销售订单 → 集合 sales_orders_sap（进程内直连，不经 HTTP）

====================================================================
用法（在 backend 目录执行）：
  cd backend

  # 同步 2026 年上半年（默认）
  uv run python ../scripts/sync_sales_orders_range.py

  # 自定义范围 / 产品层次
  uv run python ../scripts/sync_sales_orders_range.py --start 2026-01-01 --end 2026-03-31
  uv run python ../scripts/sync_sales_orders_range.py --prodh-list 00100 00200
  # 默认已带 PRODH_LIST=["00100"] 过滤；如需全量拉取，用 --prodh-list 后不加参数

复用 SapSalesOrderService.fetch_all + repository 的聚合/upsert，
与 POST /api/sales-orders/sync 相同逻辑，但进程内执行、无需后端服务。
====================================================================
"""
import argparse
import asyncio
import sys
from datetime import date, datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.db.mongodb import close_mongo_connection, connect_to_mongo  # noqa: E402
from app.repositories import sales_order_repository as repo  # noqa: E402
from app.services.sap_sales_order_service import SapSalesOrderService  # noqa: E402


def parse_args():
    p = argparse.ArgumentParser(description="按日期范围同步销售订单到 sales_orders_sap")
    p.add_argument("--start", default="2026-01-01", help="开始日期 YYYY-MM-DD（默认 2026-01-01）")
    p.add_argument("--end", default="2026-06-30", help="结束日期 YYYY-MM-DD（默认 2026-06-30）")
    p.add_argument("--prodh-list", nargs="*", default=["00100"], help="产品层次过滤 PRODH_LIST（默认 [\"00100\"]；传 --prodh-list 不加参数可全量）")
    return p.parse_args()


async def run(start: date, end: date, prodh_list: list[str] | None) -> None:
    service = SapSalesOrderService()
    results = await service.fetch_all(start, end, prodh_list)

    for src, r in results.items():
        print(f"[{src}] success={r.success} error={r.error} records={len(r.records)}", flush=True)

    successful = [s for s in results if results[s].success]
    if not successful:
        print("两来源均失败，未写库。", flush=True)
        return

    now = datetime.now(timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    aufnr_sources, source_records, per_source = repo.aggregate_source_results(results, now_iso)
    inserted, updated = await repo.upsert_sales_orders(aufnr_sources, source_records, now_iso)
    total_fetched = sum(s.fetched_count for s in per_source.values())
    print(
        f"完成: fetched={total_fetched} unique_aufnr={len(aufnr_sources)} "
        f"inserted={inserted} updated={updated}",
        flush=True,
    )


async def main():
    args = parse_args()
    await connect_to_mongo()
    try:
        await run(
            date.fromisoformat(args.start),
            date.fromisoformat(args.end),
            args.prodh_list,
        )
    finally:
        await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(main())
