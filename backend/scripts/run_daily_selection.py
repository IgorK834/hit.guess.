"""Uzupełnij `daily_songs` dla wszystkich kategorii — to samo co nocny cron.

Uruchom z katalogu `backend` (backend/.env + opcjonalnie backend/.env.local):

    python3 -m scripts.run_daily_selection

Opcjonalnie konkretna data (YYYY-MM-DD), np. na jutro w testach:

    python3 -m scripts.run_daily_selection 2026-04-12

Wymaga: DATABASE_URL, REDIS_URL, TIDAL_CLIENT_ID, TIDAL_CLIENT_SECRET, migracja z kolumną `category`.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import date
from pathlib import Path

import httpx
import redis.asyncio as redis
from dotenv import load_dotenv

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

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
from app.services.daily_selector import run_daily_song_selection  # noqa: E402
from app.services.tidal_auth import TidalAuthService  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("run_daily_selection")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Run daily song selection for all categories.")
    p.add_argument(
        "target_date",
        nargs="?",
        default=None,
        help="Calendar date YYYY-MM-DD (default: today in SCHEDULER_TIMEZONE)",
    )
    return p.parse_args()


def _parse_date(s: str) -> date:
    parts = s.strip().split("-")
    if len(parts) != 3:
        raise SystemExit(f"Invalid date {s!r}, expected YYYY-MM-DD")
    y, m, d = (int(parts[0]), int(parts[1]), int(parts[2]))
    return date(y, m, d)


async def main() -> None:
    args = _parse_args()
    day = _parse_date(args.target_date) if args.target_date else service_local_today()

    redis_client = redis.from_url(settings.redis_url, decode_responses=True)
    await redis_client.ping()

    timeout = httpx.Timeout(60.0)
    limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
    try:
        async with httpx.AsyncClient(timeout=timeout, limits=limits) as http:
            auth = TidalAuthService(redis_client, http)
            async with AsyncSessionLocal() as session:
                ok = await run_daily_song_selection(
                    session,
                    auth,
                    http,
                    target_date=day,
                )
                if ok:
                    logger.info("Done for %s — all categories present (or already were).", day)
                else:
                    logger.error(
                        "Finished with gaps for %s — check TIDAL logs / DB for missing categories.",
                        day,
                    )
                    raise SystemExit(1)
    finally:
        await redis_client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
