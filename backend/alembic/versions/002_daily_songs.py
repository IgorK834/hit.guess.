"""Add daily_songs table for curated daily tracks.

Revision ID: 002_daily_songs
Revises: 001_initial
Create Date: 2026-04-10

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "002_daily_songs"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "daily_songs",
        sa.Column("internal_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tidal_track_id", sa.String(length=64), nullable=False),
        sa.Column("preview_url", sa.String(length=2048), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("artist", sa.String(length=512), nullable=False),
        sa.Column("album_cover", sa.String(length=2048), nullable=False),
        sa.Column("difficulty_level", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("target_date", sa.Date(), nullable=False),
        sa.PrimaryKeyConstraint("internal_id"),
    )
    op.create_index(
        op.f("ix_daily_songs_target_date"),
        "daily_songs",
        ["target_date"],
        unique=True,
    )
    op.create_index(
        op.f("ix_daily_songs_tidal_track_id"),
        "daily_songs",
        ["tidal_track_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_daily_songs_tidal_track_id"), table_name="daily_songs")
    op.drop_index(op.f("ix_daily_songs_target_date"), table_name="daily_songs")
    op.drop_table("daily_songs")
