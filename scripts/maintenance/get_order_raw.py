#!/usr/bin/env python3
"""Fetch the raw gateway record for a sales order."""

from __future__ import annotations

import argparse
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEFAULT_GATEWAY_URL = "http://10.17.150.235:5174"
DEFAULT_ORDER_ID = "KK:30236641"


def fetch_order(gateway_url: str, order_id: str, timeout: float) -> dict:
    query = urlencode({"id": order_id})
    request = Request(
        f"{gateway_url.rstrip('/')}/api/orders/detail?{query}",
        headers={"Accept": "application/json"},
        method="GET",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"请求网关失败: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("网关返回的内容不是合法 JSON") from exc

    if not isinstance(payload, dict):
        raise RuntimeError("网关返回了非对象 JSON")
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="通过数据网关获取订单原始数据。"
    )
    parser.add_argument(
        "--gateway-url",
        default=os.getenv("DATA_GATEWAY_URL", DEFAULT_GATEWAY_URL),
        help="数据网关地址。",
    )
    parser.add_argument(
        "--order-id",
        default=DEFAULT_ORDER_ID,
        help="订单详情主键，例如 KK:30236641。",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30,
        help="请求超时时间，单位秒。",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="输出完整接口响应，而不是仅输出 raw 字段。",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        payload = fetch_order(args.gateway_url, args.order_id, args.timeout)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    result = payload if args.full else payload.get("raw")
    if result is None:
        print("ERROR: 响应中没有 raw 字段", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
