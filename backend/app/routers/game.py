from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.core.datetime_utils import calendar_today_in_zone
from app.deps import DbSession
from app.models.daily_song import DailySong

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
