"""Compatibility entry point for the archived repair-order backfill utility."""

from pathlib import Path
import runpy


_TARGET = Path(__file__).resolve().parents[2] / "scripts/archive/data_sync/maintenance/backfill_repair_orders.py"
globals().update(runpy.run_path(str(_TARGET), run_name="_archived_backfill_repair_orders"))
