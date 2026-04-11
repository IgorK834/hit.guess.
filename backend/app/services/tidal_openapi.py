from __future__ import annotations

import logging
import random
from typing import Any
from urllib.parse import quote

import httpx
from httpx import HTTPStatusError

from app.core.config import settings

logger = logging.getLogger(__name__)

JSONAPI_ACCEPT = "application/vnd.api+json"


def _jsonapi_headers(access_token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {access_token}",
        "Accept": JSONAPI_ACCEPT,
    }


def _index_included(payload: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for res in payload.get("included") or []:
        rid = res.get("id")
        rtype = res.get("type")
        if isinstance(rid, str) and isinstance(rtype, str):
            out[(rtype, rid)] = res
    return out


def _resource_attributes(res: dict[str, Any]) -> dict[str, Any]:
    attrs = res.get("attributes")
    return attrs if isinstance(attrs, dict) else {}


async def search_track_ids_for_query(
    http: httpx.AsyncClient,
    access_token: str,
    query: str,
    *,
    country_code: str,
    max_ids: int = 80,
) -> list[str]:
    """Return track resource ids from global search for the given free-text query."""
    encoded = quote(query, safe="")
    url = f"{settings.tidal_openapi_base_url.rstrip('/')}/searchResults/{encoded}/relationships/tracks"
    params: list[tuple[str, str]] = [
        ("countryCode", country_code),
        ("include", "tracks"),
    ]
    try:
        response = await http.get(url, headers=_jsonapi_headers(access_token), params=params)
        response.raise_for_status()
    except HTTPStatusError as exc:
        logger.warning(
            "TIDAL search failed for query=%r status=%s body=%s",
            query,
            exc.response.status_code,
            exc.response.text[:300],
        )
        return []
    except httpx.RequestError:
        logger.exception("TIDAL search transport error for query=%r", query)
        return []

    payload = response.json()
    ids: list[str] = []

    for item in payload.get("data") or []:
        if not isinstance(item, dict):
            continue
        itype = item.get("type")
        iid = item.get("id")
        if itype == "tracks" and isinstance(iid, str):
            ids.append(iid)
            continue
        rel = item.get("relationships") if isinstance(item.get("relationships"), dict) else {}
        tr = rel.get("track") if isinstance(rel.get("track"), dict) else {}
        trd = tr.get("data") if isinstance(tr.get("data"), dict) else {}
        if trd.get("type") == "tracks" and isinstance(trd.get("id"), str):
            ids.append(trd["id"])

    dedup: list[str] = []
    seen: set[str] = set()
    for tid in ids:
        if tid not in seen:
            seen.add(tid)
            dedup.append(tid)
        if len(dedup) >= max_ids:
            break
    return dedup


async def playlist_track_ids(
    http: httpx.AsyncClient,
    access_token: str,
    playlist_uuid: str,
    *,
    country_code: str,
    max_ids: int = 80,
) -> list[str]:
    """Collect track ids from a public/editorial playlist."""
    url = f"{settings.tidal_openapi_base_url.rstrip('/')}/playlists/{quote(playlist_uuid, safe='')}/relationships/items"
    params: list[tuple[str, str]] = [
        ("countryCode", country_code),
        ("include", "items"),
    ]
    try:
        response = await http.get(url, headers=_jsonapi_headers(access_token), params=params)
        response.raise_for_status()
    except HTTPStatusError as exc:
        logger.warning(
            "TIDAL playlist items failed playlist=%s status=%s body=%s",
            playlist_uuid,
            exc.response.status_code,
            exc.response.text[:300],
        )
        return []
    except httpx.RequestError:
        logger.exception("TIDAL playlist transport error playlist=%s", playlist_uuid)
        return []

    payload = response.json()
    index = _index_included(payload)
    ids: list[str] = []

    def collect_from_resource(res: dict[str, Any]) -> None:
        rel = res.get("relationships") if isinstance(res.get("relationships"), dict) else {}
        for key in ("track", "item", "tracks"):
            block = rel.get(key) if isinstance(rel.get(key), dict) else {}
            data = block.get("data")
            refs: list[dict[str, Any]] = []
            if isinstance(data, list):
                refs = [x for x in data if isinstance(x, dict)]
            elif isinstance(data, dict):
                refs = [data]
            for ref in refs:
                if ref.get("type") == "tracks" and isinstance(ref.get("id"), str):
                    ids.append(ref["id"])

    for item in payload.get("data") or []:
        if not isinstance(item, dict):
            continue
        itype = item.get("type")
        iid = item.get("id")
        collect_from_resource(item)
        if isinstance(itype, str) and isinstance(iid, str):
            expanded = index.get((itype, iid))
            if expanded:
                collect_from_resource(expanded)

    dedup: list[str] = []
    seen: set[str] = set()
    for tid in ids:
        if tid not in seen:
            seen.add(tid)
            dedup.append(tid)
        if len(dedup) >= max_ids:
            break
    return dedup


async def fetch_preview_manifest_uri(
    http: httpx.AsyncClient,
    access_token: str,
    track_id: str,
) -> str | None:
    """Resolve a preview-capable manifest URI (HLS + AAC) for a track id."""
    url = f"{settings.tidal_openapi_base_url.rstrip('/')}/trackManifests/{quote(track_id, safe='')}"
    params: list[tuple[str, str]] = [
        ("manifestType", "HLS"),
        ("formats", "HEAACV1"),
        ("uriScheme", "HTTPS"),
        ("usage", "PLAYBACK"),
        ("adaptive", "false"),
    ]
    try:
        response = await http.get(url, headers=_jsonapi_headers(access_token), params=params)
        response.raise_for_status()
    except HTTPStatusError as exc:
        logger.debug(
            "trackManifest failed track_id=%s status=%s body=%s",
            track_id,
            exc.response.status_code,
            exc.response.text[:200],
        )
        return None
    except httpx.RequestError:
        logger.debug("trackManifest transport error track_id=%s", track_id, exc_info=True)
        return None

    payload = response.json()
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    attrs = _resource_attributes(data)
    presentation = attrs.get("trackPresentation")
    uri = attrs.get("uri")
    if presentation != "PREVIEW":
        return None
    if isinstance(uri, str) and uri.strip():
        return uri.strip()
    return None


async def fetch_track_display_metadata(
    http: httpx.AsyncClient,
    access_token: str,
    track_id: str,
    *,
    country_code: str,
) -> tuple[str, str, str] | None:
    """Return (title, primary_artist, album_cover_url_or_placeholder)."""
    url = f"{settings.tidal_openapi_base_url.rstrip('/')}/tracks/{quote(track_id, safe='')}"
    params = {"countryCode": country_code, "include": "artists,albums"}
    try:
        response = await http.get(url, headers=_jsonapi_headers(access_token), params=params)
        response.raise_for_status()
    except (HTTPStatusError, httpx.RequestError):
        logger.debug("track metadata fetch failed track_id=%s", track_id, exc_info=True)
        return None

    payload = response.json()
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    index = _index_included(payload)
    attrs = _resource_attributes(data)
    title = attrs.get("title")
    if not isinstance(title, str) or not title.strip():
        return None

    artist_name = ""
    rel = data.get("relationships") if isinstance(data.get("relationships"), dict) else {}
    artists_rel = rel.get("artists") if isinstance(rel.get("artists"), dict) else {}
    artists_data = artists_rel.get("data")
    artist_entries: list[dict[str, Any]] = []
    if isinstance(artists_data, list):
        artist_entries = [x for x in artists_data if isinstance(x, dict)]
    elif isinstance(artists_data, dict):
        artist_entries = [artists_data]

    for ref in artist_entries:
        aid = ref.get("id")
        at = ref.get("type")
        if isinstance(aid, str) and at == "artists":
            ares = index.get(("artists", aid))
            if ares:
                an = _resource_attributes(ares).get("name")
                if isinstance(an, str) and an.strip():
                    artist_name = an.strip()
                    break

    if not artist_name:
        artist_name = "Unknown Artist"

    cover_url = ""
    albums_rel = rel.get("albums") if isinstance(rel.get("albums"), dict) else {}
    albums_data = albums_rel.get("data")
    album_ref: dict[str, Any] | None = None
    if isinstance(albums_data, list) and albums_data:
        album_ref = albums_data[0] if isinstance(albums_data[0], dict) else None
    elif isinstance(albums_data, dict):
        album_ref = albums_data

    if album_ref and isinstance(album_ref.get("id"), str) and album_ref.get("type") == "albums":
        cover_url = await _fetch_album_cover_url(
            http,
            access_token,
            album_ref["id"],
            country_code=country_code,
        )

    if not cover_url:
        cover_url = settings.tidal_placeholder_cover_url

    return title.strip(), artist_name, cover_url


async def _fetch_album_cover_url(
    http: httpx.AsyncClient,
    access_token: str,
    album_id: str,
    *,
    country_code: str,
) -> str:
    url = f"{settings.tidal_openapi_base_url.rstrip('/')}/albums/{quote(album_id, safe='')}/relationships/coverArt"
    params = {"countryCode": country_code, "include": "coverArt"}
    try:
        response = await http.get(url, headers=_jsonapi_headers(access_token), params=params)
        response.raise_for_status()
    except (HTTPStatusError, httpx.RequestError):
        return ""

    payload = response.json()
    index = _index_included(payload)
    best_href = ""
    best_area = -1

    for item in payload.get("data") or []:
        if not isinstance(item, dict):
            continue
        rel = item.get("relationships") if isinstance(item.get("relationships"), dict) else {}
        ca = rel.get("coverArt") if isinstance(rel.get("coverArt"), dict) else {}
        cdata = ca.get("data")
        refs: list[dict[str, Any]] = []
        if isinstance(cdata, list):
            refs = [x for x in cdata if isinstance(x, dict)]
        elif isinstance(cdata, dict):
            refs = [cdata]
        for ref in refs:
            cid = ref.get("id")
            ctype = ref.get("type")
            if not isinstance(cid, str):
                continue
            res = index.get((str(ctype), cid))
            if not res:
                continue
            files = _resource_attributes(res).get("files")
            if not isinstance(files, list):
                continue
            for fobj in files:
                if not isinstance(fobj, dict):
                    continue
                href = fobj.get("href")
                meta = fobj.get("meta") if isinstance(fobj.get("meta"), dict) else {}
                try:
                    w = int(meta.get("width") or 0)
                    h = int(meta.get("height") or 0)
                except (TypeError, ValueError):
                    w, h = 0, 0
                if isinstance(href, str) and href.strip():
                    area = w * h
                    if area > best_area:
                        best_area = area
                        best_href = href.strip()

    return best_href


def shuffled_copy(ids: list[str]) -> list[str]:
    out = list(ids)
    random.shuffle(out)
    return out
