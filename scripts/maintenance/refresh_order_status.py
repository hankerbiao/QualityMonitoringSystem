#!/usr/bin/env python3
"""Trigger a one-off sales-order status refresh through the data gateway."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_GATEWAY_URL = "http://10.17.150.235:5174"
DEFAULT_TIMEOUT_SECONDS = 900
DEFAULT_POLL_SECONDS = 3


def request_json(
    gateway_url: str,
    path: str,
    *,
    method: str = "GET",
    payload: dict | None = None,
    timeout: float = 30,
) -> dict:
    body = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(
        f"{gateway_url.rstrip('/')}{path}",
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"gateway returned HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"gateway request failed: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("gateway returned invalid JSON") from exc
    if not isinstance(result, dict):
        raise RuntimeError("gateway returned an unexpected response")
    return result


def start_refresh(gateway_url: str) -> str:
    result = request_json(
        gateway_url,
        "/api/sync/runs",
        method="POST",
        payload={"mode": "incremental", "taskIds": ["sales_orders"]},
    )
    run_id = str(result.get("runId") or result.get("_id") or "").strip()
    if not run_id:
        raise RuntimeError(f"gateway did not return a run id: {result}")
    return run_id


def wait_for_refresh(
    gateway_url: str,
    run_id: str,
    *,
    timeout_seconds: int,
    poll_seconds: int,
) -> dict:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            result = request_json(gateway_url, f"/api/sync/runs/{run_id}")
        except RuntimeError as exc:
            # The gateway can acknowledge a run before its detail document is
            # visible. The global status endpoint is available during that gap.
            if "HTTP 404" not in str(exc):
                raise
            status = request_json(gateway_url, "/api/sync/status")
            if str(status.get("runId") or "").strip() == run_id:
                result = status
            else:
                time.sleep(poll_seconds)
                continue
        state = str(result.get("state") or "").lower()
        print(f"run={run_id} state={state}", flush=True)
        if state in {"success", "failed"}:
            return result
        time.sleep(poll_seconds)
    raise TimeoutError(f"refresh did not finish within {timeout_seconds} seconds")


def summarize(result: dict) -> None:
    for stage in result.get("stages") or []:
        if stage.get("task_id") != "sales_orders":
            continue
        summary = stage.get("summary") or {}
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return
    print(json.dumps(result, ensure_ascii=False, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Refresh existing sales-order records from the source system."
    )
    parser.add_argument(
        "--gateway-url",
        default=os.getenv("DATA_GATEWAY_URL", DEFAULT_GATEWAY_URL),
        help="Data gateway base URL.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help="Maximum wait time in seconds.",
    )
    parser.add_argument(
        "--poll",
        type=int,
        default=DEFAULT_POLL_SECONDS,
        help="Polling interval in seconds.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        run_id = start_refresh(args.gateway_url)
        print(f"started sales-order refresh: {run_id}", flush=True)
        result = wait_for_refresh(
            args.gateway_url,
            run_id,
            timeout_seconds=args.timeout,
            poll_seconds=args.poll,
        )
    except (RuntimeError, TimeoutError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    summarize(result)
    return 0 if result.get("state") == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
