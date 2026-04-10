from typing import Annotated

import redis.asyncio as redis
from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db

DbSession = Annotated[AsyncSession, Depends(get_db)]


def get_redis(request: Request) -> redis.Redis:
    client: redis.Redis | None = getattr(request.app.state, "redis", None)
    if client is None:
        raise RuntimeError("Redis client is not initialized")
    return client


RedisClient = Annotated[redis.Redis, Depends(get_redis)]
