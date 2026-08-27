"""运营监控数据聚合服务。"""

import asyncio
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

DISPLAY_TZ = ZoneInfo("Asia/Shanghai")

MODULE_LABELS = {
    "home": "系统首页",
    "rty": "RTY 质量看板",
    "lrr": "LRR 故障率",
    "process-records": "关键工位影像",
    "settings": "系统配置",
    "ai": "AI 分析助手",
    "alert-report": "预警报告",
    "operations": "运营监控",
    "doa": "DOA 报修率",
    "sales-orders": "销售订单",
    "other": "其他功能",
}

PAGE_MODULES = {
    "/": "home",
    "/rty": "rty",
    "/lrr": "lrr",
    "/process-records": "process-records",
    "/operations": "operations",
    "/doa/raw": "doa",
    "/doa": "doa",
    "/doa/repairs": "doa",
}

BUSINESS_MODULES = (
    "rty",
    "lrr",
    "doa",
    "sales-orders",
    "process-records",
    "settings",
    "ai",
    "alert-report",
)

HANA_SOURCE_LABELS = {
    "ZSGV_ZSD124": "SAP HANA 订单 BOM",
    "ZSGV_ZPP_SERNOLIST": "SAP HANA 序列绑定",
    "ZSGV_ZZT_WLJL": "SAP HANA 维修记录",
    "Z_V_ZMES_T_001": "SAP HANA 过站记录",
}


def module_from_path(path: str) -> str:
    """把前端路由或 API 路径归一为稳定的功能模块。"""
    clean_path = (path or "/").split("?", 1)[0].rstrip("/") or "/"
    if clean_path in PAGE_MODULES:
        return PAGE_MODULES[clean_path]

    api_prefixes = (
        ("/api/process-records", "process-records"),
        ("/api/alert-report", "alert-report"),
        ("/api/settings", "settings"),
        ("/api/fault", "rty"),
        ("/api/rty", "rty"),
        ("/api/lrr", "lrr"),
        ("/api/doa", "doa"),
        ("/api/sales-orders", "sales-orders"),
        ("/api/ai", "ai"),
        ("/api/mes", "rty"),
    )
    for prefix, module in api_prefixes:
        if clean_path.startswith(prefix):
            return module
    return "other"


def _as_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc).astimezone(timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).astimezone(timezone.utc)
        except ValueError:
            return None
    return None


def _percent_change(current: float, previous: float) -> float | None:
    if previous == 0:
        return None if current == 0 else 100.0
    return round((current - previous) / previous * 100, 1)


def _display_name(profile: dict[str, Any], itcode: str) -> str:
    for key in ("姓名", "真实姓名", "name"):
        value = profile.get(key)
        if value:
            return str(value)
    return itcode


def _as_sync_value(value: Any) -> str | None:
    """Normalize stored sync timestamps and watermarks for the dashboard API."""
    if isinstance(value, datetime):
        return (
            value.replace(tzinfo=value.tzinfo or timezone.utc).astimezone(timezone.utc).isoformat()
        )
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        return value or None
    if isinstance(value, dict):
        date_value = value.get("ZDATE") or value.get("date")
        time_value = value.get("ZTIME") or value.get("time")
        if date_value:
            date_text = str(date_value)
            if len(date_text) == 8 and date_text.isdigit():
                date_text = f"{date_text[:4]}-{date_text[4:6]}-{date_text[6:]}"
            time_text = str(time_value or "")
            if len(time_text) == 6 and time_text.isdigit():
                time_text = f"{time_text[:2]}:{time_text[2:4]}:{time_text[4:]}"
            return f"{date_text} {time_text}".strip()
    return None


async def _latest_sales_source_sync_time(db: Any, source_name: str) -> str | None:
    rows = await (
        db.sales_orders_sap.find({f"source_records.{source_name}.fetched_at": {"$exists": True}})
        .sort(f"source_records.{source_name}.fetched_at", -1)
        .limit(1)
        .to_list(length=1)
    )
    if not rows:
        return None
    source_record = (rows[0].get("source_records") or {}).get(source_name) or {}
    return _as_sync_value(source_record.get("fetched_at"))


async def _sync_data_sources(db: Any) -> list[dict[str, Any]]:
    """Return all scheduler checkpoints that represent data already written to MongoDB."""
    sales_checkpoints, hana_checkpoints, doa_progress = await asyncio.gather(
        db.rty_sync_checkpoints.find({"source": "sales_orders"}).to_list(length=20),
        db["_hana_sync_checkpoints"].find({}).to_list(length=20),
        db.scs_doa_incremental_progress.find_one({"_id": "scs_doa_incremental"}),
    )

    sources: list[dict[str, Any]] = []
    sales_by_name = {str(item.get("source_name")): item for item in sales_checkpoints}
    missing_sales_sources = [
        source_name
        for source_name in ("SG", "KK")
        if not _as_sync_value(sales_by_name.get(source_name, {}).get("updated_at"))
    ]
    manual_sales_sync_times = dict(
        zip(
            missing_sales_sources,
            await asyncio.gather(
                *(_latest_sales_source_sync_time(db, source) for source in missing_sales_sources)
            ),
            strict=True,
        )
    )
    for source_name in ("SG", "KK"):
        checkpoint = sales_by_name.get(source_name, {})
        sources.append(
            {
                "key": f"sales-orders-{source_name.lower()}",
                "name": f"SAP 销售订单 · {source_name}",
                "collection": "sales_orders_sap",
                "lastSyncedAt": _as_sync_value(checkpoint.get("updated_at"))
                or manual_sales_sync_times.get(source_name),
                "latestDataAt": _as_sync_value(checkpoint.get("last_success_date")),
            }
        )

    hana_by_view = {str(item.get("view_id") or item.get("_id")): item for item in hana_checkpoints}
    for view_id, name in HANA_SOURCE_LABELS.items():
        checkpoint = hana_by_view.get(view_id, {})
        sources.append(
            {
                "key": f"hana-{view_id.lower()}",
                "name": name,
                "collection": str(checkpoint.get("collection") or ""),
                "lastSyncedAt": _as_sync_value(checkpoint.get("updated_at")),
                "latestDataAt": _as_sync_value(checkpoint.get("watermark")),
            }
        )

    sources.append(
        {
            "key": "scs-doa",
            "name": "SCS DOA 报修数据",
            "collection": "scs_doa_results",
            "lastSyncedAt": _as_sync_value((doa_progress or {}).get("last_success_at")),
            "latestDataAt": _as_sync_value((doa_progress or {}).get("watermark_date")),
        }
    )
    return sources


async def record_page_view(db: Any, itcode: str, path: str) -> None:
    now = datetime.now(timezone.utc)
    await db.usage_events.insert_one(
        {
            "eventType": "page_view",
            "itcode": itcode,
            "module": module_from_path(path),
            "path": (path or "/")[:160],
            "statusCode": 200,
            "timestamp": now,
        }
    )


async def build_operations_dashboard(db: Any, days: int) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    local_today = now.astimezone(DISPLAY_TZ).date()
    current_start_local = datetime.combine(
        local_today - timedelta(days=days - 1), time.min, tzinfo=DISPLAY_TZ
    )
    current_start = current_start_local.astimezone(timezone.utc)
    previous_start = (current_start_local - timedelta(days=days)).astimezone(timezone.utc)

    events, sessions, users, total_users, sync_data_sources = await asyncio.gather(
        db.usage_events.find({"timestamp": {"$gte": previous_start}}).to_list(length=200_000),
        db.sessions.find({"createdAt": {"$gte": previous_start.isoformat()}}).to_list(
            length=100_000
        ),
        db.users.find({}).to_list(length=20_000),
        db.users.count_documents({}),
        _sync_data_sources(db),
    )

    def in_period(value: Any, start: datetime, end: datetime) -> bool:
        parsed = _as_datetime(value)
        return parsed is not None and start <= parsed < end

    current_events = [e for e in events if in_period(e.get("timestamp"), current_start, now)]
    previous_events = [
        e for e in events if in_period(e.get("timestamp"), previous_start, current_start)
    ]
    current_sessions = [s for s in sessions if in_period(s.get("createdAt"), current_start, now)]
    previous_sessions = [
        s for s in sessions if in_period(s.get("createdAt"), previous_start, current_start)
    ]

    def summarize(period_events: list[dict], period_sessions: list[dict]) -> dict[str, Any]:
        active_users = {
            str(item.get("itcode"))
            for item in [*period_events, *period_sessions]
            if item.get("itcode")
        }
        page_views = [e for e in period_events if e.get("eventType") == "page_view"]
        api_requests = [e for e in period_events if e.get("eventType") == "api_request"]
        successful = [e for e in api_requests if int(e.get("statusCode", 500)) < 400]
        durations = [
            float(e["durationMs"])
            for e in api_requests
            if isinstance(e.get("durationMs"), int | float)
        ]
        return {
            "activeUsers": len(active_users),
            "visits": len(period_sessions),
            "pageViews": len(page_views),
            "apiRequests": len(api_requests),
            "successRate": round(len(successful) / len(api_requests) * 100, 1)
            if api_requests
            else 100.0,
            "avgResponseMs": round(sum(durations) / len(durations), 1) if durations else 0.0,
        }

    current = summarize(current_events, current_sessions)
    previous = summarize(previous_events, previous_sessions)

    active_cutoff = now - timedelta(minutes=15)
    current["currentOnline"] = len(
        {
            str(item.get("itcode"))
            for item in [*current_events, *current_sessions]
            if item.get("itcode")
            and (
                (_as_datetime(item.get("timestamp")) or _as_datetime(item.get("createdAt")))
                or datetime.min.replace(tzinfo=timezone.utc)
            )
            >= active_cutoff
        }
    )
    current["changes"] = {
        "activeUsers": _percent_change(current["activeUsers"], previous["activeUsers"]),
        "visits": _percent_change(current["visits"], previous["visits"]),
        "pageViews": _percent_change(current["pageViews"], previous["pageViews"]),
        "successRate": round(current["successRate"] - previous["successRate"], 1),
    }

    trend_map: dict[str, dict[str, Any]] = {}
    for offset in range(days):
        date_value = local_today - timedelta(days=days - 1 - offset)
        key = date_value.isoformat()
        trend_map[key] = {
            "date": key,
            "label": f"{date_value.month}/{date_value.day}",
            "activeUsers": set(),
            "visits": 0,
            "pageViews": 0,
            "apiRequests": 0,
        }

    for session in current_sessions:
        dt = _as_datetime(session.get("createdAt"))
        if not dt:
            continue
        key = dt.astimezone(DISPLAY_TZ).date().isoformat()
        if key in trend_map:
            trend_map[key]["visits"] += 1
            if session.get("itcode"):
                trend_map[key]["activeUsers"].add(str(session["itcode"]))

    for event in current_events:
        dt = _as_datetime(event.get("timestamp"))
        if not dt:
            continue
        key = dt.astimezone(DISPLAY_TZ).date().isoformat()
        if key not in trend_map:
            continue
        if event.get("itcode"):
            trend_map[key]["activeUsers"].add(str(event["itcode"]))
        if event.get("eventType") == "page_view":
            trend_map[key]["pageViews"] += 1
        elif event.get("eventType") == "api_request":
            trend_map[key]["apiRequests"] += 1

    trend = []
    for item in trend_map.values():
        trend.append({**item, "activeUsers": len(item["activeUsers"])})

    module_stats: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"pageViews": 0, "apiRequests": 0, "activeUsers": set()}
    )
    for event in current_events:
        module = event.get("module") or module_from_path(str(event.get("path", "")))
        if module not in BUSINESS_MODULES:
            continue
        stat = module_stats[module]
        if event.get("eventType") == "page_view":
            stat["pageViews"] += 1
        elif event.get("eventType") == "api_request":
            stat["apiRequests"] += 1
        if event.get("itcode"):
            stat["activeUsers"].add(str(event["itcode"]))

    total_module_views = sum(stat["pageViews"] for stat in module_stats.values())
    modules = []
    for key in BUSINESS_MODULES:
        stat = module_stats[key]
        modules.append(
            {
                "key": key,
                "name": MODULE_LABELS[key],
                "pageViews": stat["pageViews"],
                "apiRequests": stat["apiRequests"],
                "activeUsers": len(stat["activeUsers"]),
                "share": round(stat["pageViews"] / total_module_views * 100, 1)
                if total_module_views
                else 0.0,
            }
        )
    modules.sort(key=lambda item: (item["pageViews"], item["apiRequests"]), reverse=True)

    profile_by_itcode = {
        str(user.get("itcode")): user.get("profile") or {} for user in users if user.get("itcode")
    }
    recent_items: list[dict[str, Any]] = []
    for event in current_events:
        if event.get("eventType") != "page_view":
            continue
        itcode = str(event.get("itcode") or "unknown")
        recent_items.append(
            {
                "id": str(event.get("_id", "")),
                "itcode": itcode,
                "displayName": _display_name(profile_by_itcode.get(itcode, {}), itcode),
                "action": "访问页面",
                "module": MODULE_LABELS.get(str(event.get("module")), "其他功能"),
                "timestamp": (_as_datetime(event.get("timestamp")) or now).isoformat(),
                "status": "success",
            }
        )
    for session in current_sessions:
        itcode = str(session.get("itcode") or "unknown")
        recent_items.append(
            {
                "id": str(session.get("sessionId") or session.get("_id", "")),
                "itcode": itcode,
                "displayName": _display_name(profile_by_itcode.get(itcode, {}), itcode),
                "action": "登录系统",
                "module": "身份认证",
                "timestamp": (_as_datetime(session.get("createdAt")) or now).isoformat(),
                "status": "success",
            }
        )
    recent_items.sort(key=lambda item: item["timestamp"], reverse=True)

    api_events = [e for e in current_events if e.get("eventType") == "api_request"]
    errors = [e for e in api_events if int(e.get("statusCode", 500)) >= 400]
    event_times = [_as_datetime(e.get("timestamp")) for e in current_events]
    last_event = max((item for item in event_times if item), default=None)

    return {
        "period": {
            "days": days,
            "start": current_start.isoformat(),
            "end": now.isoformat(),
            "generatedAt": now.isoformat(),
        },
        "summary": {**current, "totalUsers": total_users},
        "trend": trend,
        "modules": modules,
        "health": {
            "status": "healthy" if current["successRate"] >= 99 else "degraded",
            "database": "healthy",
            "errorRequests": len(errors),
            "lastEventAt": last_event.isoformat() if last_event else None,
        },
        "syncDataSources": sync_data_sources,
        "recentActivity": recent_items[:10],
    }
