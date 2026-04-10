from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import health, v1


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Async startup (e.g. DB pools, Redis) goes here.
    yield
    # Async shutdown goes here.


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


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "hit-guess-api", "docs": "/docs"}
