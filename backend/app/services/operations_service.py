"""运营监控数据聚合服务。"""

import asyncio
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from app.services.data_gateway_client import DataGatewayError, data_gateway

DISPLAY_TZ = ZoneInfo("Asia/Shanghai")

MODULE_LABELS = {
    "home": "系统首页",
    "rty": "RTY 质量看板",
    "station-pass-rate": "工位过站直通率",
    "repair-quality": "维修通过率分析",
    "reinsert-rate": "重插率分析",
    "lrr": "LRR 故障率",
    "process-records": "关键工位影像",
    "incoming-materials": "来料异常",
    "settings": "系统配置",
    "alert-report": "预警报告",
    "operations": "运营监控",
    "doa": "DOA 报修率",
    "mfr": "MFR 现网月化故障率",
    "other": "其他功能",
}

PAGE_MODULES = {
    "/": "home",
    "/rty": "rty",
    "/station-pass-rate": "station-pass-rate",
    "/repair-quality": "repair-quality",
    "/reinsert-rate": "reinsert-rate",
    "/lrr": "lrr",
    "/process-records": "process-records",
    "/incoming-materials": "incoming-materials",
    "/operations": "operations",
    "/doa/raw": "doa",
    "/doa": "doa",
    "/doa/repairs": "doa",
    "/mfr": "mfr",
}

BUSINESS_MODULES = (
    "rty",
    "station-pass-rate",
    "repair-quality",
    "reinsert-rate",
    "lrr",
    "doa",
    "mfr",
    "process-records",
    "incoming-materials",
    "settings",
    "alert-report",
)


def _project(cursor: Any, fields: dict[str, int]) -> Any:
    """Apply a Mongo projection while keeping the lightweight test cursor compatible."""
    project = getattr(cursor, "project", None)
    return project(fields) if callable(project) else cursor


def module_from_path(path: str) -> str:
    """把前端路由或 API 路径归一为稳定的功能模块。"""
    clean_path = (path or "/").split("?", 1)[0].rstrip("/") or "/"
    if clean_path in PAGE_MODULES:
        return PAGE_MODULES[clean_path]

    api_prefixes = (
        ("/api/process-records", "process-records"),
        ("/api/incoming-materials", "incoming-materials"),
        ("/api/alert-report", "alert-report"),
        ("/api/settings", "settings"),
        ("/api/rty/station-pass", "station-pass-rate"),
        ("/api/rty/repair-quality", "repair-quality"),
        ("/api/rty/reinsert-rate", "reinsert-rate"),
        ("/api/fault", "rty"),
        ("/api/rty", "rty"),
        ("/api/lrr", "lrr"),
        ("/api/doa", "doa"),
        ("/api/mfr", "mfr"),
        ("/api/mes", "rty"),
    )
    for prefix, module in api_prefixes:
        if clean_path.startswith(prefix):
            return module
    return "other"


def _is_home_page_view(event: dict[str, Any]) -> bool:
    """识别系统首页访问，兼容历史事件和未写入 module 的旧数据。"""
    if event.get("eventType") != "page_view":
        return False
    return (
        event.get("module") in ("home", "系统首页")
        or module_from_path(str(event.get("path", ""))) == "home"
    )


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


async def _sync_data_sources(_db: Any) -> list[dict[str, Any]]:
    """Return data-source freshness exclusively from the production gateway."""
    try:
        status = await data_gateway.data_status()
    except DataGatewayError:
        return [
            {
                "key": "data-gateway",
                "name": "生产数据网关",
                "collection": "",
                "lastSyncedAt": None,
                "latestDataAt": None,
                "status": "unavailable",
            }
        ]
    values = {
        "sales_orders": _as_sync_value(status.get("salesOrdersLastSyncedAt")),
        "faults": _as_sync_value(status.get("faultsLastSyncedAt")),
        "stations": _as_sync_value(status.get("stationRecordsLastSyncedAt")),
        "bindings": _as_sync_value(status.get("serialBindingsLastSyncedAt")),
        "bom": _as_sync_value(status.get("bomPostingsLastSyncedAt")),
        "scs_doa": _as_sync_value(status.get("scsDoaLastSyncedAt")),
        "scs_change": _as_sync_value(status.get("scsChangeLastSyncedAt")),
    }
    return [
        {
            "key": key,
            "name": name,
            "collection": "",
            "lastSyncedAt": values[source],
            "latestDataAt": None,
        }
        for key, name, source in (
            ("sales-orders", "SAP 销售订单（网关）", "sales_orders"),
            ("hana-repair", "SAP HANA 维修记录（网关）", "faults"),
            ("hana-station", "SAP HANA 过站记录（网关）", "stations"),
            ("hana-bindings", "SAP HANA 序列绑定（网关）", "bindings"),
            ("hana-bom", "SAP HANA 订单 BOM（网关）", "bom"),
            ("scs-doa", "SCS DOA 服务单（网关）", "scs_doa"),
            ("scs-change", "SCS 换上换下（网关）", "scs_change"),
        )
    ]


async def record_page_view(db: Any, itcode: str, path: str) -> None:
    if module_from_path(path) == "home":
        return
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


async def build_operations_dashboard(
    db: Any, days: int, activity_page: int = 1, activity_page_size: int = 20
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    local_today = now.astimezone(DISPLAY_TZ).date()
    current_start_local = datetime.combine(
        local_today - timedelta(days=days - 1), time.min, tzinfo=DISPLAY_TZ
    )
    current_start = current_start_local.astimezone(timezone.utc)
    previous_start = (current_start_local - timedelta(days=days)).astimezone(timezone.utc)

    events_cursor = _project(
        db.usage_events.find({"timestamp": {"$gte": previous_start}}),
        {
            "eventType": 1,
            "itcode": 1,
            "module": 1,
            "path": 1,
            "statusCode": 1,
            "durationMs": 1,
            "timestamp": 1,
        },
    )
    sessions_cursor = _project(
        db.sessions.find({"createdAt": {"$gte": previous_start.isoformat()}}),
        {"sessionId": 1, "itcode": 1, "createdAt": 1},
    )
    users_cursor = _project(db.users.find({}), {"itcode": 1, "profile": 1})
    events, sessions, users, total_users, sync_data_sources = await asyncio.gather(
        events_cursor.to_list(length=None),
        sessions_cursor.to_list(length=None),
        users_cursor.to_list(length=None),
        db.users.count_documents({}),
        _sync_data_sources(db),
    )

    def in_period(value: Any, start: datetime, end: datetime) -> bool:
        parsed = _as_datetime(value)
        return parsed is not None and start <= parsed < end

    current_events = [
        e
        for e in events
        if in_period(e.get("timestamp"), current_start, now) and not _is_home_page_view(e)
    ]
    previous_events = [
        e
        for e in events
        if in_period(e.get("timestamp"), previous_start, current_start)
        and not _is_home_page_view(e)
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
        path_module = module_from_path(str(event.get("path", "")))
        module = path_module if path_module != "other" else event.get("module") or "other"
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
                "module": MODULE_LABELS.get(
                    module_from_path(str(event.get("path", "")))
                    if module_from_path(str(event.get("path", ""))) != "other"
                    else str(event.get("module")),
                    "其他功能",
                ),
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
        "recentActivity": recent_items[
            (activity_page - 1) * activity_page_size : activity_page * activity_page_size
        ],
        "activityTotal": len(recent_items),
    }
