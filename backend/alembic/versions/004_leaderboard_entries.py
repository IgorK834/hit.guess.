"""Add leaderboard_entries for daily global scores.

Revision ID: 004_leaderboard_entries
Revises: 003_track_nonunique
Create Date: 2026-04-11

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "004_leaderboard_entries"
down_revision: Union[str, None] = "003_track_nonunique"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "leaderboard_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=True),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("attempts_used", sa.Integer(), nullable=False),
        sa.Column("game_date", sa.Date(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "game_date", name="uq_leaderboard_session_game_date"),
    )
    op.create_index(
        op.f("ix_leaderboard_entries_session_id"),
        "leaderboard_entries",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_leaderboard_entries_game_date"),
        "leaderboard_entries",
        ["game_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_leaderboard_entries_game_date"), table_name="leaderboard_entries")
    op.drop_index(op.f("ix_leaderboard_entries_session_id"), table_name="leaderboard_entries")
    op.drop_table("leaderboard_entries")
