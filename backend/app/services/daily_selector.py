from __future__ import annotations

import logging
import random
from dataclasses import dataclass
from datetime import date, timedelta
from enum import StrEnum

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.datetime_utils import service_local_today
from app.models.daily_song import DailySong
import app.services.tidal_openapi as tidal_openapi
from app.services.tidal_auth import TidalAuthError, TidalAuthService

logger = logging.getLogger(__name__)

# Rolling window: do not pick a `tidal_track_id` that was already a daily pick in this many days.
TRACK_REUSE_COOLDOWN_DAYS = 365


class DailyMusicCategory(StrEnum):
    RAP = "rap"
    POPULARNE = "popularne"
    POP = "pop"
    POLSKIE_KLASYKI = "polskie klasyki"
    KLASYKI_SWIAT = "klasyki świat"


@dataclass(frozen=True, slots=True)
class CategorySource:
    """Maps a game category to TIDAL catalogue discovery inputs."""

    search_query: str
    playlist_id: str | None = None


CATEGORY_POOL: dict[DailyMusicCategory, CategorySource] = {
    DailyMusicCategory.RAP: CategorySource(
        search_query="rap",
        playlist_id=None,
    ),
    DailyMusicCategory.POPULARNE: CategorySource(
        search_query="popularne hity",
        playlist_id=None,
    ),
    DailyMusicCategory.POP: CategorySource(
        search_query="pop",
        playlist_id=None,
    ),
    DailyMusicCategory.POLSKIE_KLASYKI: CategorySource(
        search_query="polskie klasyki",
        playlist_id=None,
    ),
    DailyMusicCategory.KLASYKI_SWIAT: CategorySource(
        search_query="klasyki muzyki świata",
        playlist_id=None,
    ),
}


@dataclass(frozen=True, slots=True)
class DailyTrackCandidate:
    tidal_track_id: str
    preview_url: str
    title: str
    artist: str
    album_cover: str


async def _collect_track_ids_for_category(
    http: httpx.AsyncClient,
    token: str,
    source: CategorySource,
) -> list[str]:
    if source.playlist_id:
        return await tidal_openapi.playlist_track_ids(
            http,
            token,
            source.playlist_id,
            country_code=settings.tidal_country_code,
        )
    return await tidal_openapi.search_track_ids_for_query(
        http,
        token,
        source.search_query,
        country_code=settings.tidal_country_code,
    )


async def fetch_daily_candidate_for_category(
    category: DailyMusicCategory,
    auth: TidalAuthService,
    http: httpx.AsyncClient,
    *,
    excluded_track_ids: frozenset[str],
) -> DailyTrackCandidate | None:
    """Return one eligible track for a fixed category with a PREVIEW manifest, or None."""
    try:
        token = await auth.get_access_token()
    except TidalAuthError:
        logger.exception("Daily selector could not obtain TIDAL access token")
        return None

    source = CATEGORY_POOL[category]
    track_ids = await _collect_track_ids_for_category(http, token, source)
    if not track_ids:
        logger.warning("No track ids returned for category=%s", category.value)
        return None

    for track_id in tidal_openapi.shuffled_copy(track_ids):
        if track_id in excluded_track_ids:
            continue
        preview_url = await tidal_openapi.fetch_preview_manifest_uri(http, token, track_id)
        if not preview_url:
            continue
        meta = await tidal_openapi.fetch_track_display_metadata(
            http,
            token,
            track_id,
            country_code=settings.tidal_country_code,
        )
        if not meta:
            continue
        title, artist, cover = meta
        return DailyTrackCandidate(
            tidal_track_id=track_id,
            preview_url=preview_url,
            title=title,
            artist=artist,
            album_cover=cover,
        )

    logger.warning(
        "Could not resolve a preview-backed track for category=%s after scanning candidates",
        category.value,
    )
    return None


async def fetch_daily_candidate(
    auth: TidalAuthService,
    http: httpx.AsyncClient,
    *,
    excluded_track_ids: frozenset[str],
) -> DailyTrackCandidate | None:
    """Return one random eligible track with a PREVIEW manifest, or None."""
    category = random.choice(list(DailyMusicCategory))
    return await fetch_daily_candidate_for_category(
        category,
        auth,
        http,
        excluded_track_ids=excluded_track_ids,
    )


async def _track_ids_in_last_days(
    session: AsyncSession,
    *,
    as_of: date,
    days: int = TRACK_REUSE_COOLDOWN_DAYS,
) -> set[str]:
    start = as_of - timedelta(days=days)
    rows = await session.scalars(
        select(DailySong.tidal_track_id).where(DailySong.target_date >= start),
    )
    return set(rows.all())


async def _track_ids_used_on_calendar_date(
    session: AsyncSession,
    *,
    target_date: date,
) -> set[str]:
    """All picks on this calendar day (every category)."""
    rows = await session.scalars(
        select(DailySong.tidal_track_id).where(DailySong.target_date == target_date),
    )
    return set(rows.all())


async def _track_ids_in_last_days_same_category(
    session: AsyncSession,
    *,
    as_of: date,
    music_category: DailyMusicCategory,
    days: int = TRACK_REUSE_COOLDOWN_DAYS,
) -> set[str]:
    """Rolling window, **this category only** — legacy behaviour allows the same track in two categories."""
    start = as_of - timedelta(days=days)
    rows = await session.scalars(
        select(DailySong.tidal_track_id).where(
            DailySong.target_date >= start,
            DailySong.category == music_category.value,
        ),
    )
    return set(rows.all())


async def _track_ids_used_by_other_categories(
    session: AsyncSession,
    *,
    music_category: DailyMusicCategory,
) -> set[str]:
    """Any `tidal_track_id` already assigned to a different music category (any date)."""
    rows = await session.scalars(
        select(DailySong.tidal_track_id).where(DailySong.category != music_category.value),
    )
    return set(rows.all())


async def ensure_daily_song_for_category(
    session: AsyncSession,
    auth: TidalAuthService,
    http: httpx.AsyncClient,
    *,
    target_date: date,
    music_category: DailyMusicCategory,
    max_rounds: int = 48,
) -> bool:
    """
    Ensure one `DailySong` row exists for (`target_date`, `music_category`).

    Exclusion rules depend on `settings.strict_category_logic` (see `STRICT_CATEGORY_LOGIC` env).

    Returns True when a row exists after the call (created or already present).
    """
    existing = await session.scalar(
        select(DailySong).where(
            DailySong.target_date == target_date,
            DailySong.category == music_category.value,
        ),
    )
    if existing is not None:
        return True

    inserted = False
    for round_idx in range(max_rounds):
        if settings.strict_category_logic:
            cooldown_ids = await _track_ids_in_last_days(
                session,
                as_of=target_date,
                days=TRACK_REUSE_COOLDOWN_DAYS,
            )
            same_day_ids = await _track_ids_used_on_calendar_date(
                session,
                target_date=target_date,
            )
            other_category_ids = await _track_ids_used_by_other_categories(
                session,
                music_category=music_category,
            )
            excluded = frozenset(cooldown_ids | same_day_ids | other_category_ids)
        else:
            same_category_ids = await _track_ids_in_last_days_same_category(
                session,
                as_of=target_date,
                music_category=music_category,
                days=TRACK_REUSE_COOLDOWN_DAYS,
            )
            excluded = frozenset(same_category_ids)
        candidate = await fetch_daily_candidate_for_category(
            music_category,
            auth,
            http,
            excluded_track_ids=excluded,
        )
        if candidate is None:
            logger.warning(
                "Daily selection round %s category=%s produced no candidate",
                round_idx + 1,
                music_category.value,
            )
            continue

        if candidate.tidal_track_id in excluded:
            continue

        row = DailySong(
            tidal_track_id=candidate.tidal_track_id,
            preview_url=candidate.preview_url,
            title=candidate.title,
            artist=candidate.artist,
            album_cover=candidate.album_cover,
            target_date=target_date,
            category=music_category.value,
        )
        session.add(row)
        try:
            await session.commit()
            logger.info(
                "Stored daily song for %s category=%s track=%s title=%r",
                target_date.isoformat(),
                music_category.value,
                candidate.tidal_track_id,
                candidate.title,
            )
            inserted = True
            break
        except IntegrityError:
            await session.rollback()
            logger.info(
                "Daily song insert raced (target_date=%s category=%s track=%s); reloading",
                target_date.isoformat(),
                music_category.value,
                candidate.tidal_track_id,
            )
            existing2 = await session.scalar(
                select(DailySong).where(
                    DailySong.target_date == target_date,
                    DailySong.category == music_category.value,
                ),
            )
            if existing2 is not None:
                inserted = True
                break

    if not inserted:
        logger.error(
            "Failed to select daily song for %s category=%s after %s rounds",
            target_date,
            music_category.value,
            max_rounds,
        )
        return False
    return True


async def run_daily_song_selection(
    session: AsyncSession,
    auth: TidalAuthService,
    http: httpx.AsyncClient,
    *,
    target_date: date | None = None,
    max_rounds: int = 48,
) -> bool:
    """
    Ensure a `DailySong` row exists for each music category on `target_date` (scheduler TZ calendar day).

    Skips tracks according to `settings.strict_category_logic` (global vs per-category window),
    and skips any TIDAL result whose preview manifest is not `PREVIEW`.

    Returns True when every category has a row after the call (or already had one).
    """
    if target_date is None:
        target_date = service_local_today()

    all_ok = True
    for music_category in DailyMusicCategory:
        ok = await ensure_daily_song_for_category(
            session,
            auth,
            http,
            target_date=target_date,
            music_category=music_category,
            max_rounds=max_rounds,
        )
        all_ok = all_ok and ok

    return all_ok
