"""Seed `daily_songs` with TIDAL search + PREVIEW validation (local / test data).

Run from the `backend` directory:

    python -m scripts.seed_songs

Requires: DATABASE_URL, REDIS_URL, TIDAL_CLIENT_ID, TIDAL_CLIENT_SECRET, TIDAL_COUNTRY_CODE (optional, default PL).
"""

from __future__ import annotations

import asyncio
import logging
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import httpx
import redis.asyncio as redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

# Load env before `settings` is instantiated (root .env → backend/.env → backend/.env.local).
from dotenv import load_dotenv  # noqa: E402

_REPO_ROOT = _BACKEND_ROOT.parent
if (_REPO_ROOT / ".env").is_file():
    load_dotenv(_REPO_ROOT / ".env", override=False)
if (_BACKEND_ROOT / ".env").is_file():
    load_dotenv(_BACKEND_ROOT / ".env", override=False)
if (_BACKEND_ROOT / ".env.local").is_file():
    load_dotenv(_BACKEND_ROOT / ".env.local", override=True)

from app.core.config import settings  # noqa: E402
from app.core.datetime_utils import service_local_today  # noqa: E402
from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models.daily_song import DailySong  # noqa: E402
from app.services.daily_selector import DailyMusicCategory  # noqa: E402
import app.services.tidal_openapi as tidal_openapi  # noqa: E402
from app.services.tidal_auth import TidalAuthError, TidalAuthService  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("seed_songs")


def _exit_if_missing_tidal_credentials() -> None:
    cid = (settings.tidal_client_id or "").strip()
    sec = settings.tidal_client_secret
    sec_val = sec.get_secret_value().strip() if sec is not None else ""
    if cid and sec_val:
        return
    paths = [
        _BACKEND_ROOT / ".env.local",
        _BACKEND_ROOT / ".env",
        _BACKEND_ROOT.parent / ".env",
    ]
    msg = (
        "Missing TIDAL_CLIENT_ID and/or TIDAL_CLIENT_SECRET.\n\n"
        "Put secrets in backend/.env.local (gitignored) or export them in your shell.\n"
        "Register an app at: https://developer.tidal.com/dashboard\n\n"
        "Checked env files:\n"
        + "\n".join(f"  - {p}  ({'found' if p.is_file() else 'not found'})" for p in paths)
        + "\n\nExample (backend/.env.local):\n"
        "  TIDAL_CLIENT_ID=...\n"
        "  TIDAL_CLIENT_SECRET=...\n"
    )
    print(msg, file=sys.stderr)
    raise SystemExit(2)

# 2–3 iconic search queries per category; first PREVIEW-capable catalogue hit wins.
SEED_BY_CATEGORY: dict[str, list[str]] = {
    "POP": [
        "Blinding Lights The Weeknd",
        "Billie Jean Michael Jackson",
        "Uptown Funk Bruno Mars",
    ],
    "ROCK": [
        "Bohemian Rhapsody Queen",
        "Smells Like Teen Spirit Nirvana",
        "Stairway to Heaven Led Zeppelin",
    ],
    "RAP": [
        "Lose Yourself Eminem",
        "Juicy The Notorious B.I.G.",
        "Nuthin But A G Thang Dr Dre",
    ],
    "INDIE": [
        "Take Me Out Franz Ferdinand",
        "Do I Wanna Know Arctic Monkeys",
        "Mr Brightside The Killers",
    ],
    "KLASYKI": [
        "Hotel California Eagles",
        "Sweet Caroline Neil Diamond",
        "Imagine John Lennon",
    ],
}

MAX_IDS_SCAN = 25

# Map seed bucket keys to `daily_songs.category` (same slugs as the game API).
SEED_BUCKET_TO_CATEGORY_SLUG: dict[str, str] = {
    "POP": DailyMusicCategory.POP.value,
    "RAP": DailyMusicCategory.RAP.value,
    "ROCK": DailyMusicCategory.KLASYKI_SWIAT.value,
    "INDIE": DailyMusicCategory.POPULARNE.value,
    "KLASYKI": DailyMusicCategory.POLSKIE_KLASYKI.value,
}


@dataclass(frozen=True, slots=True)
class ResolvedTrack:
    tidal_track_id: str
    preview_url: str
    title: str
    artist: str
    album_cover: str
    category: str
    query: str


async def resolve_one_query(
    http: httpx.AsyncClient,
    token: str,
    *,
    category: str,
    query: str,
) -> ResolvedTrack | None:
    ids = await tidal_openapi.search_track_ids_for_query(
        http,
        token,
        query,
        country_code=settings.tidal_country_code,
        max_ids=MAX_IDS_SCAN,
    )
    if not ids:
        logger.warning("No search results [%s] query=%r", category, query)
        return None

    for track_id in ids:
        preview_url = await tidal_openapi.fetch_preview_manifest_uri(http, token, track_id)
        if not preview_url:
            continue
        meta = await tidal_openapi.fetch_track_display_metadata(
            http,
            token,
            track_id,
            country_code=settings.tidal_country_code,
        )
        if not meta:
            continue
        title, artist, cover = meta
        return ResolvedTrack(
            tidal_track_id=track_id,
            preview_url=preview_url,
            title=title,
            artist=artist,
            album_cover=cover,
            category=category,
            query=query,
        )

    logger.warning(
        "No PREVIEW-backed track [%s] query=%r (scanned %s ids)",
        category,
        query,
        len(ids),
    )
    return None


async def collect_candidates(
    auth: TidalAuthService,
    http: httpx.AsyncClient,
) -> list[ResolvedTrack]:
    try:
        token = await auth.get_access_token()
    except TidalAuthError:
        logger.exception(
            "TIDAL auth failed; set TIDAL_CLIENT_ID and TIDAL_CLIENT_SECRET in backend/.env.local",
        )
        return []

    out: list[ResolvedTrack] = []
    for category, queries in SEED_BY_CATEGORY.items():
        for query in queries:
            resolved = await resolve_one_query(http, token, category=category, query=query)
            if resolved:
                out.append(resolved)
                logger.info(
                    "Resolved [%s] %r -> %s — %s",
                    category,
                    query,
                    resolved.artist,
                    resolved.title,
                )
    return out


async def next_free_date_for_category_slug(
    session,
    start: date,
    category_slug: str,
) -> date:
    d = start
    while True:
        existing = await session.scalar(
            select(DailySong).where(
                DailySong.target_date == d,
                DailySong.category == category_slug,
            ),
        )
        if existing is None:
            return d
        d += timedelta(days=1)


async def seed() -> None:
    _exit_if_missing_tidal_credentials()

    redis_client = redis.from_url(settings.redis_url, decode_responses=True)
    await redis_client.ping()
    timeout = httpx.Timeout(30.0)
    limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
    try:
        async with httpx.AsyncClient(timeout=timeout, limits=limits) as http:
            auth = TidalAuthService(redis_client, http)
            candidates = await collect_candidates(auth, http)
            if not candidates:
                logger.error("No tracks to insert — aborting.")
                return

            async with AsyncSessionLocal() as session:
                start_date = service_local_today()
                inserted = 0
                for cand in candidates:
                    slug = SEED_BUCKET_TO_CATEGORY_SLUG.get(
                        cand.category,
                        DailyMusicCategory.POP.value,
                    )
                    d = await next_free_date_for_category_slug(session, start_date, slug)
                    row = DailySong(
                        tidal_track_id=cand.tidal_track_id,
                        preview_url=cand.preview_url,
                        title=cand.title,
                        artist=cand.artist,
                        album_cover=cand.album_cover,
                        target_date=d,
                        category=slug,
                    )
                    session.add(row)
                    try:
                        await session.commit()
                        inserted += 1
                        logger.info(
                            "Inserted %s | %s — %s | tid=%s [%s] cat=%s",
                            d.isoformat(),
                            cand.artist,
                            cand.title,
                            cand.tidal_track_id,
                            cand.category,
                            slug,
                        )
                    except IntegrityError:
                        await session.rollback()
                        logger.warning(
                            "Conflict for date %s category=%s (skipping %s — %s)",
                            d.isoformat(),
                            slug,
                            cand.artist,
                            cand.title,
                        )
                logger.info("Done. Inserted %s row(s) into daily_songs.", inserted)
    finally:
        await redis_client.aclose()


def main() -> None:
    asyncio.run(seed())


if __name__ == "__main__":
    main()
