from __future__ import annotations

import logging
from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.config import settings

logger = logging.getLogger(__name__)

POLAND_TZ_FALLBACK = "Europe/Warsaw"


def get_service_timezone() -> ZoneInfo:
    """Resolve the configured business timezone (defaults to Poland / Warsaw)."""
    try:
        return ZoneInfo(settings.scheduler_timezone)
    except ZoneInfoNotFoundError:
        logger.error(
            "Invalid SCHEDULER_TIMEZONE=%r; falling back to %s",
            settings.scheduler_timezone,
            POLAND_TZ_FALLBACK,
        )
        return ZoneInfo(POLAND_TZ_FALLBACK)


def service_local_today() -> date:
    """Current calendar date in the service timezone (midnight job + DB `target_date` alignment)."""
    return datetime.now(get_service_timezone()).date()


def calendar_today_in_zone(timezone_name: str | None) -> date:
    if not timezone_name:
        return service_local_today()
    name = timezone_name.strip()
    if not name or len(name) > 80:
        return service_local_today()
    try:
        return datetime.now(ZoneInfo(name)).date()
    except ZoneInfoNotFoundError:
        logger.info("Unknown client timezone %r; using service-local date", name)
        return service_local_today()
