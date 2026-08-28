#!/usr/bin/env python3
"""Export distinct station code and station name pairs to an Excel file.

Run from the repository root with the temporary Excel dependency:

    uv run --project backend --with openpyxl python scripts/export_station_records.py

The script is read-only. It reads MongoDB settings from ``backend/.env`` and
writes ``工位编码_工位名称_去重.xlsx`` to the repository root.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from pymongo import MongoClient


PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
OUTPUT_FILE = PROJECT_ROOT / "工位编码_工位名称_去重.xlsx"
MAX_DATA_ROWS_PER_SHEET = 1_048_575
sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import get_settings  # noqa: E402


def load_distinct_rows(collection: Any) -> Any:
    pipeline = [
        {
            "$match": {
                "SPEC": {"$nin": [None, ""]},
                "SPEC_DESC": {"$nin": [None, ""]},
            }
        },
        {
            "$group": {
                "_id": {
                    "station_code": "$SPEC",
                    "station_name": "$SPEC_DESC",
                }
            }
        },
        {
            "$project": {
                "_id": 0,
                "station_code": "$_id.station_code",
                "station_name": "$_id.station_name",
            }
        },
        {"$sort": {"station_code": 1, "station_name": 1}},
    ]
    return collection.aggregate(pipeline, allowDiskUse=True)


def write_excel(rows: Any) -> tuple[int, int]:
    try:
        from openpyxl import Workbook
    except ImportError as exc:
        raise RuntimeError(
            "缺少 openpyxl，请使用命令：uv run --project backend --with openpyxl "
            "python scripts/export_station_records.py"
        ) from exc

    workbook = Workbook(write_only=True)
    worksheet = None
    rows_in_sheet = MAX_DATA_ROWS_PER_SHEET
    sheet_number = 0
    row_count = 0

    def new_sheet():
        nonlocal rows_in_sheet, sheet_number, worksheet
        sheet_number += 1
        rows_in_sheet = 0
        worksheet = workbook.create_sheet(f"工位编码工位名称_{sheet_number}")
        worksheet.freeze_panes = "A2"
        worksheet.append(["工位编码", "工位名称"])

    for row in rows:
        if rows_in_sheet >= MAX_DATA_ROWS_PER_SHEET:
            new_sheet()
        if worksheet is None:
            new_sheet()
        worksheet.append([row["station_code"], row["station_name"]])
        rows_in_sheet += 1
        row_count += 1

    temporary_file = OUTPUT_FILE.with_suffix(".tmp.xlsx")
    workbook.save(temporary_file)
    temporary_file.replace(OUTPUT_FILE)
    return row_count, sheet_number


def main() -> None:
    os.chdir(BACKEND_DIR)
    settings = get_settings()
    client = MongoClient(settings.MONGODB_URL, serverSelectionTimeoutMS=10_000)
    try:
        client.admin.command("ping")
        rows = load_distinct_rows(client[settings.MONGODB_DB_NAME]["station_records_sap"])
        row_count, sheet_count = write_excel(rows)
        print(f"已导出 {row_count} 条工位编码和工位名称去重记录，共 {sheet_count} 个工作表：{OUTPUT_FILE}")
    finally:
        client.close()


if __name__ == "__main__":
    main()
