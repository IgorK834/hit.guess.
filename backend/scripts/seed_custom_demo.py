"""Demo/custom seed for inserting your own songs into `daily_songs`.

Run from the `backend` directory:

    python -m scripts.seed_custom_demo

What to edit:
1. Replace the example rows inside `CUSTOM_SONGS`.
2. Fill in your own:
   - date
   - category
   - tidal_track_id
   - preview_url
   - title
   - artist
   - album_cover

Allowed UI categories in this project (current codebase):
    - "POP"
    - "RAP"
    - "POPULARNE"
    - "POLSKIE KLASYKI"
    - "KLASYKI ŚWIATA"

Important:
- `date` must be in format YYYY-MM-DD.
- `category` should use one of the UI labels above.
- `tidal_track_id` should be the real TIDAL track id used for guess validation.
- `preview_url` should be a working preview/manfiest URL for that track.
- `album_cover` should be a full HTTPS URL (preferably TIDAL CDN).
- This script does NOT fetch anything from TIDAL for you.
- If a row for the same (date, category) already exists, it will be skipped.
"""

from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from dotenv import load_dotenv  # noqa: E402

_REPO_ROOT = _BACKEND_ROOT.parent
if (_REPO_ROOT / ".env").is_file():
    load_dotenv(_REPO_ROOT / ".env", override=False)
if (_BACKEND_ROOT / ".env").is_file():
    load_dotenv(_BACKEND_ROOT / ".env", override=False)
if (_BACKEND_ROOT / ".env.local").is_file():
    load_dotenv(_BACKEND_ROOT / ".env.local", override=True)

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models.daily_song import DailySong  # noqa: E402
from app.services.daily_selector import DailyMusicCategory  # noqa: E402


# Use the labels you know from the frontend pills.
UI_CATEGORY_TO_DB_SLUG: dict[str, str] = {
    "RAP": DailyMusicCategory.RAP.value,
    "POPULARNE": DailyMusicCategory.POPULARNE.value,
    "POP": DailyMusicCategory.POP.value,
    "POLSKIE KLASYKI": DailyMusicCategory.POLSKIE_KLASYKI.value,
    "KLASYKI ŚWIATA": DailyMusicCategory.KLASYKI_SWIAT.value,
}


@dataclass(frozen=True, slots=True)
class CustomSongRow:
    date: str
    category: str
    tidal_track_id: str
    preview_url: str
    title: str
    artist: str
    album_cover: str


# ---------------------------------------------------------------------------
# DEMO DATA
# ---------------------------------------------------------------------------
# Replace these rows with your own songs.
# You can duplicate/remove rows as needed.
#
# Example:
# CustomSongRow(
#     date="2026-05-01",
#     category="POP",
#     tidal_track_id="123456789",
#     preview_url="https://...",
#     title="Your Song Title",
#     artist="Your Artist Name",
#     album_cover="https://resources.tidal.com/images/.../1280x1280.jpg",
# ),
# ---------------------------------------------------------------------------
CUSTOM_SONGS: list[CustomSongRow] = [
    CustomSongRow(
        date="2026-05-01",
        category="POP",
        tidal_track_id="PASTE_REAL_TIDAL_TRACK_ID_HERE",
        preview_url="PASTE_REAL_PREVIEW_URL_HERE",
        title="PASTE_TITLE_HERE",
        artist="PASTE_ARTIST_HERE",
        album_cover="https://resources.tidal.com/images/PASTE_COVER_PATH_HERE/1280x1280.jpg",
    ),
    CustomSongRow(
        date="2026-05-02",
        category="RAP",
        tidal_track_id="PASTE_REAL_TIDAL_TRACK_ID_HERE",
        preview_url="PASTE_REAL_PREVIEW_URL_HERE",
        title="PASTE_TITLE_HERE",
        artist="PASTE_ARTIST_HERE",
        album_cover="https://resources.tidal.com/images/PASTE_COVER_PATH_HERE/1280x1280.jpg",
    ),
]


def _normalize_category(label: str) -> str:
    key = label.strip().upper()
    slug = UI_CATEGORY_TO_DB_SLUG.get(key)
    if slug is None:
        allowed = ", ".join(UI_CATEGORY_TO_DB_SLUG.keys())
        raise ValueError(f"Invalid category {label!r}. Allowed values: {allowed}")
    return slug


def _parse_date(raw: str):
    try:
        return datetime.strptime(raw.strip(), "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError(
            f"Invalid date {raw!r}. Expected format: YYYY-MM-DD",
        ) from exc


def _validate_song(row: CustomSongRow) -> tuple[str, str, str, str, str, str, str]:
    target_date = _parse_date(row.date).isoformat()
    category_slug = _normalize_category(row.category)
    tidal_track_id = row.tidal_track_id.strip()
    preview_url = row.preview_url.strip()
    title = row.title.strip()
    artist = row.artist.strip()
    album_cover = row.album_cover.strip()

    if not tidal_track_id:
        raise ValueError(f"Missing tidal_track_id for {row.date} / {row.category}")
    if not preview_url:
        raise ValueError(f"Missing preview_url for {row.date} / {row.category}")
    if not title:
        raise ValueError(f"Missing title for {row.date} / {row.category}")
    if not artist:
        raise ValueError(f"Missing artist for {row.date} / {row.category}")
    if not album_cover:
        raise ValueError(f"Missing album_cover for {row.date} / {row.category}")

    return (
        target_date,
        category_slug,
        tidal_track_id,
        preview_url,
        title,
        artist,
        album_cover,
    )


async def seed_custom() -> None:
    async with AsyncSessionLocal() as session:
        inserted = 0
        skipped = 0

        for row in CUSTOM_SONGS:
            (
                target_date_iso,
                category_slug,
                tidal_track_id,
                preview_url,
                title,
                artist,
                album_cover,
            ) = _validate_song(row)

            target_date = datetime.strptime(target_date_iso, "%Y-%m-%d").date()

            existing = await session.scalar(
                select(DailySong).where(
                    DailySong.target_date == target_date,
                    DailySong.category == category_slug,
                ),
            )
            if existing is not None:
                skipped += 1
                print(
                    f"SKIP  {target_date_iso} | {category_slug} | row already exists",
                )
                continue

            session.add(
                DailySong(
                    tidal_track_id=tidal_track_id,
                    preview_url=preview_url,
                    title=title,
                    artist=artist,
                    album_cover=album_cover,
                    target_date=target_date,
                    category=category_slug,
                ),
            )
            await session.commit()
            inserted += 1
            print(f"OK    {target_date_iso} | {category_slug} | {artist} — {title}")

        print("")
        print(f"Done. Inserted: {inserted}, skipped: {skipped}")


def main() -> None:
    asyncio.run(seed_custom())


if __name__ == "__main__":
    main()
