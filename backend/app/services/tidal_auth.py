from __future__ import annotations

import base64
import logging
from typing import Any

import httpx
import redis.asyncio as redis
from httpx import HTTPStatusError

from app.core.config import settings

logger = logging.getLogger(__name__)

REDIS_ACCESS_TOKEN_KEY = "tidal:oauth:access_token"
TOKEN_REFRESH_BUFFER_SECONDS = 60


class TidalAuthError(RuntimeError):
    """Raised when TIDAL authentication fails or credentials are invalid."""


class TidalAuthService:
    """Fetches and caches TIDAL access tokens using client credentials."""

    def __init__(
        self,
        redis_client: redis.Redis,
        http_client: httpx.AsyncClient,
    ) -> None:
        self._redis = redis_client
        self._http = http_client

    async def get_access_token(self) -> str:
        cached = await self._redis.get(REDIS_ACCESS_TOKEN_KEY)
        if cached:
            return cached

        return await self._fetch_and_cache_token()

    async def _fetch_and_cache_token(self) -> str:
        if settings.tidal_client_id is None or settings.tidal_client_secret is None:
            raise TidalAuthError("TIDAL_CLIENT_ID and TIDAL_CLIENT_SECRET must be set in the environment")

        client_id = settings.tidal_client_id.strip()
        client_secret = settings.tidal_client_secret.get_secret_value().strip()
        if not client_id or not client_secret:
            raise TidalAuthError("TIDAL_CLIENT_ID and TIDAL_CLIENT_SECRET must be set in the environment")

        basic = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
        headers = {
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        form: dict[str, str] = {"grant_type": "client_credentials"}

        try:
            response = await self._http.post(
                settings.tidal_token_url,
                headers=headers,
                data=form,
            )
            response.raise_for_status()
        except HTTPStatusError as exc:
            body = exc.response.text
            logger.error(
                "TIDAL token request failed: status=%s body=%s",
                exc.response.status_code,
                body[:500],
            )
            raise TidalAuthError(f"TIDAL token endpoint returned {exc.response.status_code}") from exc
        except httpx.RequestError as exc:
            logger.exception("TIDAL token request transport error")
            raise TidalAuthError("Failed to reach TIDAL token endpoint") from exc

        payload: dict[str, Any] = response.json()
        access_token = payload.get("access_token")
        if not access_token or not isinstance(access_token, str):
            raise TidalAuthError("TIDAL token response missing access_token")

        expires_in_raw = payload.get("expires_in", 3600)
        try:
            expires_in = int(expires_in_raw)
        except (TypeError, ValueError) as exc:
            raise TidalAuthError("TIDAL token response has invalid expires_in") from exc

        ttl_seconds = max(expires_in - TOKEN_REFRESH_BUFFER_SECONDS, 1)
        await self._redis.setex(REDIS_ACCESS_TOKEN_KEY, ttl_seconds, access_token)

        return access_token
