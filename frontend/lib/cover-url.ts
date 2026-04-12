import { getApiBaseUrl } from "@/lib/api";

/** Hosts where we must load art via FastAPI (hotlink / referrer rules break raw <img>). */
const PROXY_TIDAL_IMAGE_HOSTS = new Set([
  "resources.tidal.com",
  "images.tidal.com",
]);

/** TIDAL placeholder in API was a HTML page — treat as missing art. */
export function safeAlbumCoverSrc(url: string | null | undefined): string {
  const u = url?.trim() ?? "";
  if (!u.startsWith("http")) {
    return "/placeholder-album.svg";
  }
  try {
    const parsed = new URL(u);
    const host = parsed.hostname;
    if (host === "tidal.com" || host === "www.tidal.com") {
      return "/placeholder-album.svg";
    }
    if (PROXY_TIDAL_IMAGE_HOSTS.has(host)) {
      return `${getApiBaseUrl()}/api/v1/cover/image?url=${encodeURIComponent(u)}`;
    }
  } catch {
    return "/placeholder-album.svg";
  }
  return u;
}
