"""Add daily_songs.category; unique (target_date, category).

Revision ID: 006_daily_category
Revises: 005_drop_difficulty
Create Date: 2026-04-11

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006_daily_category"
down_revision: Union[str, None] = "005_drop_difficulty"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "daily_songs",
        sa.Column("category", sa.String(length=64), nullable=True),
    )
    op.execute(sa.text("UPDATE daily_songs SET category = 'pop' WHERE category IS NULL"))
    op.alter_column(
        "daily_songs",
        "category",
        existing_type=sa.String(length=64),
        nullable=False,
    )

    op.drop_index(op.f("ix_daily_songs_target_date"), table_name="daily_songs")
    op.create_index(
        op.f("ix_daily_songs_target_date"),
        "daily_songs",
        ["target_date"],
        unique=False,
    )
    op.create_index(
        op.f("ix_daily_songs_category"),
        "daily_songs",
        ["category"],
        unique=False,
    )
    op.create_unique_constraint(
        "uq_daily_songs_date_category",
        "daily_songs",
        ["target_date", "category"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_daily_songs_date_category", "daily_songs", type_="unique")
    op.drop_index(op.f("ix_daily_songs_category"), table_name="daily_songs")
    op.drop_index(op.f("ix_daily_songs_target_date"), table_name="daily_songs")
    op.create_index(
        op.f("ix_daily_songs_target_date"),
        "daily_songs",
        ["target_date"],
        unique=True,
    )
    op.drop_column("daily_songs", "category")
