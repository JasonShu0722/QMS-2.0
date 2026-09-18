from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


UTC = timezone.utc
try:
    BEIJING_TIMEZONE = ZoneInfo("Asia/Shanghai")
except ZoneInfoNotFoundError:
    # Fallback for environments without tzdata installed.
    BEIJING_TIMEZONE = timezone(timedelta(hours=8))


def utc_now_naive() -> datetime:
    """Return a UTC timestamp suitable for naive DB DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


def ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def to_beijing_datetime(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return ensure_utc(dt).astimezone(BEIJING_TIMEZONE)


def serialize_beijing_datetime(dt: datetime | None) -> str | None:
    localized = to_beijing_datetime(dt)
    return localized.isoformat() if localized else None
