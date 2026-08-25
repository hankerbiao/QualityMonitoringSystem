"""Read-only RTY MongoDB benchmark and explain report.

Run against a de-identified, production-sized database. This script never writes
documents or indexes; index creation remains an application deployment concern.
"""

from __future__ import annotations

import argparse
import statistics
import time

from pymongo import MongoClient

YEAR_START = "20260101"
YEAR_END = "20261231"


def _match(**extra: str) -> dict:
    return {
        "GSTRS": {"$gte": YEAR_START, "$lte": YEAR_END},
        "PCODE": {"$nin": [None, ""]},
        **extra,
    }


def _group_pipeline(match: dict, group_field: str, limit: int) -> list[dict]:
    return [
        {"$match": match},
        {"$group": {"_id": f"${group_field}"}},
        {"$match": {"_id": {"$nin": [None, ""]}}},
        {
            "$facet": {
                "metadata": [{"$count": "total"}],
                "data": [{"$sort": {"_id": 1}}, {"$limit": limit}],
            }
        },
    ]


def _execution_summary(explain: dict) -> dict:
    stats = explain.get("executionStats", {})
    return {
        "stage": stats.get("executionStages", {}).get("stage"),
        "nReturned": stats.get("nReturned"),
        "totalDocsExamined": stats.get("totalDocsExamined"),
        "totalKeysExamined": stats.get("totalKeysExamined"),
        "executionTimeMillis": stats.get("executionTimeMillis"),
    }


def _run_case(collection, name: str, pipeline: list[dict], iterations: int) -> None:
    explain = collection.database.command(
        "explain",
        {"aggregate": collection.name, "pipeline": pipeline, "cursor": {}},
        verbosity="executionStats",
    )
    durations = []
    for _ in range(iterations):
        started = time.perf_counter()
        list(collection.aggregate(pipeline, allowDiskUse=True))
        durations.append((time.perf_counter() - started) * 1000)
    print(
        {
            "case": name,
            "p50_ms": round(statistics.median(durations), 2),
            "p95_ms": round(sorted(durations)[max(0, int(iterations * 0.95) - 1)], 2),
            "explain": _execution_summary(explain),
        }
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mongo-url", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--iterations", type=int, default=20)
    parser.add_argument("--limit", type=int, default=50)
    args = parser.parse_args()
    if args.iterations < 1 or args.limit < 1:
        parser.error("--iterations and --limit must be positive")

    client = MongoClient(args.mongo_url, serverSelectionTimeoutMS=5000)
    db = client[args.database]
    station = db["station_records_sap"]
    repair = db["repair_records_sap"]
    cases = [
        ("default", _group_pipeline(_match(), "KDAUF", args.limit)),
        (
            "sales_order",
            _group_pipeline(_match(KDAUF="SO-REPLACE-ME"), "KDAUF", args.limit),
        ),
        (
            "production_order",
            _group_pipeline(_match(AUFNR="PO-REPLACE-ME"), "AUFNR", args.limit),
        ),
        ("base", _group_pipeline(_match(LGORT="BASE-REPLACE-ME"), "LGORT", args.limit)),
        (
            "product_model",
            _group_pipeline(
                _match(MAKTX_TH="MODEL-REPLACE-ME"), "MAKTX_TH", args.limit
            ),
        ),
        (
            "serial_number",
            _group_pipeline(_match(PCODE="SN-REPLACE-ME"), "PCODE", args.limit),
        ),
    ]
    for name, pipeline in cases:
        _run_case(station, name, pipeline, args.iterations)
    _run_case(
        repair,
        "repair_details",
        [
            {
                "$match": {
                    "PCODE": {"$in": ["SN-REPLACE-ME"]},
                    "ZDATE_WX": {"$gte": YEAR_START, "$lte": YEAR_END},
                }
            },
            {"$sort": {"ZDATE_WX": -1}},
            {"$limit": 50_001},
        ],
        args.iterations,
    )
    client.close()


if __name__ == "__main__":
    main()
