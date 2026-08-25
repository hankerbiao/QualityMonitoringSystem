"""
SAP 销售订单客户端

并发调用 SG、KK 两个 SAP 来源的 ZSIMS_CL_INBOUND_MO_PSINFO 方法，
生成签名请求头、构建 payload、校验响应，并返回每个来源的结构化结果。
"""
from __future__ import annotations

import asyncio
import hashlib
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx

# SAP 方法名（同时用于签名与请求头）
METHOD = "ZSIMS_CL_INBOUND_MO_PSINFO"
# 请求超时（秒）
TIMEOUT = 120

# 两个固定来源地址
SOURCE_URLS: dict[str, str] = {
    "SG": "http://10.2.101.37:8000/sap/ZHTTP_SIMS?sap-client=800",
    "KK": "http://10.8.100.11:8001/sap/ZHTTP_SIMS?sap-client=600",
}

# gather 返回的 sources 顺序；聚合 `data` 时取此列表中"最后一个成功来源"的完整记录
SOURCE_ORDER: list[str] = ["SG", "KK"]

# SAP 表示错误的消息类型
ERROR_MSGTY = {"E", "A", "X"}


@dataclass
class SourceFetchResult:
    """单个 SAP 来源的抓取结果"""

    source: str
    success: bool = True
    error: str | None = None
    records: list[dict[str, Any]] = field(default_factory=list)


class SapSalesOrderService:
    """SAP 销售订单客户端（SG / KK 双来源）"""

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        """
        初始化客户端。

        Args:
            client: 已有的 httpx.AsyncClient（用于测试注入）；为 None 时每次请求自行创建。
        """
        self._client = client

    # ── 请求头与签名 ─────────────────────────────────────────────────────────

    def _build_headers(self, now: datetime | None = None) -> dict[str, str]:
        """
        生成 SAP 请求头，含 MD5 签名。

        签名使用「当前服务器日期」，而非查询日期：
            sign = MD5("sugon" + METHOD + time_value + "sugon").upper()
        """
        time_value = (now or datetime.now()).strftime("%Y%m%d")
        raw = f"sugon{METHOD}{time_value}sugon"
        sign = hashlib.md5(raw.encode("utf-8")).hexdigest().upper()
        return {
            "Content-Type": "application/json",
            "method": METHOD,
            "sign": sign,
            "time": time_value,
        }

    def _build_payload(
        self,
        start_date: datetime.date,
        end_date: datetime.date,
        prodh_list: list[str] | None,
    ) -> dict[str, Any]:
        """构建 SAP 请求体；prodh_list 为空或 None 时不写入 PRODH_LIST 字段。"""
        payload: dict[str, Any] = {
            "CHDAT": start_date.strftime("%Y-%m-%d"),
            "CHDAT_TO": end_date.strftime("%Y-%m-%d"),
        }
        if prodh_list:  # 非空列表才传；空数组视为未设置过滤
            payload["PRODH_LIST"] = prodh_list
        return payload

    # ── 单来源抓取与校验 ─────────────────────────────────────────────────────

    async def _fetch_source(
        self,
        source: str,
        client: httpx.AsyncClient,
        headers: dict[str, str],
        payload: dict[str, Any],
    ) -> SourceFetchResult:
        url = SOURCE_URLS[source]
        try:
            resp = await client.post(
                url, json=payload, headers=headers, timeout=TIMEOUT
            )
        except httpx.HTTPError as exc:
            return SourceFetchResult(
                source=source, success=False, error=f"SAP request failed: {exc}"
            )

        if resp.status_code >= 300:
            return SourceFetchResult(
                source=source,
                success=False,
                error=f"SAP returned HTTP {resp.status_code}",
            )

        try:
            body = resp.json()
        except ValueError:
            return SourceFetchResult(
                source=source,
                success=False,
                error="SAP response is not valid JSON",
            )

        if not isinstance(body, dict):
            return SourceFetchResult(
                source=source,
                success=False,
                error="SAP response is not a JSON object",
            )

        msgty = body.get("MSGTY")
        if msgty in ERROR_MSGTY:
            msgtx = body.get("MSGTX") or "Unknown SAP error"
            return SourceFetchResult(
                source=source,
                success=False,
                error=f"SAP error ({msgty}): {msgtx}",
            )

        data = body.get("DATA")
        if not isinstance(data, list):
            return SourceFetchResult(
                source=source,
                success=False,
                error="SAP response missing or invalid DATA array",
            )

        return SourceFetchResult(source=source, success=True, records=data)

    # ── 并发抓取两个来源 ─────────────────────────────────────────────────────

    async def fetch_all(
        self,
        start_date: datetime.date,
        end_date: datetime.date,
        prodh_list: list[str] | None,
    ) -> dict[str, SourceFetchResult]:
        """
        并发请求 SG 与 KK 两个来源。

        Returns:
            以来源名为键的 SourceFetchResult 字典；gather 保序，
            因此结果顺序恒为 {"SG": ..., "KK": ...}。
        """
        headers = self._build_headers()
        payload = self._build_payload(start_date, end_date, prodh_list)

        async with self._client_context() as client:
            sg_task = self._fetch_source("SG", client, headers, payload)
            kk_task = self._fetch_source("KK", client, headers, payload)
            sg_res, kk_res = await asyncio.gather(sg_task, kk_task)

        return {"SG": sg_res, "KK": kk_res}

    @asynccontextmanager
    async def _client_context(self):
        if self._client is not None:
            yield self._client
        else:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(TIMEOUT)
            ) as client:
                yield client
