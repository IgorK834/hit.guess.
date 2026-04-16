from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import extract, select

from app.core.config import settings
from app.core.datetime_utils import service_local_today
from app.deps import DbSession, HttpClient, TidalAuth
from app.models.daily_song import DailySong
from app.services.daily_selector import DailyMusicCategory
from app.services.tidal_auth import TidalAuthError
from app.services.tidal_openapi import fetch_preview_manifest_uri, fetch_track_display_metadata

router = APIRouter(tags=["admin"])

_UI_CATEGORY_TO_ENUM: dict[str, DailyMusicCategory] = {
    "RAP": DailyMusicCategory.RAP,
    "POPULARNE": DailyMusicCategory.POPULARNE,
    "POP": DailyMusicCategory.POP,
    "POLSKIE KLASYKI": DailyMusicCategory.POLSKIE_KLASYKI,
    "KLASYKI ŚWIATA": DailyMusicCategory.KLASYKI_SWIAT,
}


def _parse_ui_category(raw: str) -> DailyMusicCategory:
    key = raw.strip()
    cat = _UI_CATEGORY_TO_ENUM.get(key)
    if cat is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid category.",
        )
    return cat


def _require_admin_token(x_admin_token: str | None) -> None:
    expected = settings.admin_token.get_secret_value().strip() if settings.admin_token else ""
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin mode is not configured.",
        )
    provided = (x_admin_token or "").strip()
    if provided != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin token.",
        )


class AssignSongRequest(BaseModel):
    date: date
    category: str = Field(min_length=1, max_length=64)
    tidal_track_id: str = Field(min_length=1, max_length=64)


class AssignSongResponse(BaseModel):
    ok: bool
    date: date
    category: str
    tidal_track_id: str
    title: str
    artist: str


class AdminCalendarMonthResponse(BaseModel):
    assigned_dates: list[str] = Field(
        description="Dates (YYYY-MM-DD) that already have an assigned song for the requested month/category.",
    )


class AdminDaySongResponse(BaseModel):
    exists: bool
    date: date
    category: str
    editable: bool
    tidal_track_id: str | None = None
    title: str | None = None
    artist: str | None = None
    album_cover: str | None = None


class DeleteSongResponse(BaseModel):
    ok: bool
    date: date
    category: str


@router.get(
    "/calendar",
    response_model=AdminCalendarMonthResponse,
    summary="Assigned admin calendar dates for a month/category",
)
async def get_admin_calendar_month(
    db: DbSession,
    year: Annotated[int, Query(ge=2000, le=2100)],
    month: Annotated[int, Query(ge=1, le=12)],
    category: Annotated[str, Query(min_length=1, max_length=64)],
    x_admin_token: Annotated[str | None, Header(alias="X-Admin-Token")] = None,
) -> AdminCalendarMonthResponse:
    _require_admin_token(x_admin_token)
    music_category = _parse_ui_category(category)

    result = await db.execute(
        select(DailySong.target_date)
        .where(
            DailySong.category == music_category.value,
            extract("year", DailySong.target_date) == year,
            extract("month", DailySong.target_date) == month,
        )
        .order_by(DailySong.target_date.asc())
    )
    assigned_dates = [d.isoformat() for d in result.scalars().all()]
    return AdminCalendarMonthResponse(assigned_dates=assigned_dates)


@router.get(
    "/day",
    response_model=AdminDaySongResponse,
    summary="Get assigned song for a specific admin day/category",
)
async def get_admin_day(
    db: DbSession,
    target_date: Annotated[date, Query(alias="date")],
    category: Annotated[str, Query(min_length=1, max_length=64)],
    x_admin_token: Annotated[str | None, Header(alias="X-Admin-Token")] = None,
) -> AdminDaySongResponse:
    _require_admin_token(x_admin_token)
    today = service_local_today()
    music_category = _parse_ui_category(category)

    result = await db.execute(
        select(DailySong).where(
            DailySong.target_date == target_date,
            DailySong.category == music_category.value,
        ),
    )
    row = result.scalar_one_or_none()
    if row is None:
        return AdminDaySongResponse(
            exists=False,
            date=target_date,
            category=category.strip(),
            editable=target_date > today,
        )

    return AdminDaySongResponse(
        exists=True,
        date=target_date,
        category=category.strip(),
        editable=target_date > today,
        tidal_track_id=row.tidal_track_id,
        title=row.title,
        artist=row.artist,
        album_cover=row.album_cover,
    )


@router.post(
    "/assign-song",
    response_model=AssignSongResponse,
    summary="Assign a specific TIDAL song to a day/category",
)
async def assign_song(
    body: AssignSongRequest,
    db: DbSession,
    http: HttpClient,
    tidal_auth: TidalAuth,
    x_admin_token: Annotated[str | None, Header(alias="X-Admin-Token")] = None,
) -> AssignSongResponse:
    _require_admin_token(x_admin_token)
    today = service_local_today()
    if body.date < today:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Past days cannot be edited in admin mode.",
        )

    music_category = _parse_ui_category(body.category)
    track_id = body.tidal_track_id.strip()

    try:
        token = await tidal_auth.get_access_token()
    except TidalAuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not authenticate with TIDAL.",
        ) from exc

    preview_url = await fetch_preview_manifest_uri(http, token, track_id)
    if not preview_url:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Selected TIDAL track does not provide a playable preview.",
        )

    meta = await fetch_track_display_metadata(
        http,
        token,
        track_id,
        country_code=settings.tidal_country_code,
    )
    if meta is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not load track metadata from TIDAL.",
        )
    title, artist, album_cover = meta

    result = await db.execute(
        select(DailySong).where(
            DailySong.target_date == body.date,
            DailySong.category == music_category.value,
        ),
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = DailySong(
            target_date=body.date,
            category=music_category.value,
            tidal_track_id=track_id,
            preview_url=preview_url,
            title=title,
            artist=artist,
            album_cover=album_cover,
        )
        db.add(row)
    else:
        row.tidal_track_id = track_id
        row.preview_url = preview_url
        row.title = title
        row.artist = artist
        row.album_cover = album_cover

    await db.commit()

    return AssignSongResponse(
        ok=True,
        date=body.date,
        category=body.category.strip(),
        tidal_track_id=track_id,
        title=title,
        artist=artist,
    )


@router.delete(
    "/day",
    response_model=DeleteSongResponse,
    summary="Delete an assigned song for a future admin day/category",
)
async def delete_admin_day(
    db: DbSession,
    target_date: Annotated[date, Query(alias="date")],
    category: Annotated[str, Query(min_length=1, max_length=64)],
    x_admin_token: Annotated[str | None, Header(alias="X-Admin-Token")] = None,
) -> DeleteSongResponse:
    _require_admin_token(x_admin_token)
    today = service_local_today()
    if target_date <= today:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only future days can be deleted in admin mode.",
        )

    music_category = _parse_ui_category(category)
    result = await db.execute(
        select(DailySong).where(
            DailySong.target_date == target_date,
            DailySong.category == music_category.value,
        ),
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No assigned song found for this day/category.",
        )

    await db.delete(row)
    await db.commit()

    return DeleteSongResponse(
        ok=True,
        date=target_date,
        category=category.strip(),
    )
