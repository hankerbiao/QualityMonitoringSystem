"""Application timezone helpers."""

from datetime import datetime
from zoneinfo import ZoneInfo

BEIJING_TZ = ZoneInfo("Asia/Shanghai")


def beijing_now() -> datetime:
    """Return the current time in Beijing with timezone information."""
    return datetime.now(BEIJING_TZ)
