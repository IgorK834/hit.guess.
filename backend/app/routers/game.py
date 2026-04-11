from __future__ import annotations

import logging
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.datetime_utils import calendar_today_in_zone
from app.deps import DbSession, RedisClient
from app.models.daily_song import DailySong
from app.models.leaderboard import LeaderboardEntry
from app.services.game_guess_state import (
    apply_guess,
    game_state_redis_key,
    score_for_win,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["game"])


class DailyGameResponse(BaseModel):
    """Public daily round payload — no answer metadata before the round ends."""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "game_id": "550e8400-e29b-41d4-a716-446655440000",
                "preview_url": "https://example.com/preview.m3u8",
                "difficulty_level": 1,
            }
        }
    )

    game_id: uuid.UUID = Field(description="Opaque id for this daily round (not the TIDAL track id).")
    preview_url: str
    difficulty_level: int


@router.get(
    "/daily",
    response_model=DailyGameResponse,
    summary="Today's game (safe fields only)",
)
async def get_daily_game(
    db: DbSession,
    x_client_timezone: Annotated[
        str | None,
        Header(
            alias="X-Client-Timezone",
            description="IANA timezone for the user's local calendar day (e.g. Europe/Warsaw).",
        ),
    ] = None,
) -> DailyGameResponse:
    today = calendar_today_in_zone(x_client_timezone)
    result = await db.execute(select(DailySong).where(DailySong.target_date == today))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No daily song configured for today.",
        )
    return DailyGameResponse(
        game_id=row.internal_id,
        preview_url=row.preview_url,
        difficulty_level=row.difficulty_level,
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
    body: GuessRequest,
    db: DbSession,
    redis: RedisClient,
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

    if gs.won_transition:
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
        details = TrackDetails(
            title=daily.title,
            artist=daily.artist,
            album_cover=daily.album_cover,
        )

    assert gs.status in ("PLAYING", "WON", "LOST")
    return GuessResponse(
        is_correct=gs.last_guess_correct,
        attempts_used=gs.attempts,
        game_status=gs.status,
        track_details=details,
    )
