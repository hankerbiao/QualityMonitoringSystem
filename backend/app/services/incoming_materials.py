"""Read the upstream incoming-material exceptions without persisting them."""

import json
import re
from datetime import date, datetime, timezone
from typing import Any

from app.base_access import BASE_OPTIONS, base_allowed, canonical_base, current_base_permissions
from app.libs.photo_sources import PhotoSourceClient
from app.services.image_access import image_grant
from app.services.process_record_service import process_record_gateway

PAGE_SIZE = 30
UPSTREAM_PATH = "/api/Tb_abnormal_incoming_materials/getPageData"
IMAGE_SOURCE = "incoming-materials"
REPORT_SOURCE = "incoming-materials-report"
IMAGE_PREFIX = "Upload/Tables/Tb_abnormal_incoming_materials/"


def incoming_image_path(path: str) -> str:
    normalized = PhotoSourceClient.validate_image_path(path)
    if not normalized.startswith(IMAGE_PREFIX):
        raise ValueError("无效的来料异常图片路径")
    return normalized


def incoming_files(row: dict[str, Any], field: str, source: str) -> list[dict[str, str]]:
    value = row.get(field)
    # Commas can be part of the filename; split only when another upload path follows.
    parts = value if isinstance(value, list) else re.split(
        r"[,;|](?=\s*/?Upload/Tables/)", str(value or "").replace("\\", "/")
    )
    files = []
    for item in parts:
        try:
            path = incoming_image_path(str(item).strip())
        except ValueError:
            continue
        files.append({"path": path, "accessToken": image_grant(source, path, str(row.get("basecode") or ""))})
    return files


async def fetch_page(client: Any, page: int) -> dict[str, Any]:
    response = await client._request(
        "POST", UPSTREAM_PATH,
        json={"page": page, "rows": PAGE_SIZE, "sort": "id", "order": "desc", "wheres": "[]"},
    )
    data = response.json()
    if not isinstance(data, dict) or client._payload_has_error(data):
        raise ValueError("来料异常数据源返回错误")
    total, rows = data.get("total"), data.get("rows")
    if type(total) is not int or total < 0 or not isinstance(rows, list):
        raise ValueError("来料异常数据源返回了无效的 total 或 rows")
    if any(not isinstance(row, dict) for row in rows):
        raise ValueError("来料异常数据源返回了无效记录")
    return data


async def query_incoming_materials(
    keyword: str, *, base: str = "", bases: list[str] | None = None, material: str = "", supplier: str = "",
    order: str = "", lot: str = "", category: str = "", date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    clients = await process_record_gateway._ensure_clients()
    client = clients["system1"]
    first = await fetch_page(client, 1)
    total = first["total"]
    if total == 0 and first["rows"]:
        raise ValueError("上游数据返回了不一致的记录总数，请重新查询")
    pages = (total + PAGE_SIZE - 1) // PAGE_SIZE
    selected_bases = {canonical_base(value) for value in [base, *(bases or [])] if value.strip()}
    count = pages
    rows: list[dict[str, Any]] = []
    ids: set[str] = set()
    for page in range(1, count + 1):
        data = first if page == 1 else await fetch_page(client, page)
        part = data["rows"]
        if data["total"] != total or len(part) != min(PAGE_SIZE, total - (page - 1) * PAGE_SIZE):
            raise ValueError("上游数据在分页期间发生变化或返回不完整，请重新查询")
        for row in part:
            record_id = row.get("id")
            if record_id is None or str(record_id) in ids:
                raise ValueError("上游分页记录缺少 ID 或出现重复，请重新查询")
            ids.add(str(record_id))
        rows.extend(part)
    if count > 1:
        check = await fetch_page(client, 1)
        if check["total"] != total or check["rows"] != first["rows"]:
            raise ValueError("上游数据在分页期间发生变化，请重新查询")
    if rows and not any("location_info" in row for row in rows):
        raise ValueError("上游数据缺少库位信息字段 location_info，无法统计")

    restricted = current_base_permissions() is not None
    if restricted:
        known_bases = {code for code, _, _ in BASE_OPTIONS}
        if any(canonical_base(row.get("basecode")) not in known_bases for row in rows):
            raise ValueError("上游数据的基地字段缺失或无法识别，无法应用基地权限")
        rows = [row for row in rows if base_allowed(row.get("basecode"))]

    read_count = len(rows)
    rows = [row for row in rows if str(row.get("location_info") or "").strip().upper().endswith("N00")]
    if selected_bases:
        rows = [row for row in rows if canonical_base(row.get("basecode")) in selected_bases]
    for field, value in (("selmatnr", material), ("supplier", supplier), ("ebeln", order),
                         ("prueflos", lot), ("abnormal_class", category)):
        if value:
            rows = [row for row in rows if value.casefold() in str(row.get(field) or "").casefold()]
    if date_from or date_to:
        def matches_date(row: dict[str, Any]) -> bool:
            try:
                arrival = date.fromisoformat(str(row.get("pastrterm") or "")[:10])
            except ValueError:
                return False
            return (date_from is None or arrival >= date_from) and (date_to is None or arrival <= date_to)
        rows = [row for row in rows if matches_date(row)]
    if keyword:
        needle = keyword.casefold()
        rows = [
            row for row in rows
            if any(needle in json.dumps(value, ensure_ascii=False, default=str).casefold() for value in row.values())
        ]
    rows = [{**row, "_incomingPhotos": incoming_files(row, "bad_img", IMAGE_SOURCE),
             "_incomingReports": incoming_files(row, "report_attachment", REPORT_SOURCE)} for row in rows]
    return {
        "queriedAt": datetime.now(timezone.utc).isoformat(),
        "upstreamTotal": None if restricted else total,
        "readCount": read_count,
        "matchedCount": len(rows),
        "complete": count == pages,
        "rows": rows,
    }
