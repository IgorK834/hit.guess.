from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.core.config import settings
from app.core.redis_cache import normalize_search_query
from app.deps import HttpClient, RedisClient, TidalAuth
from app.services.tidal_auth import TidalAuthError
from app.services.tidal_openapi import search_tracks_with_display_metadata

logger = logging.getLogger(__name__)

router = APIRouter(tags=["search"])

SEARCH_CACHE_PREFIX = "search:"
SEARCH_CACHE_TTL_SECONDS = 86400
SEARCH_RATE_LIMIT_PER_MINUTE = 15
SEARCH_RATE_LIMIT_WINDOW_SECONDS = 60


class SearchTrackItem(BaseModel):
    tidal_id: str
    title: str
    artist: str
    cover_url: str


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client is not None:
        return request.client.host
    return "unknown"


def _search_cache_key(query: str) -> str:
    normalized = normalize_search_query(query)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"{SEARCH_CACHE_PREFIX}{digest}"


def _rate_limit_key(ip: str, window: int) -> str:
    return f"ratelimit:search:{ip}:{window}"


async def enforce_search_rate_limit(request: Request, redis: RedisClient) -> None:
    now = int(time.time())
    window = now // SEARCH_RATE_LIMIT_WINDOW_SECONDS
    ip = _client_ip(request)
    key = _rate_limit_key(ip, window)
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, SEARCH_RATE_LIMIT_WINDOW_SECONDS * 2)
    if count > SEARCH_RATE_LIMIT_PER_MINUTE:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Search rate limit exceeded. Try again later.",
            headers={"Retry-After": str(SEARCH_RATE_LIMIT_WINDOW_SECONDS)},
        )


@router.get(
    "",
    response_model=list[SearchTrackItem],
    summary="Proxy track search to TIDAL (cached + rate limited)",
    dependencies=[Depends(enforce_search_rate_limit)],
)
async def search_tracks(
    redis: RedisClient,
    http: HttpClient,
    tidal_auth: TidalAuth,
    q: Annotated[str, Query(min_length=2, max_length=256, description="Search text")],
) -> list[SearchTrackItem]:
    cache_key = _search_cache_key(q)
    cached_raw = await redis.get(cache_key)
    if cached_raw is not None:
        try:
            data = json.loads(cached_raw)
            if isinstance(data, list):
                return [SearchTrackItem.model_validate(item) for item in data]
        except (json.JSONDecodeError, ValueError):
            logger.warning("Invalid search cache entry for key=%s", cache_key)

    try:
        token = await tidal_auth.get_access_token()
    except TidalAuthError as exc:
        logger.error("TIDAL auth failed for search: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Music catalogue is temporarily unavailable.",
        ) from exc

    try:
        rows = await search_tracks_with_display_metadata(
            http,
            token,
            q,
            country_code=settings.tidal_country_code,
            limit=10,
        )
    except httpx.HTTPStatusError as exc:
        logger.error(
            "TIDAL search HTTP error: status=%s body=%s",
            exc.response.status_code,
            exc.response.text[:500],
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream search failed.",
        ) from exc
    except httpx.RequestError as exc:
        logger.exception("TIDAL search transport error")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach music search service.",
        ) from exc

    items = [SearchTrackItem.model_validate(r) for r in rows]
    await redis.setex(
        cache_key,
        SEARCH_CACHE_TTL_SECONDS,
        json.dumps([i.model_dump() for i in items], separators=(",", ":")),
    )
    return items
