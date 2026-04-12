from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DailySong(Base):
    __tablename__ = "daily_songs"
    __table_args__ = (
        UniqueConstraint("target_date", "category", name="uq_daily_songs_date_category"),
    )

    internal_id: Mapped[uuid.UUID] = mapped_column(
        "internal_id",
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    tidal_track_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    preview_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    artist: Mapped[str] = mapped_column(String(512), nullable=False)
    album_cover: Mapped[str] = mapped_column(String(2048), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    target_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    category: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
