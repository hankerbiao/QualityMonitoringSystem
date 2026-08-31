"""Read-only benchmark for the optimized station pass-rate aggregation.

Run this against a de-identified production-sized database after the field
backfill and index deployment. It prints legacy collection-scan explains and
the new aggregation explain, then executes the aggregation repeatedly.
"""

from __future__ import annotations

import argparse
import statistics
import time
from collections.abc import Mapping
from typing import Any

from pymongo import MongoClient


def station_pass_pipeline(start: str, end: str) -> list[dict[str, Any]]:
    return [
        {
            "$match": {
                "station_pass_date": {"$gte": start, "$lte": end},
                "station_code_norm": {"$nin": [None, ""]},
                "PCODE": {"$nin": [None, ""]},
            }
        },
        {
            "$group": {
                "_id": {"stationCode": "$station_code_norm", "sn": "$PCODE"},
                "stationName": {"$first": "$station_name_norm"},
            }
        },
        {
            "$lookup": {
                "from": "repair_records_sap",
                "let": {"stationCode": "$_id.stationCode", "sn": "$_id.sn"},
                "pipeline": [
                    {
                        "$match": {
                            "ZDATE_WX": {"$gte": start, "$lte": end},
                            "$expr": {
                                "$and": [
                                    {"$eq": ["$repair_station_code_norm", "$$stationCode"]},
                                    {"$eq": ["$PCODE", "$$sn"]},
                                ]
                            },
                        }
                    },
                    {"$limit": 1},
                ],
                "as": "repairs",
            }
        },
        {
            "$project": {
                "stationCode": "$_id.stationCode",
                "stationName": 1,
                "isDefect": {"$gt": [{"$size": "$repairs"}, 0]},
            }
        },
        {
            "$group": {
                "_id": "$stationCode",
                "stationName": {"$first": "$stationName"},
                "inputCount": {"$sum": 1},
                "defectCount": {"$sum": {"$cond": ["$isDefect", 1, 0]}},
            }
        },
        {"$sort": {"_id": 1}},
    ]


def _index_names(plan: Any) -> list[str]:
    if isinstance(plan, Mapping):
        names = [str(plan["indexName"])] if plan.get("indexName") else []
        for value in plan.values():
            names.extend(_index_names(value))
        return sorted(set(names))
    if isinstance(plan, list):
        return sorted({name for value in plan for name in _index_names(value)})
    return []


def execution_summary(explain: Mapping[str, Any]) -> dict[str, Any]:
    stats = explain.get("executionStats", {})
    planner = explain.get("queryPlanner", {})
    return {
        "nReturned": stats.get("nReturned"),
        "totalDocsExamined": stats.get("totalDocsExamined"),
        "totalKeysExamined": stats.get("totalKeysExamined"),
        "executionTimeMillis": stats.get("executionTimeMillis"),
        "indexesUsed": _index_names(planner.get("winningPlan")),
    }


def aggregate_execution_summaries(explain: Any) -> list[dict[str, Any]]:
    """Extract root cursor and nested lookup metrics from aggregate explains."""
    summaries: list[dict[str, Any]] = []

    def visit(value: Any, path: str) -> None:
        if isinstance(value, Mapping):
            if "executionStats" in value and "queryPlanner" in value:
                summaries.append({"path": path, **execution_summary(value)})
            if any(
                key in value for key in ("totalDocsExamined", "totalKeysExamined", "indexesUsed")
            ):
                summaries.append(
                    {
                        "path": path,
                        "nReturned": value.get("nReturned"),
                        "totalDocsExamined": value.get("totalDocsExamined"),
                        "totalKeysExamined": value.get("totalKeysExamined"),
                        "executionTimeMillis": value.get("executionTimeMillisEstimate"),
                        "indexesUsed": value.get("indexesUsed", []),
                    }
                )
            for key, child in value.items():
                visit(child, f"{path}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, f"{path}[{index}]")

    visit(explain, "aggregate")
    return summaries


def explain_find(collection: Any, query: dict[str, Any]) -> dict[str, Any]:
    return collection.database.command(
        "explain", {"find": collection.name, "filter": query}, verbosity="executionStats"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mongo-url", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--date-from", default="20260101")
    parser.add_argument("--date-to", default="20261231")
    parser.add_argument("--iterations", type=int, default=20)
    args = parser.parse_args()
    if args.iterations < 1 or args.date_from > args.date_to:
        parser.error("--iterations must be positive and date range must be ordered")

    client = MongoClient(args.mongo_url, serverSelectionTimeoutMS=5_000)
    db = client[args.database]
    station = db["station_records_sap"]
    repair = db["repair_records_sap"]
    pipeline = station_pass_pipeline(args.date_from, args.date_to)
    legacy_station = explain_find(station, {})
    legacy_repair = explain_find(
        repair, {"ZDATE_WX": {"$gte": args.date_from, "$lte": args.date_to}}
    )
    optimized = db.command(
        "explain",
        {"aggregate": station.name, "pipeline": pipeline, "cursor": {}, "allowDiskUse": True},
        verbosity="executionStats",
    )
    durations = []
    for _ in range(args.iterations):
        started_at = time.perf_counter()
        list(station.aggregate(pipeline, allowDiskUse=True))
        durations.append((time.perf_counter() - started_at) * 1000)
    print(
        {
            "iterations": args.iterations,
            "p50_ms": round(statistics.median(durations), 2),
            "p95_ms": round(sorted(durations)[max(0, int(args.iterations * 0.95) - 1)], 2),
            "legacy_station_find": execution_summary(legacy_station),
            "legacy_repair_find": execution_summary(legacy_repair),
            "optimized_station_pass_rate": aggregate_execution_summaries(optimized),
        }
    )
    client.close()


if __name__ == "__main__":
    main()
