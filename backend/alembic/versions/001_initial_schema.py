"""Create users, songs, and game_stats tables.

Revision ID: 001_initial
Revises:
Create Date: 2026-04-10

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_table(
        "songs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tidal_track_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("artist", sa.String(length=512), nullable=False),
        sa.Column("preview_url", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_songs_tidal_track_id"),
        "songs",
        ["tidal_track_id"],
        unique=True,
    )
    op.create_table(
        "game_stats",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("song_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("game_date", sa.Date(), nullable=False),
        sa.Column("attempts_used", sa.SmallInteger(), nullable=False),
        sa.Column("solved", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["song_id"], ["songs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_game_stats_game_date"), "game_stats", ["game_date"], unique=False)
    op.create_index(op.f("ix_game_stats_song_id"), "game_stats", ["song_id"], unique=False)
    op.create_index(op.f("ix_game_stats_user_id"), "game_stats", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_game_stats_user_id"), table_name="game_stats")
    op.drop_index(op.f("ix_game_stats_song_id"), table_name="game_stats")
    op.drop_index(op.f("ix_game_stats_game_date"), table_name="game_stats")
    op.drop_table("game_stats")
    op.drop_index(op.f("ix_songs_tidal_track_id"), table_name="songs")
    op.drop_table("songs")
    op.drop_table("users")
