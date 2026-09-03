"""Compatibility entry point for the archived repair-customer utility."""

from pathlib import Path
import runpy


_TARGET = Path(__file__).resolve().parents[2] / "scripts/archive/data_sync/maintenance/backfill_repair_customers.py"
globals().update(runpy.run_path(str(_TARGET), run_name="_archived_backfill_repair_customers"))
