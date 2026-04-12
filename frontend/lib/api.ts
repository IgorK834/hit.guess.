import { gameApiHeaders } from "@/lib/clientTimezone";

const DEFAULT_API = "http://localhost:8000";

export function getApiBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API;
  return base.replace(/\/$/, "");
}

export type DailyGamePayload = {
  game_id: string;
  preview_url: string;
};

export type SearchTrackResult = {
  tidal_id: string;
  title: string;
  artist: string;
  cover_url: string;
};

export type GuessPayload = {
  session_id: string;
  game_id: string;
  guessed_tidal_track_id: string;
};

export type TrackDetails = {
  title: string;
  artist: string;
  album_cover: string;
};

export type GuessResponse = {
  is_correct: boolean;
  attempts_used: number;
  game_status: "PLAYING" | "WON" | "LOST";
  track_details: TrackDetails | null;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("Invalid JSON from API", res.status, text);
  }
}

export async function fetchDailyGame(
  category?: string,
): Promise<DailyGamePayload> {
  const q = new URLSearchParams();
  if (category?.trim()) {
    q.set("category", category.trim());
  }
  // Defeat intermediaries that ignore Vary — each category must hit origin.
  q.set("_nc", `${category ?? ""}:${Date.now()}`);
  const qs = q.toString();
  const path =
    qs.length > 0
      ? `${getApiBaseUrl()}/api/v1/game/daily?${qs}`
      : `${getApiBaseUrl()}/api/v1/game/daily`;
  const res = await fetch(path, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...gameApiHeaders(),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(`Daily game failed (${res.status})`, res.status, body);
  }
  return parseJson<DailyGamePayload>(res);
}

export async function searchTracks(query: string): Promise<SearchTrackResult[]> {
  const q = query.trim();
  const params = new URLSearchParams({ q });
  const res = await fetch(`${getApiBaseUrl()}/api/v1/search?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 429) {
    throw new ApiError("Search rate limited — try again shortly.", 429);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(`Search failed (${res.status})`, res.status, body);
  }
  return parseJson<SearchTrackResult[]>(res);
}

export async function submitGuess(payload: GuessPayload): Promise<GuessResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/v1/game/guess`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(`Guess failed (${res.status})`, res.status, body);
  }
  return parseJson<GuessResponse>(res);
}

export const SKIP_GUESS_TIDAL_ID = "__HITGUESS_SKIP__";
