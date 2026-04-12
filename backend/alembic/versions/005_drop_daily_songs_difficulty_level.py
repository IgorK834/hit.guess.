"""Remove difficulty_level from daily_songs.

Revision ID: 005_drop_difficulty
Revises: 004_leaderboard_entries
Create Date: 2026-04-11

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005_drop_difficulty"
down_revision: Union[str, None] = "004_leaderboard_entries"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("daily_songs", "difficulty_level")


def downgrade() -> None:
    op.add_column(
        "daily_songs",
        sa.Column(
            "difficulty_level",
            sa.Integer(),
            server_default="1",
            nullable=False,
        ),
    )
