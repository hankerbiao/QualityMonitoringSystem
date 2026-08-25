"""SAP ZSIMS_CL_INBOUND_SN_INFO 客户端。"""

from __future__ import annotations

import asyncio
import hashlib
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

METHOD = "ZSIMS_CL_INBOUND_SN_INFO"
TIMEOUT = 120
SOURCE_URLS: dict[str, str] = {
    "SG": "http://10.2.101.37:8000/sap/ZHTTP_SIMS?sap-client=800",
    "KK": "http://10.8.100.11:8001/sap/ZHTTP_SIMS?sap-client=600",
}
SG_URL = SOURCE_URLS["SG"]
KK_URL = SOURCE_URLS["KK"]
ERROR_MSGTY = {"E", "A", "X"}


@dataclass
class SnInfoSourceFetchResult:
    """单来源 SAP 查询结果。"""

    source: str
    success: bool = True
    error: str | None = None
    records: list[dict[str, Any]] = field(default_factory=list)


class SapSnInfoService:
    """并发查询 SG、KK 生产环境的整机 SN 信息。"""

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client

    def _build_headers(self, now: datetime | None = None) -> dict[str, str]:
        time_value = (now or datetime.now()).strftime("%Y%m%d")
        raw = f"sugon{METHOD}{time_value}sugon"
        sign = hashlib.md5(raw.encode("utf-8")).hexdigest().upper()
        return {
            "Content-Type": "application/json",
            "method": METHOD,
            "sign": sign,
            "time": time_value,
        }

    @staticmethod
    def _build_payload(sn_list: list[str]) -> dict[str, list[str]]:
        return {"SN_LIST": sn_list}

    async def _fetch_source(
        self,
        source: str,
        client: httpx.AsyncClient,
        headers: dict[str, str],
        payload: dict[str, list[str]],
    ) -> SnInfoSourceFetchResult:
        try:
            response = await client.post(
                SOURCE_URLS[source],
                json=payload,
                headers=headers,
                timeout=TIMEOUT,
            )
        except httpx.HTTPError as exc:
            return SnInfoSourceFetchResult(source=source, success=False, error=f"SAP request failed: {exc}")

        if response.status_code >= 300:
            return SnInfoSourceFetchResult(
                source=source,
                success=False,
                error=f"SAP returned HTTP {response.status_code}",
            )

        try:
            body = response.json()
        except ValueError:
            return SnInfoSourceFetchResult(source=source, success=False, error="SAP response is not valid JSON")

        if not isinstance(body, dict):
            return SnInfoSourceFetchResult(source=source, success=False, error="SAP response is not a JSON object")

        msgty = str(body.get("MSGTY") or "").upper()
        if msgty in ERROR_MSGTY:
            return SnInfoSourceFetchResult(
                source=source,
                success=False,
                error=f"SAP error ({msgty}): {body.get('MSGTX') or 'Unknown SAP error'}",
            )

        data = body.get("DATA")
        if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
            return SnInfoSourceFetchResult(source=source, success=False, error="SAP response missing or invalid DATA array")
        return SnInfoSourceFetchResult(source=source, records=data)

    async def fetch_all(self, sn_list: list[str]) -> dict[str, SnInfoSourceFetchResult]:
        headers = self._build_headers()
        payload = self._build_payload(sn_list)
        async with self._client_context() as client:
            results = await asyncio.gather(
                *(
                    self._fetch_source(source, client, headers, payload)
                    for source in SOURCE_URLS
                )
            )
        return {result.source: result for result in results}

    @asynccontextmanager
    async def _client_context(self):
        if self._client is not None:
            yield self._client
        else:
            async with httpx.AsyncClient(timeout=httpx.Timeout(TIMEOUT)) as client:
                yield client
