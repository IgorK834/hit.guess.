from __future__ import annotations

import logging
from datetime import date
from typing import TYPE_CHECKING

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.datetime_utils import get_service_timezone, service_local_today
from app.db.session import AsyncSessionLocal
from app.services.daily_selector import run_daily_song_selection
from app.services.tidal_auth import TidalAuthService

if TYPE_CHECKING:
    from fastapi import FastAPI

logger = logging.getLogger(__name__)


def scheduler_today() -> date:
    return service_local_today()


def setup_scheduler(app: FastAPI) -> AsyncIOScheduler:
    tz = get_service_timezone()
    scheduler = AsyncIOScheduler(timezone=tz)

    async def daily_song_job() -> None:
        try:
            redis = app.state.redis
            http = app.state.http_client
        except AttributeError:
            logger.error("Scheduler job skipped: application state is not ready")
            return

        try:
            auth = TidalAuthService(redis, http)
            day = scheduler_today()
            async with AsyncSessionLocal() as session:
                await run_daily_song_selection(session, auth, http, target_date=day)
        except Exception:
            logger.exception("Daily song scheduler job failed")

    scheduler.add_job(
        daily_song_job,
        CronTrigger(hour=0, minute=0, timezone=tz),
        id="hitguess_daily_song_selection",
        replace_existing=True,
        misfire_grace_time=3600,
        coalesce=True,
        max_instances=1,
    )
    return scheduler
