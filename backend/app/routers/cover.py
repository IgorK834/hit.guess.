from __future__ import annotations

import logging
from typing import Annotated
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response

from app.deps import HttpClient

logger = logging.getLogger(__name__)

router = APIRouter(tags=["cover"])

# Only TIDAL image CDNs — do not proxy auth, OpenAPI, or manifest hosts.
_ALLOWED_COVER_HOSTS: frozenset[str] = frozenset(
    {
        "resources.tidal.com",
        "images.tidal.com",
    },
)

_MAX_IMAGE_BYTES = 6 * 1024 * 1024


def _is_allowed_cover_url(raw: str) -> bool:
    p = urlparse(raw.strip())
    if p.scheme != "https":
        return False
    host = (p.hostname or "").lower()
    return host in _ALLOWED_COVER_HOSTS


@router.get(
    "/image",
    summary="Proxy TIDAL cover art (browser-safe)",
    response_class=Response,
)
async def proxy_cover_image(
    http: HttpClient,
    url: Annotated[
        str,
        Query(
            min_length=12,
            max_length=2048,
            description="HTTPS image URL from TIDAL resources/images CDN",
        ),
    ],
) -> Response:
    """
    Fetch cover art server-side so the browser never hits TIDAL CDNs directly
    (hotlink / referrer rules often break <img> in SPAs).
    """
    if not _is_allowed_cover_url(url):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL host is not an allowed TIDAL image CDN.",
        )

    try:
        upstream = await http.get(
            url,
            headers={
                "User-Agent": "HitGuess/1.0 (cover proxy; +https://github.com/)",
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            },
            follow_redirects=True,
        )
        upstream.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.warning("Cover upstream HTTP %s for %s", exc.response.status_code, url[:120])
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not fetch cover image.",
        ) from exc
    except httpx.RequestError as exc:
        logger.warning("Cover upstream transport error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Cover image request failed.",
        ) from exc

    body = upstream.content
    if len(body) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Image too large.")

    ct = upstream.headers.get("content-type", "").split(";")[0].strip().lower()
    if not ct.startswith("image/"):
        logger.warning("Cover URL did not return image/* (got %s)", ct or "?")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream response is not an image.",
        )

    return Response(
        content=body,
        media_type=ct,
        headers={
            "Cache-Control": "public, max-age=86400",
        },
    )
