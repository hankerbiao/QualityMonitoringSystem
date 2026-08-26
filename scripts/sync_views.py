#!/usr/bin/env python3
"""Synchronize the four SAP HANA quality views into this project's MongoDB.

Run from the repository root::

    uv run --project backend python -m scripts.sync_views --mode incremental \
      --include-undated --view ZSGV_ZSD124 --view ZSGV_ZPP_SERNOLIST \
      --view ZSGV_ZZT_WLJL --view Z_V_ZMES_T_001

The script is self-contained and reads HANA and MongoDB settings from
``backend/.env``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterator, Mapping, Sequence
from uuid import uuid4


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENV_FILE = PROJECT_ROOT / "backend" / ".env"
CHECKPOINTS_COLLECTION = "_hana_sync_checkpoints"
RUNS_COLLECTION = "_hana_sync_runs"
logger = logging.getLogger("hana_mongodb_sync")


class ConfigurationError(RuntimeError):
    """Raised when required HANA or MongoDB settings are unavailable."""


class SyncError(RuntimeError):
    """Raised when a view cannot be synchronized safely."""


@dataclass(frozen=True)
class HanaSettings:
    address: str
    port: int
    user: str
    password: str
    connection_timeout: int

    @classmethod
    def from_env(cls) -> "HanaSettings":
        required = {
            "HANA_ADDRESS": os.getenv("HANA_ADDRESS"),
            "HANA_USER": os.getenv("HANA_USER"),
            "HANA_PASSWORD": os.getenv("HANA_PASSWORD"),
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise ConfigurationError(
                "Missing required environment variables: " + ", ".join(missing)
            )
        try:
            port = int(os.getenv("HANA_PORT", "30015"))
            timeout = int(os.getenv("HANA_CONNECT_TIMEOUT", "120"))
        except ValueError as exc:
            raise ConfigurationError(
                "HANA_PORT and HANA_CONNECT_TIMEOUT must be integers"
            ) from exc
        if port < 1 or timeout < 1:
            raise ConfigurationError(
                "HANA_PORT and HANA_CONNECT_TIMEOUT must be greater than zero"
            )
        return cls(
            address=required["HANA_ADDRESS"],
            port=port,
            user=required["HANA_USER"],
            password=required["HANA_PASSWORD"],
            connection_timeout=timeout,
        )

    def connector_kwargs(self) -> dict[str, object]:
        return {
            "address": self.address,
            "port": self.port,
            "user": self.user,
            "password": self.password,
            "communicationTimeout": self.connection_timeout * 1000,
        }


@dataclass(frozen=True)
class MongoSettings:
    uri: str
    database: str
    server_selection_timeout_ms: int

    @classmethod
    def from_env(cls) -> "MongoSettings":
        uri = os.getenv("MONGODB_URL")
        if not uri:
            raise ConfigurationError("Missing MONGODB_URL")
        database = os.getenv("MONGODB_DB_NAME", "quality_monitoring")
        try:
            timeout = int(os.getenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", "10000"))
        except ValueError as exc:
            raise ConfigurationError(
                "MONGODB_SERVER_SELECTION_TIMEOUT_MS must be an integer"
            ) from exc
        if timeout < 1:
            raise ConfigurationError(
                "MONGODB_SERVER_SELECTION_TIMEOUT_MS must be greater than zero"
            )
        return cls(uri=uri, database=database, server_selection_timeout_ms=timeout)


@dataclass(frozen=True)
class ViewSpec:
    view_id: str
    qualified_name: str
    columns: tuple[str, ...]
    collection: str
    key_fields: tuple[str, ...]
    order_by: tuple[str, ...]
    watermark_fields: tuple[str, ...] = ()
    index_fields: tuple[str, ...] = ()
    start_date_field: str | None = None
    fallback_to_full_row: bool = False


def _fields(values: str) -> tuple[str, ...]:
    return tuple(values.split())


VIEW_SPECS: dict[str, ViewSpec] = {
    "ZSGV_ZSD124": ViewSpec(
        view_id="ZSGV_ZSD124",
        qualified_name='"_SYS_BIC"."BW_LOCAL.BI/ZSGV_ZSD124_BI"',
        columns=_fields(
            "MANDT WERKS MATNR BWART BUDAT_MKPF LGORT MENGE_A KUNNR_A MAKTX NAME1_A "
            "TYPE VGBEL_A VGPOS_A MATNR_SC MATKX_SC2 AUFNR_1 POSNR_EX VBELN_EX KUNNR_EX "
            "NAME1_EX AUART KUNNR_1 NAME1_X MAKTX_CP MATNR_CP PSMNG MATKL CXFLG WGBEZ CPX "
            "BU MATNR_BI ZSTAT MBLNR MJAHR ZEILE FDATU_O DATE_JH_O ETENR_O MAT_KDAUF "
            "MAT_KDPOS VGBEL VGPOS KUNNR NAME1 MENGE USNAM_MKPF VSNMR_V ZNAM"
        ),
        collection="order_bom_postings_sap",
        key_fields=("MANDT", "MBLNR", "MJAHR", "ZEILE"),
        order_by=("MBLNR", "MJAHR", "ZEILE", "WERKS", "MATNR"),
        watermark_fields=("FDATU_O",),
        index_fields=("AUFNR_1", "VBELN_EX", "MATNR", "FDATU_O"),
        start_date_field="FDATU_O",
    ),
    "ZSGV_ZPP_SERNOLIST": ViewSpec(
        view_id="ZSGV_ZPP_SERNOLIST",
        qualified_name='"_SYS_BIC"."BW_LOCAL.PP/ZSGV_ZPP_SERNOLIST"',
        columns=_fields("ZCODE_HEAD ZCODE_ITEM AUFNR_HEAD AUFNR_ITEM PRODH"),
        collection="serial_bindings_sap",
        key_fields=("ZCODE_HEAD", "ZCODE_ITEM", "AUFNR_HEAD", "AUFNR_ITEM", "PRODH"),
        order_by=("ZCODE_HEAD", "ZCODE_ITEM", "AUFNR_HEAD", "AUFNR_ITEM"),
        index_fields=("ZCODE_HEAD", "ZCODE_ITEM", "AUFNR_HEAD", "AUFNR_ITEM"),
        fallback_to_full_row=True,
    ),
    "ZSGV_ZZT_WLJL": ViewSpec(
        view_id="ZSGV_ZZT_WLJL",
        qualified_name='"_SYS_BIC"."BW_LOCAL.PP/ZSGV_ZZT_WLJL"',
        columns=_fields(
            "MANDT PCODE ZWXDT ZMCOD1 ZRCOD1 MATNR ZJXMC ZNGGZ ZNGWD ZWXWD ZBJ ZZRFL ZCCLH "
            "ZGZMS MAKTX ZMCOD2 ZRCOD2 ZDATE ZTIME ZUSER ZSOURCE ZDATE_WX REJUDGE RET RPDESC "
            "RNOTE SECFLG FACTORY ZWXWD1 ZWXWD2 ZWXWD3 U_FIX FIX_REMARKS TESTID ZNGSPEC T_FIND "
            "ZNGWD1 ZNGWD2 ZNGWD3 ERROR_CODE ERROR_MSG RETEST_STATION TEST_LOG_NAME SECOND_PART_NO "
            "RECORD01REPAIRM SLOT AUFNR VBELN POSNR U_FIND U_RMA_NAME RMA_RESULT RMA_TYPE2"
        ),
        collection="repair_records_sap",
        key_fields=("MANDT", "PCODE", "ZMCOD1", "ZDATE_WX", "ZTIME"),
        order_by=("PCODE", "ZWXDT", "ZMCOD1", "ZDATE_WX", "ZTIME"),
        watermark_fields=("ZDATE", "ZTIME"),
        index_fields=("PCODE", "ZDATE_WX", "AUFNR", "FACTORY"),
        start_date_field="ZDATE",
        fallback_to_full_row=True,
    ),
    "Z_V_ZMES_T_001": ViewSpec(
        view_id="Z_V_ZMES_T_001",
        qualified_name='"_SYS_BIC"."BW_LOCAL.ZTRRI/Z_V_ZMES_T_001"',
        columns=_fields(
            "MANDT HISTROYID PCODE OCODE AUFNR KDAUF KDPOS LGORT MAKTX_TH LEAD_CYCLE AUFNR_CYCLE "
            "CUSTOMIZE_CYCLE OEMBZ SPEC OPERATION SPEC_DESC UNAME LASTSPEC_TIME SPEC_TIME GSTRS "
            "PLAN_END_TIME ACTUAL_START_TIME ACTUAL_END_TIME HADE1 HADE2 HADE3 HADE4 HADE5 HADE6 "
            "HADE7 HADE8 STATU MESS"
        ),
        collection="station_records_sap",
        key_fields=("HISTROYID", "SPEC", "SPEC_TIME", "PCODE", "OCODE"),
        order_by=("HISTROYID", "SPEC_TIME", "PCODE", "SPEC"),
        watermark_fields=("ACTUAL_START_TIME",),
        index_fields=("PCODE", "ACTUAL_START_TIME", "AUFNR", "SPEC"),
        start_date_field="ACTUAL_START_TIME",
        fallback_to_full_row=True,
    ),
}


@dataclass
class SyncStats:
    view_id: str
    collection: str
    mode: str
    run_id: str
    source_rows: int = 0
    batches: int = 0
    upserted: int = 0
    matched: int = 0
    modified: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "view_id": self.view_id,
            "collection": self.collection,
            "mode": self.mode,
            "run_id": self.run_id,
            "source_rows": self.source_rows,
            "batches": self.batches,
            "upserted": self.upserted,
            "matched": self.matched,
            "modified": self.modified,
        }


def _parse_env_value(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def load_env_file(path: Path) -> None:
    """Load simple KEY=VALUE entries without overwriting exported variables."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        if separator and key.strip():
            os.environ.setdefault(key.strip(), _parse_env_value(value))


def normalize_start_date(value: str) -> str:
    normalized = value.strip().replace("-", "")
    try:
        return datetime.strptime(normalized, "%Y%m%d").strftime("%Y%m%d")
    except ValueError as exc:
        raise ConfigurationError(
            "SYNC_START_DATE must use YYYY-MM-DD or YYYYMMDD"
        ) from exc


def normalize_key_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return format(value, "f")
    value = str(value).strip()
    return value or None


def full_row_source_key(row: Mapping[str, Any]) -> str:
    payload = json.dumps(
        [(field, normalize_key_value(value)) for field, value in row.items()],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return "full_row:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_source_key(row: Mapping[str, Any], spec: ViewSpec) -> str:
    values: list[str] = []
    missing: list[str] = []
    for field in spec.key_fields:
        value = normalize_key_value(row.get(field))
        if value is None:
            missing.append(field)
        else:
            values.append(value)
    if missing:
        if spec.fallback_to_full_row:
            return full_row_source_key(row)
        raise SyncError(
            f"{spec.view_id} row is missing key field(s): {', '.join(missing)}"
        )
    return json.dumps(values, ensure_ascii=False, separators=(",", ":"))


def to_bson_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        from bson.decimal128 import Decimal128

        return Decimal128(str(value))
    if isinstance(value, date) and not isinstance(value, datetime):
        return datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    if isinstance(value, Mapping):
        return {str(key): to_bson_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_bson_value(item) for item in value]
    return value


def date_overlap(value: Any) -> Any:
    normalized = normalize_key_value(value)
    if normalized and len(normalized) == 8 and normalized.isdigit():
        try:
            return (
                datetime.strptime(normalized, "%Y%m%d") - timedelta(days=1)
            ).strftime("%Y%m%d")
        except ValueError:
            pass
    return value


def max_watermark(
    spec: ViewSpec, current: Any | None, row: Mapping[str, Any]
) -> Any | None:
    if not spec.watermark_fields:
        return current
    if len(spec.watermark_fields) == 2:
        values = tuple(
            normalize_key_value(row.get(field)) for field in spec.watermark_fields
        )
        if any(value is None for value in values):
            return current
        candidate = dict(zip(spec.watermark_fields, values))
        current_values = (
            tuple(str(current.get(field, "")) for field in spec.watermark_fields)
            if isinstance(current, Mapping)
            else None
        )
        return (
            candidate if current_values is None or values > current_values else current
        )
    value = row.get(spec.watermark_fields[0])
    if value is None:
        return current
    return (
        value
        if current is None or normalize_key_value(value) > normalize_key_value(current)
        else current
    )


@contextmanager
def hana_connection(settings: HanaSettings) -> Iterator[Any]:
    try:
        from hdbcli import dbapi
    except ImportError as exc:
        raise ConfigurationError(
            "hdbcli is required; run: uv sync --project backend"
        ) from exc
    connection = dbapi.connect(**settings.connector_kwargs())
    try:
        yield connection
    finally:
        connection.close()


def build_query(
    spec: ViewSpec,
    *,
    mode: str,
    checkpoint: Mapping[str, Any] | None,
    start_date: str | None,
) -> tuple[str, list[Any]]:
    conditions: list[str] = []
    params: list[Any] = []
    watermark = checkpoint.get("watermark") if checkpoint else None
    if mode == "incremental" and watermark is not None:
        if spec.watermark_fields == ("ZDATE", "ZTIME"):
            if not isinstance(watermark, Mapping):
                raise SyncError(f"Invalid checkpoint watermark for {spec.view_id}")
            source_date, source_time = watermark.get("ZDATE"), watermark.get("ZTIME")
            if source_date is None or source_time is None:
                raise SyncError(f"Invalid checkpoint watermark for {spec.view_id}")
            conditions.append('("ZDATE" > ? OR ("ZDATE" = ? AND "ZTIME" >= ?))')
            params.extend((source_date, source_date, source_time))
        elif spec.watermark_fields:
            field = spec.watermark_fields[0]
            conditions.append(f'"{field}" >= ?')
            params.append(
                date_overlap(watermark)
                if field not in {"SPEC_TIME", "ACTUAL_START_TIME"}
                else watermark
            )
    if start_date and spec.start_date_field:
        value = start_date
        if spec.start_date_field in {"SPEC_TIME", "ACTUAL_START_TIME"}:
            value = f"{start_date[:4]}-{start_date[4:6]}-{start_date[6:]} 00:00:00"
        conditions.append(f'"{spec.start_date_field}" >= ?')
        params.append(value)
    selected = ", ".join(f'"{field}"' for field in spec.columns)
    order_by = ", ".join(f'"{field}"' for field in spec.order_by)
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    return (
        f"SELECT {selected} FROM {spec.qualified_name}{where} ORDER BY {order_by}",
        params,
    )


def ensure_indexes(database: Any, spec: ViewSpec) -> None:
    database[CHECKPOINTS_COLLECTION].create_index(
        "view_id", unique=True, name="view_id_unique"
    )
    database[RUNS_COLLECTION].create_index(
        [("view_id", 1), ("started_at", -1)], name="view_started_at"
    )
    collection = database[spec.collection]
    collection.create_index("_source_key", unique=True, name="source_key_unique")
    for field in spec.index_fields:
        collection.create_index(field, name=f"source_{field.lower()}")


def sync_view(
    spec: ViewSpec,
    hana_settings: HanaSettings,
    database: Any | None,
    *,
    mode: str,
    batch_size: int,
    start_date: str | None,
    dry_run: bool,
) -> SyncStats:
    run_id = uuid4().hex
    stats = SyncStats(spec.view_id, spec.collection, mode, run_id)
    checkpoint = (
        None
        if dry_run or mode == "full"
        else database[CHECKPOINTS_COLLECTION].find_one({"_id": spec.view_id})
    )
    sql, params = build_query(
        spec, mode=mode, checkpoint=checkpoint, start_date=start_date
    )
    logger.info("syncing %s into %s", spec.view_id, spec.collection)
    if not dry_run:
        ensure_indexes(database, spec)
        database[RUNS_COLLECTION].insert_one(
            {
                "_id": f"{run_id}:{spec.view_id}",
                "run_id": run_id,
                "view_id": spec.view_id,
                "collection": spec.collection,
                "mode": mode,
                "status": "running",
                "started_at": datetime.now(timezone.utc),
            }
        )
    collection = database[spec.collection] if database is not None else None
    seen_keys: set[str] = set()
    watermark: Any | None = None
    try:
        with hana_connection(hana_settings) as connection:
            cursor = connection.cursor()
            try:
                cursor.execute(sql, tuple(params))
                while rows := cursor.fetchmany(batch_size):
                    operations = []
                    for values in rows:
                        row = dict(zip(spec.columns, values))
                        key = build_source_key(row, spec)
                        fallback_key = (
                            full_row_source_key(row)
                            if spec.fallback_to_full_row
                            else None
                        )
                        if fallback_key and fallback_key in seen_keys:
                            continue
                        if key in seen_keys:
                            if fallback_key:
                                key = fallback_key
                            else:
                                raise SyncError(
                                    f"Duplicate business key in {spec.view_id}: {key}"
                                )
                        seen_keys.add(key)
                        if fallback_key:
                            seen_keys.add(fallback_key)
                        watermark = max_watermark(spec, watermark, row)
                        stats.source_rows += 1
                        if not dry_run:
                            from pymongo import UpdateOne

                            document = {
                                field: to_bson_value(value)
                                for field, value in row.items()
                            }
                            document.update(
                                {
                                    "_source_view": spec.view_id,
                                    "_source_key": key,
                                    "_sync_run_id": run_id,
                                    "_synced_at": datetime.now(timezone.utc),
                                }
                            )
                            operations.append(
                                UpdateOne(
                                    {"_source_key": key},
                                    {
                                        "$set": document,
                                        "$setOnInsert": {
                                            "_id": hashlib.sha256(
                                                key.encode("utf-8")
                                            ).hexdigest()
                                        },
                                    },
                                    upsert=True,
                                )
                            )
                    if operations:
                        result = collection.bulk_write(operations, ordered=False)
                        stats.upserted += result.upserted_count
                        stats.matched += result.matched_count
                        stats.modified += result.modified_count
                    stats.batches += 1
            finally:
                cursor.close()
        if not dry_run:
            now = datetime.now(timezone.utc)
            database[CHECKPOINTS_COLLECTION].update_one(
                {"_id": spec.view_id},
                {
                    "$set": {
                        "view_id": spec.view_id,
                        "collection": spec.collection,
                        "mode": mode,
                        "watermark": to_bson_value(watermark),
                        "source_rows": stats.source_rows,
                        "run_id": run_id,
                        "updated_at": now,
                    }
                },
                upsert=True,
            )
            database[RUNS_COLLECTION].update_one(
                {"_id": f"{run_id}:{spec.view_id}"},
                {
                    "$set": {
                        "status": "success",
                        "finished_at": now,
                        "watermark": to_bson_value(watermark),
                        "stats": stats.as_dict(),
                    }
                },
            )
        return stats
    except Exception as exc:
        if not dry_run:
            database[RUNS_COLLECTION].update_one(
                {"_id": f"{run_id}:{spec.view_id}"},
                {
                    "$set": {
                        "status": "failed",
                        "finished_at": datetime.now(timezone.utc),
                        "error_type": type(exc).__name__,
                        "error": str(exc),
                    }
                },
            )
        raise


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synchronize registered HANA views to QualityMonitoringSystem MongoDB"
    )
    parser.add_argument(
        "--mode", choices=("full", "incremental"), default="incremental"
    )
    parser.add_argument(
        "--view", action="append", dest="views", choices=tuple(VIEW_SPECS)
    )
    parser.add_argument("--batch-size", type=int, default=None)
    parser.add_argument(
        "--start-date",
        help="minimum source date, YYYY-MM-DD or YYYYMMDD; defaults to SYNC_START_DATE",
    )
    parser.add_argument(
        "--include-undated",
        action="store_true",
        help="allow views without a date field",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="read HANA and report counts without MongoDB writes",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    load_env_file(DEFAULT_ENV_FILE)
    if not DEFAULT_ENV_FILE.is_file():
        logger.warning(
            "environment file not found: %s; using exported environment variables",
            DEFAULT_ENV_FILE,
        )
    try:
        hana_settings = HanaSettings.from_env()
        batch_size = (
            args.batch_size
            if args.batch_size is not None
            else int(os.getenv("SYNC_BATCH_SIZE", "1000"))
        )
        if batch_size < 1:
            raise ConfigurationError(
                "--batch-size and SYNC_BATCH_SIZE must be greater than zero"
            )
        start_date = normalize_start_date(
            args.start_date or os.getenv("SYNC_START_DATE", "2026-01-01")
        )
        selected = args.views or [
            view_id
            for view_id, spec in VIEW_SPECS.items()
            if spec.start_date_field or args.include_undated
        ]
        undated = [
            view_id
            for view_id in selected
            if VIEW_SPECS[view_id].start_date_field is None
        ]
        if undated and not args.include_undated:
            raise ConfigurationError(
                "Undated view(s) require --include-undated: " + ", ".join(undated)
            )

        mongo_client = None
        database = None
        if not args.dry_run:
            from pymongo import MongoClient

            mongo_settings = MongoSettings.from_env()
            mongo_client = MongoClient(
                mongo_settings.uri,
                serverSelectionTimeoutMS=mongo_settings.server_selection_timeout_ms,
            )
            mongo_client.admin.command("ping")
            database = mongo_client[mongo_settings.database]
        try:
            for view_id in selected:
                stats = sync_view(
                    VIEW_SPECS[view_id],
                    hana_settings,
                    database,
                    mode=args.mode,
                    batch_size=batch_size,
                    start_date=start_date
                    if VIEW_SPECS[view_id].start_date_field
                    else None,
                    dry_run=args.dry_run,
                )
                logger.info("synchronized %s: %s", view_id, stats.as_dict())
        finally:
            if mongo_client is not None:
                mongo_client.close()
        return 0
    except Exception:
        logger.exception("HANA to MongoDB synchronization failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
