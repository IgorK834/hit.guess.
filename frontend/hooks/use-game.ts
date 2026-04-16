"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type DailyGamePayload,
  type GuessResponse,
  type SearchTrackResult,
  type TrackDetails,
  SKIP_GUESS_TIDAL_ID,
  submitGuess as apiSubmitGuess,
  fetchDailyGame,
  ApiError,
} from "@/lib/api";
import { ENABLE_STRICT_CATEGORY_LOGIC } from "@/lib/feature-flags";
import { getLocalDateKey } from "@/lib/clientTimezone";

/** Legacy single-blob key (v2/v3) — migrated once into per-category keys. */
export const LEGACY_DAILY_STORAGE_KEY = "hit_guess_daily_state";

const PERSIST_VERSION = 5 as const;

function categoryKeySuffix(category: string): string {
  return category.trim().replace(/\s+/g, "_");
}

/** Per-category daily round snapshot: `hit_guess_daily_state_{date}_{category}`. */
export function dailyStateStorageKey(date: string, category: string): string {
  return `hit_guess_daily_state_${date}_${categoryKeySuffix(category)}`;
}

/** Per-category anonymous session (Redis / leaderboard isolation). */
export function dailySessionStorageKey(date: string, category: string): string {
  return `hit_guess_session_${date}_${categoryKeySuffix(category)}`;
}

/**
 * Removes every Hit.Guess. blob from `localStorage` (all dates and categories, legacy key).
 * After calling, reload the page so React state matches empty storage.
 */
export function wipeAllHitGuessLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (k === LEGACY_DAILY_STORAGE_KEY || k.startsWith("hit_guess_")) {
        keys.push(k);
      }
    }
    for (const k of keys) {
      window.localStorage.removeItem(k);
    }
  } catch {
    /* quota / private mode */
  }
}

export type GameState = "IDLE" | "PLAYING" | "PAUSED" | "LOCKED" | "FINISHED";

export const GUESS_DURATIONS_MS = [
  1000, 2000, 4000, 7000, 11000, 16000,
] as const;

export const AUDIO_SEGMENT_CAPS = GUESS_DURATIONS_MS.map((ms) => ms / 1000) as unknown as readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

export const MAX_ATTEMPTS = 6;

export type GuessSlot = {
  line: string;
  variant: "empty" | "wrong" | "skip" | "correct";
  tidalId?: string;
};

export type GuessEntry =
  | { kind: "empty" }
  | { kind: "skip" }
  | { kind: "guess"; tidalId?: string; artist: string; title: string };

type HitGuessCategoryPersisted = {
  v: typeof PERSIST_VERSION;
  date: string;
  /** Pill label this blob belongs to — must match the active category or the snapshot is ignored. */
  uiCategory: string;
  gameState: GameState;
  attemptsUsed: number;
  gameStatus: GuessResponse["game_status"] | null;
  slots: GuessSlot[];
  gameId: string;
  previewUrl: string;
  reveal: TrackDetails | null;
};

type LegacyV2 = {
  v: 2;
  date: string;
  sessionId: string;
  gameState: GameState;
  attemptsUsed: number;
  slots: GuessSlot[];
  gameStatus: GuessResponse["game_status"] | null;
  gameId: string;
  previewUrl: string;
  reveal: TrackDetails | null;
};

type LegacyV3 = {
  v: 3;
  date: string;
  sessionId: string;
  byCategory: Record<string, unknown>;
};

let legacyMigratedGlobal = false;

function emptySlots(): GuessSlot[] {
  return Array.from({ length: MAX_ATTEMPTS }, () => ({
    line: "",
    variant: "empty" as const,
  }));
}

function formatWrongLabel(track: SearchTrackResult): string {
  return `${track.artist} — ${track.title}`;
}

function parseLabel(line: string): { artist: string; title: string } {
  const sep = " — ";
  const i = line.indexOf(sep);
  if (i === -1) return { artist: "", title: line };
  return { artist: line.slice(0, i), title: line.slice(i + sep.length) };
}

function slotsToGuesses(slots: GuessSlot[]): GuessEntry[] {
  return slots.map((s) => {
    if (s.variant === "empty") return { kind: "empty" as const };
    if (s.variant === "skip") return { kind: "skip" as const };
    const { artist, title } = parseLabel(s.line);
    return {
      kind: "guess" as const,
      tidalId: s.tidalId,
      artist,
      title,
    };
  });
}

const VALID_GAME_STATES: readonly GameState[] = [
  "IDLE",
  "PLAYING",
  "PAUSED",
  "LOCKED",
  "FINISHED",
];

function normalizePersistedGameState(gs: unknown): GameState {
  if (gs === "LOCKED") return "PLAYING";
  if (typeof gs === "string" && VALID_GAME_STATES.includes(gs as GameState)) {
    return gs as GameState;
  }
  return "PLAYING";
}

function isTerminalStatus(
  s: GuessResponse["game_status"] | null,
): s is "WON" | "LOST" {
  return s === "WON" || s === "LOST";
}

function isValidPersistCore(x: unknown): x is Omit<
  HitGuessCategoryPersisted,
  "v" | "date" | "uiCategory"
> {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.gameId === "string" &&
    typeof o.previewUrl === "string" &&
    typeof o.attemptsUsed === "number" &&
    Array.isArray(o.slots)
  );
}

function readCategoryPersisted(
  date: string,
  category: string,
): HitGuessCategoryPersisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(dailyStateStorageKey(date, category));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (o.date !== date) return null;

    if (o.v === 4 && isValidPersistCore(o)) {
      const upgraded: HitGuessCategoryPersisted = {
        v: PERSIST_VERSION,
        date,
        uiCategory: category,
        gameState: normalizePersistedGameState(o.gameState),
        attemptsUsed: o.attemptsUsed as number,
        gameStatus: (o.gameStatus ?? null) as GuessResponse["game_status"] | null,
        slots: Array.isArray(o.slots) && o.slots.length === MAX_ATTEMPTS
          ? (o.slots as GuessSlot[])
          : emptySlots(),
        gameId: o.gameId as string,
        previewUrl: o.previewUrl as string,
        reveal: (o.reveal ?? null) as TrackDetails | null,
      };
      if (upgraded.uiCategory !== category) return null;
      return upgraded;
    }

    if (o.v !== PERSIST_VERSION) return null;
    if (typeof o.uiCategory !== "string" || o.uiCategory !== category) {
      return null;
    }
    if (!isValidPersistCore(o)) return null;
    return o as unknown as HitGuessCategoryPersisted;
  } catch {
    return null;
  }
}

function writeCategoryPersisted(date: string, body: HitGuessCategoryPersisted) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      dailyStateStorageKey(date, body.uiCategory),
      JSON.stringify(body),
    );
  } catch {
    /* quota / private mode */
  }
}

function removeCategoryPersisted(date: string, category: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(dailyStateStorageKey(date, category));
  } catch {
    /* ignore */
  }
}

function getOrCreateSessionId(date: string, category: string): string {
  if (typeof window === "undefined") return "";
  const k = dailySessionStorageKey(date, category);
  try {
    let s = window.localStorage.getItem(k);
    if (!s) {
      s = crypto.randomUUID();
      window.localStorage.setItem(k, s);
    }
    return s;
  } catch {
    return crypto.randomUUID();
  }
}

function resetSessionId(date: string, category: string): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  const s = crypto.randomUUID();
  try {
    window.localStorage.setItem(dailySessionStorageKey(date, category), s);
  } catch {
    /* ignore */
  }
  return s;
}

function sliceToPersist(
  date: string,
  uiCategory: string,
  slice: {
    gameState: GameState;
    attemptsUsed: number;
    gameStatus: GuessResponse["game_status"] | null;
    slots: GuessSlot[];
    gameId: string;
    previewUrl: string;
    reveal: TrackDetails | null;
  },
): HitGuessCategoryPersisted {
  return {
    v: PERSIST_VERSION,
    date,
    uiCategory,
    gameState: slice.gameState === "LOCKED" ? "PLAYING" : slice.gameState,
    attemptsUsed: slice.attemptsUsed,
    gameStatus: slice.gameStatus,
    slots: slice.slots,
    gameId: slice.gameId,
    previewUrl: slice.previewUrl,
    reveal: slice.reveal,
  };
}

function migrateLegacyStorageIfPresent(today: string): void {
  if (typeof window === "undefined" || legacyMigratedGlobal) return;
  legacyMigratedGlobal = true;
  try {
    const raw = window.localStorage.getItem(LEGACY_DAILY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return;
    const o = parsed as Record<string, unknown>;
    const date = o.date;
    if (typeof date !== "string" || date !== today) {
      window.localStorage.removeItem(LEGACY_DAILY_STORAGE_KEY);
      return;
    }

    if (o.v === 2) {
      const v2 = o as unknown as LegacyV2;
      if (
        typeof v2.gameId === "string" &&
        typeof v2.previewUrl === "string"
      ) {
        const sid = typeof v2.sessionId === "string" ? v2.sessionId : crypto.randomUUID();
        window.localStorage.setItem(dailySessionStorageKey(today, "POP"), sid);
        writeCategoryPersisted(
          today,
          sliceToPersist(today, "POP", {
            gameState: normalizePersistedGameState(v2.gameState),
            attemptsUsed: v2.attemptsUsed,
            gameStatus: v2.gameStatus,
            slots:
              v2.slots.length === MAX_ATTEMPTS ? v2.slots : emptySlots(),
            gameId: v2.gameId,
            previewUrl: v2.previewUrl,
            reveal: v2.reveal,
          }),
        );
      }
      window.localStorage.removeItem(LEGACY_DAILY_STORAGE_KEY);
      return;
    }

    if (o.v === 3) {
      const v3 = o as unknown as LegacyV3;
      if (typeof v3.sessionId === "string" && v3.byCategory && typeof v3.byCategory === "object") {
        for (const [cat, rawSlice] of Object.entries(v3.byCategory)) {
          if (!isValidPersistCore(rawSlice)) continue;
          const s = rawSlice as Record<string, unknown>;
          window.localStorage.setItem(
            dailySessionStorageKey(today, cat),
            v3.sessionId,
          );
          writeCategoryPersisted(
            today,
            sliceToPersist(today, cat, {
              gameState: normalizePersistedGameState(s.gameState),
              attemptsUsed: s.attemptsUsed as number,
              gameStatus: (s.gameStatus ?? null) as GuessResponse["game_status"] | null,
              slots:
                Array.isArray(s.slots) && s.slots.length === MAX_ATTEMPTS
                  ? (s.slots as GuessSlot[])
                  : emptySlots(),
              gameId: s.gameId as string,
              previewUrl: s.previewUrl as string,
              reveal: (s.reveal ?? null) as TrackDetails | null,
            }),
          );
        }
      }
      window.localStorage.removeItem(LEGACY_DAILY_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

type PersistMirror = {
  gameState: GameState;
  attemptsUsed: number;
  gameStatus: GuessResponse["game_status"] | null;
  slots: GuessSlot[];
  gameId: string;
  previewUrl: string;
  reveal: TrackDetails | null;
};

/**
 * Game hook for **one** category. With `NEXT_PUBLIC_DEV_MODE=true`, parent should remount with
 * `key={activeCategory}` so each pill gets a fresh tree; legacy mode keeps a stable key.
 */
export function useGame(category: string, opts?: { date?: string }) {
  const dateOverride = (opts?.date ?? "").trim();
  const resolvedDateKey = useMemo(() => {
    return dateOverride || getLocalDateKey();
  }, [dateOverride]);
  const [bootstrapped, setBootstrapped] = useState(false);

  const [sessionId, setSessionId] = useState("");
  const [gameState, setGameState] = useState<GameState>("IDLE");
  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const [gameStatus, setGameStatus] = useState<
    GuessResponse["game_status"] | null
  >(null);
  const [slots, setSlots] = useState<GuessSlot[]>(() => emptySlots());
  const [reveal, setReveal] = useState<TrackDetails | null>(null);

  const [gameId, setGameId] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");

  const [dailyLoading, setDailyLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [guessError, setGuessError] = useState<string | null>(null);

  const persistMirrorRef = useRef<PersistMirror>({
    gameState: "IDLE",
    attemptsUsed: 0,
    gameStatus: null,
    slots: emptySlots(),
    gameId: "",
    previewUrl: "",
    reveal: null,
  });

  persistMirrorRef.current = {
    gameState,
    attemptsUsed,
    gameStatus,
    slots,
    gameId,
    previewUrl,
    reveal,
  };

  const applyDailyPayload = useCallback((payload: DailyGamePayload) => {
    setGameId(payload.game_id);
    setPreviewUrl(payload.preview_url);
  }, []);

  const applyGuessResponse = useCallback(
    (
      res: GuessResponse,
      pickedLabel: string,
      variant: GuessSlot["variant"],
      tidalId?: string,
    ) => {
      setAttemptsUsed(res.attempts_used);
      setGameStatus(res.game_status);

      setSlots((prev) => {
        const next = [...prev];
        const idx = Math.min(res.attempts_used - 1, MAX_ATTEMPTS - 1);
        if (idx >= 0 && idx < MAX_ATTEMPTS) {
          const slotVariant: GuessSlot["variant"] = res.is_correct
            ? "correct"
            : variant;
          next[idx] = {
            line: pickedLabel,
            variant: slotVariant,
            tidalId,
          };
        }
        return next;
      });

      if (res.game_status === "WON" || res.game_status === "LOST") {
        setReveal(res.track_details);
        setGameState("FINISHED");
      } else {
        setGameState((prev) => (prev === "FINISHED" ? prev : "PLAYING"));
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const today = resolvedDateKey;
    migrateLegacyStorageIfPresent(today);

    if (ENABLE_STRICT_CATEGORY_LOGIC) {
      persistMirrorRef.current = {
        gameState: "IDLE",
        attemptsUsed: 0,
        gameStatus: null,
        slots: emptySlots(),
        gameId: "",
        previewUrl: "",
        reveal: null,
      };
    }

    setSessionId(getOrCreateSessionId(today, category));
    setGuessError(null);

    const persisted = readCategoryPersisted(today, category);

    if (persisted) {
      const finished = isTerminalStatus(persisted.gameStatus);
      setAttemptsUsed(persisted.attemptsUsed);
      setGameStatus(persisted.gameStatus);
      setSlots(
        persisted.slots.length === MAX_ATTEMPTS
          ? persisted.slots
          : emptySlots(),
      );
      setReveal(persisted.reveal);
      setGameId(persisted.gameId);
      setPreviewUrl(persisted.previewUrl);
      setGameState(
        finished
          ? "FINISHED"
          : normalizePersistedGameState(persisted.gameState),
      );
      setLoadError(null);
      setDailyLoading(false);
      setBootstrapped(true);
      void (async () => {
        try {
          const payload = await fetchDailyGame(category, today);
          if (cancelled) return;
          const sameGame =
            String(payload.game_id).trim() ===
            String(persisted.gameId).trim();
          if (sameGame && payload.preview_url) {
            setPreviewUrl(payload.preview_url);
          }
        } catch {
          /* keep persisted preview_url if /daily fails */
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    setDailyLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const payload = await fetchDailyGame(category, today);
        if (cancelled) return;

        setAttemptsUsed(0);
        setGameStatus("PLAYING");
        setSlots(emptySlots());
        setReveal(null);
        setGameState("PLAYING");
        setGameId(payload.game_id);
        setPreviewUrl(payload.preview_url);
        setLoadError(null);
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof ApiError ? e.message : "Could not load today's game.";
        setLoadError(msg);
        setGameId("");
        setPreviewUrl("");
        setGameState("IDLE");
      } finally {
        if (!cancelled) {
          setDailyLoading(false);
          setBootstrapped(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [category, resolvedDateKey]);

  useEffect(() => {
    const today = resolvedDateKey;
    const cat = category;
    return () => {
      const m = persistMirrorRef.current;
      if (!m.gameId.trim()) return;
      writeCategoryPersisted(
        today,
        sliceToPersist(today, cat, m),
      );
    };
  }, [category, resolvedDateKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !bootstrapped || !gameId.trim()) {
      return;
    }
    const today = resolvedDateKey;
    writeCategoryPersisted(
      today,
      sliceToPersist(today, category, persistMirrorRef.current),
    );
  }, [
    bootstrapped,
    category,
    gameState,
    attemptsUsed,
    slots,
    gameStatus,
    gameId,
    previewUrl,
    reveal,
    resolvedDateKey,
  ]);

  const currentAttempt = Math.min(
    Math.max(attemptsUsed, 0),
    GUESS_DURATIONS_MS.length - 1,
  );

  const currentAllowedTimeMs = GUESS_DURATIONS_MS[currentAttempt];

  const guesses = useMemo(() => slotsToGuesses(slots), [slots]);

  const isFinished =
    gameState === "FINISHED" || isTerminalStatus(gameStatus);

  const guessSubmitting = gameState === "LOCKED";

  const daily = useMemo((): DailyGamePayload | null => {
    const gid = gameId.trim();
    const p = previewUrl.trim();
    if (!gid || !p) return null;
    return {
      game_id: gid,
      preview_url: p,
    };
  }, [gameId, previewUrl]);

  const startGame = useCallback(() => {
    setGameState((s) => {
      if (s === "FINISHED" || s === "LOCKED") return s;
      return "PLAYING";
    });

    // Server-side playback timing validation has been removed; timing is enforced only
    // by snippet capping on the client (audio-player) and backend guess validation.
  }, [attemptsUsed, gameId, gameState, sessionId]);

  const pauseGame = useCallback(() => {
    setGameState((s) => (s === "PLAYING" ? "PAUSED" : s));

    if (!gameId || !sessionId) return;
    // No-op: server-side playback timing validation has been removed.
  }, [gameId, sessionId]);

  const reloadDaily = useCallback(async () => {
    setDailyLoading(true);
    setLoadError(null);
    const today = resolvedDateKey;
    try {
      removeCategoryPersisted(today, category);
      const newSid = resetSessionId(today, category);
      setSessionId(newSid);
      const payload = await fetchDailyGame(category, today);
      applyDailyPayload(payload);
      setAttemptsUsed(0);
      setGameStatus("PLAYING");
      setGameState("PLAYING");
      setSlots(emptySlots());
      setReveal(null);
      setGuessError(null);
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : "Could not load today's game.";
      setLoadError(msg);
      setGameId("");
      setPreviewUrl("");
      setGameState("IDLE");
    } finally {
      setDailyLoading(false);
    }
  }, [category, applyDailyPayload, resolvedDateKey]);

  const submitGuess = useCallback(
    async (trackId: string) => {
      if (!gameId || guessSubmitting || isFinished) return;
      if (trackId === SKIP_GUESS_TIDAL_ID) return;

      setGuessError(null);
      setGameState("LOCKED");
      const display =
        trackId.length > 24 ? `${trackId.slice(0, 12)}…` : trackId;

      try {
        const res = await apiSubmitGuess({
          session_id: sessionId,
          game_id: gameId,
          guessed_tidal_track_id: trackId,
        });
        applyGuessResponse(res, display, res.is_correct ? "correct" : "wrong");
      } catch (e) {
        const msg =
          e instanceof ApiError ? e.message : "Guess could not be sent.";
        setGuessError(msg);
        setGameState((prev) => (prev === "FINISHED" ? prev : "PLAYING"));
      }
    },
    [gameId, guessSubmitting, isFinished, sessionId, applyGuessResponse],
  );

  const submitPick = useCallback(
    async (track: SearchTrackResult) => {
      if (!gameId || guessSubmitting || isFinished) return;
      setGuessError(null);
      setGameState("LOCKED");
      const label = formatWrongLabel(track);
      try {
        const res = await apiSubmitGuess({
          session_id: sessionId,
          game_id: gameId,
          guessed_tidal_track_id: track.tidal_id,
        });
        applyGuessResponse(
          res,
          label,
          res.is_correct ? "correct" : "wrong",
          track.tidal_id,
        );
      } catch (e) {
        const msg =
          e instanceof ApiError ? e.message : "Guess could not be sent.";
        setGuessError(msg);
        setGameState((prev) => (prev === "FINISHED" ? prev : "PLAYING"));
      }
    },
    [gameId, guessSubmitting, isFinished, sessionId, applyGuessResponse],
  );

  const skipTurn = useCallback(async () => {
    if (!gameId || guessSubmitting || isFinished) return;
    setGuessError(null);
    setGameState("LOCKED");
    try {
      const res = await apiSubmitGuess({
        session_id: sessionId,
        game_id: gameId,
        guessed_tidal_track_id: SKIP_GUESS_TIDAL_ID,
      });
      applyGuessResponse(res, "POMINIĘTO", "skip");
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : "Skip could not be sent.";
      setGuessError(msg);
      setGameState((prev) => (prev === "FINISHED" ? prev : "PLAYING"));
    }
  }, [gameId, guessSubmitting, isFinished, sessionId, applyGuessResponse]);

  const activeSlotIndex = isFinished
    ? -1
    : Math.min(attemptsUsed, MAX_ATTEMPTS - 1);

  const maxPlaySeconds = currentAllowedTimeMs / 1000;

  return {
    gameState,
    currentAttempt,
    guesses,
    previewUrl: previewUrl || null,
    gameId: gameId || null,
    isFinished,
    currentAllowedTimeMs,
    startGame,
    pauseGame,
    submitGuess,
    skipTurn,

    sessionId,
    daily,
    dailyLoading,
    loadError,
    reloadDaily,
    attemptsUsed,
    gameStatus,
    slots,
    activeSlotIndex,
    maxPlaySeconds,
    reveal,
    guessError,
    guessSubmitting,
    submitPick,
    skip: skipTurn,
    isTerminal: isFinished,
  };
}
