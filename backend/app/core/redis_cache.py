from __future__ import annotations

import hashlib
import json
from typing import Any

import redis.asyncio as redis

TIDAL_SEARCH_KEY_PREFIX = "tidal:search:"
SESSION_KEY_PREFIX = "session:"
DEFAULT_SEARCH_TTL_SECONDS = 300


def normalize_search_query(query: str) -> str:
    return " ".join(query.casefold().split())


def tidal_search_cache_key(query: str) -> str:
    normalized = normalize_search_query(query)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"{TIDAL_SEARCH_KEY_PREFIX}{digest}"


def session_key(session_id: str) -> str:
    return f"{SESSION_KEY_PREFIX}{session_id}"


async def cache_get_json(client: redis.Redis, key: str) -> Any | None:
    raw: str | None = await client.get(key)
    if raw is None:
        return None
    return json.loads(raw)


async def cache_set_json(
    client: redis.Redis,
    key: str,
    value: Any,
    ttl_seconds: int = DEFAULT_SEARCH_TTL_SECONDS,
) -> None:
    await client.setex(key, ttl_seconds, json.dumps(value, separators=(",", ":")))
