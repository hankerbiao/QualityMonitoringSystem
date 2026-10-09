"""关键工位影像追溯：实时双源聚合，不持久化业务数据。"""

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

from app.db.mongodb import get_database
from app.libs.photo_sources import PhotoSourceClient, SourceDefinition
from app.schemas.process_records import (
    ProcessRecordBaseOption,
    ProcessRecordConnectionTest,
    ProcessRecordFilterOptions,
    ProcessRecordItem,
    ProcessRecordPhoto,
    ProcessRecordRealtimeData,
    ProcessRecordSource,
    ProcessRecordSourceResult,
    SourceConnectionResult,
)
from app.services.credential_crypto import decrypt_credential

CONFIG_KEY = "process_record_config"

SOURCE_DEFINITIONS = {
    "system1": SourceDefinition(
        key="system1",
        name="工序扫码拍照系统",
        api_base_url="http://10.2.20.22",
        image_base_url="http://10.2.20.22:9991",
        page_path="/api/Tb_process_scan_photo/getPageData",
        sort_field="id",
        sn_field="scan_code",
        sn_display_type="text",
        base_field="base_code",
        base_display_type="select",
        station_field="process",
        station_display_type="select",
    ),
    "system2": SourceDefinition(
        key="system2",
        name="装配关键工位系统",
        api_base_url="http://10.2.20.3:9991",
        image_base_url="http://10.2.20.3:9991",
        page_path="/api/tb_assembly_image/getPageData",
        sort_field="Id",
        sn_field="Barcode",
        sn_display_type="like",
        base_field="Base",
        base_display_type="select",
        station_field="StationName",
    ),
}

BASE_FILTER_VALUES: dict[str, dict[str, str]] = {
    "天津": {"system1": "TJ", "system2": "1000"},
    "昆山": {"system1": "KS", "system2": "3000"},
    "太原": {"system1": "TY", "system2": "7000"},
    "安阳": {"system1": "AY", "system2": "8000"},
    "桐乡": {"system1": "TX", "system2": "9000"},
    "盘锦": {"system1": "PJ", "system2": "2000"},
    "大同": {"system1": "DT", "system2": "D000"},
    "青岛": {"system1": "QD"},
    "马来": {"system1": "ML"},
}

SYSTEM1_PROCESS_OPTIONS = [
    "TJM-OP20",
    "TJM-OP10",
    "TJM-OP160",
    "TJM-OP190",
    "TJM-OP200",
    "TJM-OP320",
    "TJM-OP310",
    "TJM-OP300",
    "TJM-OP250",
    "TJM-OP230",
    "TJM-OP222",
    "TJM-OP221",
    "TJM-OP220",
    "TJM-OP215",
    "TJM-OP210",
    "TJM-OP240",
    "TJM-OP205",
    "DTM-OP310",
    "DTM-OP180",
]


def get_filter_options() -> ProcessRecordFilterOptions:
    return ProcessRecordFilterOptions(
        bases=[
            ProcessRecordBaseOption(name=name, sources=list(values))
            for name, values in BASE_FILTER_VALUES.items()
        ],
        system1Processes=SYSTEM1_PROCESS_OPTIONS,
    )


class CredentialsNotConfiguredError(RuntimeError):
    pass


def _text(value: Any) -> str:
    return "" if value is None else str(value)


def _first(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        if row.get(key) not in (None, ""):
            return _text(row[key])
    return ""


def _photo_paths(value: Any) -> list[str]:
    if value is None:
        return []
    values = value if isinstance(value, list) else re.split(r"[;,|]", str(value))
    return [str(item).strip() for item in values if str(item).strip()]


def _display_base(source: str, value: Any) -> str:
    source_value = _text(value).strip()
    for name, mappings in BASE_FILTER_VALUES.items():
        if mappings.get(source) == source_value:
            return name
    return source_value


def normalize_record(source: str, row: dict[str, Any]) -> ProcessRecordItem:
    if source == "system1":
        record_id = _first(row, "id", "Id")
        photo_values = [
            row.get("photo_url_one"),
            row.get("photo_url_two"),
            row.get("photo_url_three"),
        ]
        photos = [path for value in photo_values for path in _photo_paths(value)]
        return ProcessRecordItem(
            key=f"system1:{record_id}",
            source="system1",
            sourceName=SOURCE_DEFINITIONS[source].name,
            recordId=record_id,
            sn=_first(row, "scan_code", "ScanCode"),
            base=_display_base(
                "system1",
                _first(row, "base_code", "base", "Base", "factory", "Factory"),
            ),
            station=_first(row, "process", "Process"),
            submittedAt=_first(
                row,
                "submit_time",
                "SubmitTime",
                "create_time",
                "CreateTime",
                "create_date",
                "CreateDate",
            ),
            order=_first(row, "order", "Order"),
            remarks=_first(row, "remark", "remarks", "Remarks"),
            files=_first(row, "files", "Files"),
            photos=[ProcessRecordPhoto(path=path) for path in photos],
            raw=row,
        )

    record_id = _first(row, "Id", "id")
    photos = _photo_paths(row.get("Photos"))
    return ProcessRecordItem(
        key=f"system2:{record_id}",
        source="system2",
        sourceName=SOURCE_DEFINITIONS[source].name,
        recordId=record_id,
        sn=_first(row, "Barcode"),
        base=_display_base("system2", _first(row, "Base")),
        station=_first(row, "StationName"),
        submittedAt=_first(row, "SubmitTime"),
        order=_first(row, "Order"),
        remarks=_first(row, "Remarks"),
        files=_first(row, "Files"),
        photos=[ProcessRecordPhoto(path=path) for path in photos],
        raw=row,
    )


def _record_sort_key(item: ProcessRecordItem) -> tuple[float, int, str]:
    try:
        submitted_at = datetime.fromisoformat(item.submittedAt.replace("Z", "+00:00"))
        timestamp = submitted_at.timestamp()
    except (TypeError, ValueError):
        timestamp = 0.0
    numeric_id = int(item.recordId) if item.recordId.isdigit() else 0
    return timestamp, numeric_id, item.recordId


class ProcessRecordGateway:
    def __init__(self):
        self._clients: dict[str, PhotoSourceClient] = {}
        self._credentials: tuple[str, str] | None = None
        self._config_lock = asyncio.Lock()

    async def close(self) -> None:
        clients, self._clients = self._clients, {}
        self._credentials = None
        await asyncio.gather(
            *(client.close() for client in clients.values()), return_exceptions=True
        )

    async def invalidate_clients(self) -> None:
        """Drop cached upstream sessions after the shared credential is saved."""
        async with self._config_lock:
            clients, self._clients = self._clients, {}
            self._credentials = None
            await asyncio.gather(
                *(client.close() for client in clients.values()), return_exceptions=True
            )

    async def _configured_credentials(self) -> tuple[str, str]:
        doc = await get_database().configs.find_one({"key": CONFIG_KEY})
        username = _text((doc or {}).get("username")).strip()
        password_ciphertext = _text((doc or {}).get("passwordCiphertext"))
        if not username or not password_ciphertext:
            raise CredentialsNotConfiguredError("请先在系统设置中配置关键工位影像追溯账号和密码")
        password = decrypt_credential(password_ciphertext)
        return username, password

    async def _ensure_clients(self) -> dict[str, PhotoSourceClient]:
        credentials = await self._configured_credentials()
        async with self._config_lock:
            if self._credentials == credentials and self._clients:
                return self._clients
            old_clients = self._clients
            self._clients = {
                key: PhotoSourceClient(definition, *credentials)
                for key, definition in SOURCE_DEFINITIONS.items()
            }
            self._credentials = credentials
            if old_clients:
                await asyncio.gather(
                    *(client.close() for client in old_clients.values()),
                    return_exceptions=True,
                )
            return self._clients

    async def _query_source(
        self,
        source: str,
        page: int,
        page_size: int,
        sn: str,
        base: str,
        station: str,
    ) -> ProcessRecordSourceResult:
        source_base = BASE_FILTER_VALUES.get(base, {}).get(source) if base else ""
        if base and not source_base:
            return ProcessRecordSourceResult(online=True)
        try:
            clients = await self._ensure_clients()
            payload = await clients[source].fetch_page(
                page,
                page_size,
                sn=sn,
                base=source_base,
                station=station,
            )
            rows = [normalize_record(source, row) for row in payload.get("rows", [])]
            return ProcessRecordSourceResult(
                online=True,
                total=int(payload.get("total") or len(rows)),
                rows=rows,
            )
        except Exception as exc:
            return ProcessRecordSourceResult(online=False, error=str(exc))

    async def query(
        self,
        source: ProcessRecordSource,
        page: int,
        page_size: int,
        sn: str,
        base: str = "",
        station: str = "",
    ) -> ProcessRecordRealtimeData:
        if base and base not in BASE_FILTER_VALUES:
            raise ValueError(f"不支持的基地筛选值: {base}")
        selected = ["system1", "system2"] if source == "all" else [source]
        source_page = 1 if source == "all" else page
        results = await asyncio.gather(
            *(
                self._query_source(key, source_page, page_size, sn, base, station)
                for key in selected
            )
        )
        sources = dict(zip(selected, results, strict=True))
        rows = [item for result in results for item in result.rows]
        rows.sort(key=_record_sort_key, reverse=True)
        total = sum(result.total for result in results)
        return ProcessRecordRealtimeData(
            queriedAt=datetime.now(timezone.utc).isoformat(),
            source=source,
            page=source_page,
            pageSize=page_size,
            total=total,
            rows=rows,
            sources=sources,
        )

    async def fetch_image(self, source: str, path: str) -> tuple[bytes, str]:
        clients = await self._ensure_clients()
        return await clients[source].fetch_image(path)

    async def test_credentials(self, username: str, password: str) -> ProcessRecordConnectionTest:
        async def test_one(key: str) -> SourceConnectionResult:
            client = PhotoSourceClient(SOURCE_DEFINITIONS[key], username, password)
            try:
                await client.login()
                await client.get_login_status()
                return SourceConnectionResult(
                    source=key,
                    name=SOURCE_DEFINITIONS[key].name,
                    online=True,
                    message="登录成功",
                )
            except Exception as exc:
                return SourceConnectionResult(
                    source=key,
                    name=SOURCE_DEFINITIONS[key].name,
                    online=False,
                    message=str(exc),
                )
            finally:
                await client.close()

        results = await asyncio.gather(test_one("system1"), test_one("system2"))
        return ProcessRecordConnectionTest(
            success=all(result.online for result in results),
            sources=list(results),
        )


process_record_gateway = ProcessRecordGateway()
