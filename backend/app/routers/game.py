from __future__ import annotations

import logging
import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.datetime_utils import calendar_today_in_zone
from app.deps import DbSession, HttpClient, RedisClient, TidalAuth
from app.models.daily_song import DailySong
from app.models.leaderboard import LeaderboardEntry
from app.services.daily_selector import (
    DailyMusicCategory,
    ensure_daily_song_for_category,
)
from app.services.game_guess_state import (
    apply_guess,
    game_state_redis_key,
    score_for_win,
)
from app.services.tidal_auth import TidalAuthError
from app.core.config import settings
from app.services.tidal_openapi import fetch_preview_manifest_uri, fetch_track_display_metadata

logger = logging.getLogger(__name__)

router = APIRouter(tags=["game"])

_DAILY_GEN_LOCK_SEC = 55
_DAILY_GEN_LOCK_BLOCK_SEC = 50
_TERMINAL_IP_MARK_TTL_SEC = 8 * 24 * 3600


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
    x_client_timezone: Annotated[
        str | None,
        Header(
            alias="X-Client-Timezone",
            description="IANA timezone for the user's local calendar day (e.g. Europe/Warsaw).",
        ),
    ] = None,
) -> DailyGameResponse:
    today = calendar_today_in_zone(x_client_timezone)
    music_category = _parse_ui_category(category)
    result = await db.execute(
        select(DailySong).where(
            DailySong.target_date == today,
            DailySong.category == music_category.value,
        ),
    )
    row = result.scalar_one_or_none()
    if row is None:
        lock_key = f"lock:daily_song_generation:{today.isoformat()}:{music_category.value}"
        lock = redis.lock(
            lock_key,
            timeout=_DAILY_GEN_LOCK_SEC,
            blocking_timeout=_DAILY_GEN_LOCK_BLOCK_SEC,
        )
        async with lock:
            result = await db.execute(
                select(DailySong).where(
                    DailySong.target_date == today,
                    DailySong.category == music_category.value,
                ),
            )
            row = result.scalar_one_or_none()
            if row is None:
                await ensure_daily_song_for_category(
                    db,
                    tidal_auth,
                    http,
                    target_date=today,
                    music_category=music_category,
                )
                result = await db.execute(
                    select(DailySong).where(
                        DailySong.target_date == today,
                        DailySong.category == music_category.value,
                    ),
                )
                row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No daily song configured for today.",
        )
    # Stored `preview_url` contains time-limited tokens; TIDAL returns 403 when they expire.
    preview_url = row.preview_url
    try:
        token = await tidal_auth.get_access_token()
    except TidalAuthError:
        logger.warning(
            "TIDAL auth failed; returning stored preview_url (may be expired) track_id=%s",
            row.tidal_track_id,
        )
    else:
        fresh = await fetch_preview_manifest_uri(
            http,
            token,
            row.tidal_track_id,
        )
        if fresh:
            preview_url = fresh
        else:
            logger.warning(
                "Could not refresh preview manifest; stored URL may 403 track_id=%s",
                row.tidal_track_id,
            )

    return DailyGameResponse(
        game_id=row.internal_id,
        preview_url=preview_url,
    )


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
