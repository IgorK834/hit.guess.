from __future__ import annotations

import logging
import uuid
from datetime import date
from datetime import datetime
from typing import Annotated, Literal

import httpx
import redis.asyncio as redis
from fastapi import APIRouter, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import extract, select
from sqlalchemy.exc import IntegrityError

from app.core.datetime_utils import calendar_today_in_zone
from app.deps import DbSession, HttpClient, RedisClient, TidalAuth
from app.models.daily_song import DailySong
from app.models.leaderboard import LeaderboardEntry

from sqlalchemy.dialects.postgresql import insert as pg_insert
from app.models.game_distribution import GameDistribution

from app.services.daily_selector import (
    DailyMusicCategory,
    ensure_daily_song_for_category,
)
from app.services.game_guess_state import (
    apply_guess,
    game_state_redis_key,
    score_for_win,
)
from app.services.tidal_auth import TidalAuthError, TidalAuthService
from app.core.config import settings
from app.services.tidal_openapi import fetch_preview_manifest_uri, fetch_track_display_metadata

logger = logging.getLogger(__name__)

router = APIRouter(tags=["game"])

_DAILY_GEN_LOCK_SEC = 55
_DAILY_GEN_LOCK_BLOCK_SEC = 50
_TERMINAL_IP_MARK_TTL_SEC = 8 * 24 * 3600

# TIDAL preview manifest URLs are short-lived; caching avoids ~1s OpenAPI round-trip on every GET /daily.
_PREVIEW_MANIFEST_CACHE_PREFIX = "tidal:preview_manifest:v1:"
_PREVIEW_MANIFEST_CACHE_TTL_SEC = 900  # 15 minutes — balance freshness vs latency


async def _resolve_preview_manifest_url(
    redis_client: redis.Redis,
    tidal_auth: TidalAuthService,
    http: httpx.AsyncClient,
    *,
    tidal_track_id: str,
    stored_preview_url: str,
) -> str:
    cache_key = f"{_PREVIEW_MANIFEST_CACHE_PREFIX}{tidal_track_id}"
    try:
        cached = await redis_client.get(cache_key)
        if isinstance(cached, str) and cached.strip():
            return cached.strip()
    except Exception as exc:
        logger.warning("Preview manifest cache read failed track_id=%s err=%s", tidal_track_id, exc)

    try:
        token = await tidal_auth.get_access_token()
    except TidalAuthError:
        logger.warning(
            "TIDAL auth failed; returning stored preview_url (may be expired) track_id=%s",
            tidal_track_id,
        )
        return stored_preview_url

    fresh = await fetch_preview_manifest_uri(http, token, tidal_track_id)
    if not fresh:
        logger.warning(
            "Could not refresh preview manifest; stored URL may 403 track_id=%s",
            tidal_track_id,
        )
        return stored_preview_url

    try:
        await redis_client.setex(cache_key, _PREVIEW_MANIFEST_CACHE_TTL_SEC, fresh)
    except Exception as exc:
        logger.warning("Preview manifest cache write failed track_id=%s err=%s", tidal_track_id, exc)
    return fresh


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    if request.client is not None:
        return request.client.host
    return "unknown"


def _daily_terminal_ip_redis_key(game_date: date, category_slug: str, ip: str) -> str:
    return f"hitguess:daily_terminal:{game_date.isoformat()}:{category_slug}:{ip}"

# UI pill labels (exact match) → DB `daily_songs.category` slug.
_UI_CATEGORY_TO_ENUM: dict[str, DailyMusicCategory] = {
    "RAP": DailyMusicCategory.RAP,
    "POPULARNE": DailyMusicCategory.POPULARNE,
    "POP": DailyMusicCategory.POP,
    "POLSKIE KLASYKI": DailyMusicCategory.POLSKIE_KLASYKI,
    "KLASYKI ŚWIATA": DailyMusicCategory.KLASYKI_SWIAT,
}


def _parse_ui_category(raw: str | None) -> DailyMusicCategory:
    if raw is None:
        return DailyMusicCategory.POP
    key = raw.strip()
    if not key:
        return DailyMusicCategory.POP
    cat = _UI_CATEGORY_TO_ENUM.get(key)
    if cat is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid category.",
        )
    return cat


class DailyGameResponse(BaseModel):
    """Public daily round payload — no answer metadata before the round ends."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "game_id": "550e8400-e29b-41d4-a716-446655440000",
                "preview_url": "https://example.com/preview.m3u8",
            }
        }
    )

    game_id: uuid.UUID = Field(description="Opaque id for this daily round (not the TIDAL track id).")
    preview_url: str


class CalendarMonthResponse(BaseModel):
    available_dates: list[str] = Field(
        description="Dates (YYYY-MM-DD) that have generated games for the requested month/category.",
    )


@router.get(
    "/calendar",
    response_model=CalendarMonthResponse,
    summary="Available calendar dates for a month/category",
)
async def get_calendar_month(
    db: DbSession,
    year: Annotated[int, Query(ge=2000, le=2100)],
    month: Annotated[int, Query(ge=1, le=12)],
    category: Annotated[
        str | None,
        Query(description="Category pill label, e.g. POP, RAP, POLSKIE KLASYKI."),
    ] = None,
    x_client_timezone: Annotated[
        str | None,
        Header(
            alias="X-Client-Timezone",
            description="IANA timezone for the user's local calendar day (e.g. Europe/Warsaw).",
        ),
    ] = None,
) -> CalendarMonthResponse:
    today = calendar_today_in_zone(x_client_timezone)
    music_category = _parse_ui_category(category)

    result = await db.execute(
        select(DailySong.target_date)
        .where(
            DailySong.category == music_category.value,
            DailySong.target_date <= today,
            extract("year", DailySong.target_date) == year,
            extract("month", DailySong.target_date) == month,
        )
        .order_by(DailySong.target_date.asc())
    )

    available_dates = [d.isoformat() for d in result.scalars().all()]
    return CalendarMonthResponse(available_dates=available_dates)


@router.get(
    "/daily",
    response_model=DailyGameResponse,
    summary="Today's game (safe fields only)",
)
async def get_daily_game(
    db: DbSession,
    redis: RedisClient,
    tidal_auth: TidalAuth,
    http: HttpClient,
    category: Annotated[
        str | None,
        Query(description="Category pill label, e.g. POP, RAP, POLSKIE KLASYKI."),
    ] = None,
    date_param: Annotated[
        str | None,
        Query(alias="date", description="Archive date override (YYYY-MM-DD)."),
    ] = None,
    x_client_timezone: Annotated[
        str | None,
        Header(
            alias="X-Client-Timezone",
            description="IANA timezone for the user's local calendar day (e.g. Europe/Warsaw).",
        ),
    ] = None,
) -> DailyGameResponse:
    today = calendar_today_in_zone(x_client_timezone)
    target_day = today
    if date_param:
        try:
            parsed = datetime.strptime(date_param.strip(), "%Y-%m-%d").date()
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid date format (expected YYYY-MM-DD).",
            ) from exc
        target_day = parsed
    music_category = _parse_ui_category(category)
    result = await db.execute(
        select(DailySong).where(
            DailySong.target_date == target_day,
            DailySong.category == music_category.value,
        ),
    )
    row = result.scalar_one_or_none()
    if row is None:
        lock_key = f"lock:daily_song_generation:{target_day.isoformat()}:{music_category.value}"
        lock = redis.lock(
            lock_key,
            timeout=_DAILY_GEN_LOCK_SEC,
            blocking_timeout=_DAILY_GEN_LOCK_BLOCK_SEC,
        )
        async with lock:
            result = await db.execute(
                select(DailySong).where(
                    DailySong.target_date == target_day,
                    DailySong.category == music_category.value,
                ),
            )
            row = result.scalar_one_or_none()
            if row is None:
                await ensure_daily_song_for_category(
                    db,
                    tidal_auth,
                    http,
                    target_date=target_day,
                    music_category=music_category,
                )
                result = await db.execute(
                    select(DailySong).where(
                        DailySong.target_date == target_day,
                        DailySong.category == music_category.value,
                    ),
                )
                row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No daily song configured for requested day.",
        )
    # Stored `preview_url` contains time-limited tokens; TIDAL returns 403 when they expire.
    preview_url = await _resolve_preview_manifest_url(
        redis,
        tidal_auth,
        http,
        tidal_track_id=row.tidal_track_id,
        stored_preview_url=row.preview_url,
    )

    return DailyGameResponse(
        game_id=row.internal_id,
        preview_url=preview_url,
    )



class GameStatsResponse(BaseModel):
    distribution: dict[str, int]
    total_wins: int

@router.get(
    "/{game_id}/stats",
    response_model=GameStatsResponse,
    summary="Global guess distribution for a specific game",
)
async def get_game_stats(
    game_id: uuid.UUID,
    db: DbSession,
) -> GameStatsResponse:
    result = await db.execute(select(GameDistribution).where(GameDistribution.game_id == game_id))
    dist = result.scalar_one_or_none()
    if not dist:
        return GameStatsResponse(
            distribution={"1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0},
            total_wins=0,
        )
    d = {
        "1": dist.attempt_1,
        "2": dist.attempt_2,
        "3": dist.attempt_3,
        "4": dist.attempt_4,
        "5": dist.attempt_5,
        "6": dist.attempt_6,
    }
    total = sum(d.values())
    return GameStatsResponse(distribution=d, total_wins=total)

class GuessRequest(BaseModel):

    session_id: uuid.UUID
    game_id: uuid.UUID
    guessed_tidal_track_id: str = Field(min_length=1, max_length=64)

class TrackDetails(BaseModel):
    title: str
    artist: str
    album_cover: str


class GuessResponse(BaseModel):
    is_correct: bool
    attempts_used: int
    game_status: Literal["PLAYING", "WON", "LOST"]
    track_details: TrackDetails | None = None

@router.post(
    "/guess",
    response_model=GuessResponse,
    summary="Submit a guess (server-tracked attempts, anti-cheat)",
)
async def submit_guess(
    request: Request,
    body: GuessRequest,
    db: DbSession,
    redis: RedisClient,
    tidal_auth: TidalAuth,
    http: HttpClient,
) -> GuessResponse:
    result = await db.execute(select(DailySong).where(DailySong.internal_id == body.game_id))
    daily = result.scalar_one_or_none()
    if daily is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown game.")

    guessed = body.guessed_tidal_track_id.strip()
    state_key = game_state_redis_key(body.session_id, body.game_id)
    gs = await apply_guess(
        redis,
        state_key,
        guessed_tidal_track_id=guessed,
        correct_tidal_track_id=daily.tidal_track_id,
    )

    client_ip = _client_ip(request)
    is_first_terminal_for_ip = False
    if gs.status in ("WON", "LOST"):
        tkey = _daily_terminal_ip_redis_key(daily.target_date, daily.category, client_ip)
        is_first_terminal_for_ip = bool(
            await redis.set(tkey, "1", ex=_TERMINAL_IP_MARK_TTL_SEC, nx=True),
        )

    if gs.won_transition:
        # Global stats should count every win transition (not only leaderboard-eligible IPs).
        attempts_clamped = min(max(gs.attempts, 1), 6)
        col_name = f"attempt_{attempts_clamped}"
        stmt = pg_insert(GameDistribution).values(game_id=daily.internal_id, **{col_name: 1})
        stmt = stmt.on_conflict_do_update(
            index_elements=["game_id"],
            set_={col_name: getattr(GameDistribution, col_name) + 1},
        )
        await db.execute(stmt)
        await db.commit()

        if not is_first_terminal_for_ip:
            logger.info(
                "Leaderboard skip (IP already finished this daily category): ip=%s game_date=%s category=%s session=%s",
                client_ip,
                daily.target_date,
                daily.category,
                body.session_id,
            )
        else:
            entry = LeaderboardEntry(
                session_id=body.session_id,
                username=None,
                score=score_for_win(gs.attempts),
                attempts_used=gs.attempts,
                game_date=daily.target_date,
            )
            db.add(entry)
            try:
                await db.commit()
            except IntegrityError:
                await db.rollback()
                logger.info(
                    "Duplicate leaderboard row for session=%s game_date=%s (idempotent win)",
                    body.session_id,
                    daily.target_date,
                )

    details: TrackDetails | None = None
    if gs.status in ("WON", "LOST"):
        cover = daily.album_cover
        # If daily seed stored a placeholder (or cover parsing failed), resolve cover art live.
        # This does NOT reveal the answer early — it only runs for terminal rounds.
        if cover == settings.tidal_placeholder_cover_url or "placehold.co" in (cover or ""):
            try:
                token = await tidal_auth.get_access_token()
                meta = await fetch_track_display_metadata(
                    http,
                    token,
                    daily.tidal_track_id,
                    country_code=settings.tidal_country_code,
                )
                if meta is not None:
                    _, _, resolved_cover = meta
                    if resolved_cover and resolved_cover != settings.tidal_placeholder_cover_url:
                        cover = resolved_cover
            except Exception:
                logger.debug("Could not resolve cover art for terminal round", exc_info=True)
        details = TrackDetails(
            title=daily.title,
            artist=daily.artist,
            album_cover=cover,
        )

    assert gs.status in ("PLAYING", "WON", "LOST")
    return GuessResponse(
        is_correct=gs.last_guess_correct,
        attempts_used=gs.attempts,
        game_status=gs.status,
        track_details=details,
    )
