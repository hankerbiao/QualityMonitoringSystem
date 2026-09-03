"""Compatibility entry point for the archived BOM cleanup utility."""

from pathlib import Path
import runpy


_TARGET = Path(__file__).resolve().parents[2] / "scripts/archive/data_sync/maintenance/clean_order_bom_by_sales_orders.py"
globals().update(runpy.run_path(str(_TARGET), run_name="_archived_clean_order_bom"))
