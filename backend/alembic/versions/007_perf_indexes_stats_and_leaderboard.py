"""Add performance indexes for stats and leaderboard.

Revision ID: 007_perf_indexes
Revises: b9cb21031ca2
Create Date: 2026-04-18

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "007_perf_indexes"
down_revision: Union[str, None] = "b9cb21031ca2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # a) Index on game_distributions.game_id (requested explicitly; PK already exists but keep as separate index).
    op.create_index(
        "ix_game_distributions_game_id",
        "game_distributions",
        ["game_id"],
        unique=False,
    )

    # b) Composite index for leaderboard sorting/filtering: (game_date, attempts_used, created_at)
    op.create_index(
        "ix_leaderboard_entries_game_date_attempts_created",
        "leaderboard_entries",
        ["game_date", "attempts_used", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_leaderboard_entries_game_date_attempts_created", table_name="leaderboard_entries")
    op.drop_index("ix_game_distributions_game_id", table_name="game_distributions")

