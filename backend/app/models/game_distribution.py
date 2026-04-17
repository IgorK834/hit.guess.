from __future__ import annotations

import uuid
from sqlalchemy import Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

class GameDistribution(Base):
    __tablename__ = "game_distributions"

    game_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("daily_songs.internal_id", ondelete="CASCADE"), primary_key=True
    )
    attempt_1: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    attempt_2: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    attempt_3: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    attempt_4: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    attempt_5: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    attempt_6: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
