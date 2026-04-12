import { getApiBaseUrl } from "@/lib/api";

/** TIDAL HLS URLs are not CORS-enabled; hls.js must fetch via FastAPI `/api/v1/preview/proxy`. */
export function proxiedTidalPreviewUrl(original: string): string {
  const u = original.trim();
  if (!/^https?:\/\//i.test(u)) {
    return u;
  }
  return `${getApiBaseUrl()}/api/v1/preview/proxy?url=${encodeURIComponent(u)}`;
}
