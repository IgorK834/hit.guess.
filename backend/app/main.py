from contextlib import asynccontextmanager

import httpx
import redis.asyncio as redis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db.session import engine
from app.routers import game, health, search, stats, v1
from app.scheduler import setup_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = redis.from_url(settings.redis_url, decode_responses=True)
    await app.state.redis.ping()

    timeout = httpx.Timeout(30.0)
    limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
    async with httpx.AsyncClient(timeout=timeout, limits=limits) as http_client:
        app.state.http_client = http_client
        scheduler = setup_scheduler(app)
        scheduler.start()
        try:
            yield
        finally:
            scheduler.shutdown(wait=False)

    await app.state.redis.aclose()
    await engine.dispose()


app = FastAPI(
    title="HIT.GUESS. API",
    description="Backend for TidalGuess — TIDAL proxy and game APIs.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(v1.router, prefix="/api/v1")
app.include_router(game.router, prefix="/api/v1/game")
app.include_router(search.router, prefix="/api/v1/search")
app.include_router(stats.router, prefix="/api/v1/stats")


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "hit-guess-api", "docs": "/docs"}
