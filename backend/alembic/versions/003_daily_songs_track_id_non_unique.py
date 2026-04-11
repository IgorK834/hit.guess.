"""Allow repeating tidal_track_id after cooldown (non-unique index).

Revision ID: 003_track_nonunique
Revises: 002_daily_songs
Create Date: 2026-04-10

"""

from typing import Sequence, Union

from alembic import op

revision: str = "003_track_nonunique"
down_revision: Union[str, None] = "002_daily_songs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(op.f("ix_daily_songs_tidal_track_id"), table_name="daily_songs")
    op.create_index(
        op.f("ix_daily_songs_tidal_track_id"),
        "daily_songs",
        ["tidal_track_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_daily_songs_tidal_track_id"), table_name="daily_songs")
    op.create_index(
        op.f("ix_daily_songs_tidal_track_id"),
        "daily_songs",
        ["tidal_track_id"],
        unique=True,
    )
