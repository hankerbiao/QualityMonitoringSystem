#!/usr/bin/env python3
"""Unified RTY synchronization entry point.

Examples (from repository root)::

    uv run --project backend python scripts/sync_rty_incremental.py bootstrap --start-date 2026-01-01
    uv run --project backend python scripts/sync_rty_incremental.py run
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from contextlib import contextmanager
from datetime import date
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.db.mongodb import close_mongo_connection, connect_to_mongo  # noqa: E402
from app.services.rty_sync_service import RtySyncService  # noqa: E402


def _date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("日期必须为 YYYY-MM-DD") from exc


def _prodh_list() -> list[str]:
    raw = os.getenv("RTY_SYNC_PRODH_LIST", "00100")
    return [item.strip() for item in raw.split(",") if item.strip()]


@contextmanager
def process_lock(path: str):
    """Acquire a non-blocking Unix process lock for cron overlap protection."""
    import fcntl

    lock_path = Path(path)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("a+")
    try:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError(f"another RTY sync is already running: {lock_path}") from exc
        yield
    finally:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="RTY 销售订单与维修数据统一同步")
    subparsers = parser.add_subparsers(dest="command", required=True)

    bootstrap = subparsers.add_parser("bootstrap", help="从历史起点全量同步销售订单")
    bootstrap.add_argument("--start-date", required=True, type=_date)
    bootstrap.add_argument("--dry-run", action="store_true")
    bootstrap.add_argument("--lookback-days", type=int, default=7)

    run = subparsers.add_parser("run", help="按来源水位线执行每日增量")
    run.add_argument("--dry-run", action="store_true")
    run.add_argument("--only", choices=("sales", "repair"))
    run.add_argument("--lookback-days", type=int, default=7)
    return parser.parse_args()


async def _run(args: argparse.Namespace) -> dict:
    await connect_to_mongo()
    try:
        service = RtySyncService()
        mode = args.command
        return await service.run(
            mode=mode,
            start_date=getattr(args, "start_date", None),
            prodh_list=_prodh_list(),
            lookback_days=args.lookback_days,
            only=getattr(args, "only", None),
            dry_run=args.dry_run,
        )
    finally:
        await close_mongo_connection()


def main() -> int:
    args = parse_args()
    try:
        with process_lock(os.getenv("RTY_SYNC_LOCK_PATH", "/tmp/quality-monitoring-rty-sync.lock")):
            summary = asyncio.run(_run(args))
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False, sort_keys=True))
        return 1
    print(json.dumps(summary, ensure_ascii=False, default=str, sort_keys=True))
    return 0 if summary.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
