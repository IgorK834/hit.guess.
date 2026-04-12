from __future__ import annotations

import logging
from typing import Annotated
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import Response

from app.deps import HttpClient

logger = logging.getLogger(__name__)

router = APIRouter(tags=["preview"])

_MAX_PREVIEW_BODY_BYTES = 20 * 1024 * 1024


def _is_allowed_tidal_media_url(raw: str) -> bool:
    p = urlparse(raw.strip())
    if p.scheme != "https":
        return False
    host = (p.hostname or "").lower()
    return host == "tidal.com" or host.endswith(".tidal.com")


@router.get(
    "/proxy",
    summary="Proxy TIDAL HLS preview (browser CORS bypass)",
    response_class=Response,
)
async def proxy_tidal_preview(
    http: HttpClient,
    request: Request,
    url: Annotated[
        str,
        Query(
            min_length=12,
            max_length=4096,
            description="HTTPS TIDAL manifest or media segment URL",
        ),
    ],
) -> Response:
    """
    Browsers cannot XHR TIDAL CDNs (no Access-Control-Allow-Origin). hls.js loads manifests
    and segments via XMLHttpRequest — every request must go through this server-side proxy.
    """
    if not _is_allowed_tidal_media_url(url):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL host is not allowed (TIDAL HTTPS only).",
        )

    headers = {
        "User-Agent": "HitGuess/1.0 (preview proxy)",
        "Accept": "*/*",
    }
    range_h = request.headers.get("range")
    if range_h:
        headers["Range"] = range_h

    try:
        upstream = await http.get(url, headers=headers, follow_redirects=True)
        upstream.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Preview upstream HTTP %s for %s",
            exc.response.status_code,
            url[:120],
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not fetch preview from TIDAL.",
        ) from exc
    except httpx.RequestError as exc:
        logger.warning("Preview proxy transport error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Preview request failed.",
        ) from exc

    body = upstream.content
    if len(body) > _MAX_PREVIEW_BODY_BYTES:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Preview response too large.",
        )

    ct = upstream.headers.get("content-type", "application/octet-stream")
    ct_main = ct.split(";")[0].strip()

    out_headers: dict[str, str] = {
        "Cache-Control": "private, max-age=60",
        "Content-Length": str(len(body)),
    }
    if ar := upstream.headers.get("accept-ranges"):
        out_headers["Accept-Ranges"] = ar
    if cr := upstream.headers.get("content-range"):
        out_headers["Content-Range"] = cr

    return Response(
        content=body,
        status_code=upstream.status_code,
        media_type=ct_main,
        headers=out_headers,
    )
