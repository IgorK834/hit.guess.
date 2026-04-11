from typing import Annotated

import httpx
import redis.asyncio as redis
from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.services.tidal_auth import TidalAuthService

DbSession = Annotated[AsyncSession, Depends(get_db)]


def get_redis(request: Request) -> redis.Redis:
    client: redis.Redis | None = getattr(request.app.state, "redis", None)
    if client is None:
        raise RuntimeError("Redis client is not initialized")
    return client


def get_http_client(request: Request) -> httpx.AsyncClient:
    client: httpx.AsyncClient | None = getattr(request.app.state, "http_client", None)
    if client is None:
        raise RuntimeError("HTTP client is not initialized")
    return client


def get_tidal_auth(request: Request) -> TidalAuthService:
    return TidalAuthService(
        redis_client=get_redis(request),
        http_client=get_http_client(request),
    )


RedisClient = Annotated[redis.Redis, Depends(get_redis)]
HttpClient = Annotated[httpx.AsyncClient, Depends(get_http_client)]
TidalAuth = Annotated[TidalAuthService, Depends(get_tidal_auth)]
