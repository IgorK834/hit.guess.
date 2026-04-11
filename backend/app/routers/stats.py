from __future__ import annotations

import uuid
from datetime import date, datetime

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.core.datetime_utils import service_local_today
from app.deps import DbSession
from app.models.leaderboard import LeaderboardEntry

router = APIRouter(tags=["stats"])


class LeaderboardItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str | None = None
    score: int = Field(description="Higher is better; derived from attempts on win.")
    attempts_used: int
    game_date: date
    created_at: datetime


@router.get(
    "/leaderboard",
    response_model=list[LeaderboardItem],
    summary="Top scores for today (service calendar day)",
)
async def get_leaderboard(db: DbSession) -> list[LeaderboardEntry]:
    today = service_local_today()
    result = await db.execute(
        select(LeaderboardEntry)
        .where(LeaderboardEntry.game_date == today)
        .order_by(LeaderboardEntry.attempts_used.asc(), LeaderboardEntry.created_at.asc())
        .limit(50)
    )
    return list(result.scalars().all())
