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
import { getLocalDateKey } from "@/lib/clientTimezone";

/** Daily game snapshot persisted under {@link DAILY_STORAGE_KEY}. */
export const DAILY_STORAGE_KEY = "hit_guess_daily_state";

const PERSIST_VERSION = 2 as const;

export type GameState = "IDLE" | "PLAYING" | "PAUSED" | "LOCKED" | "FINISHED";

export const GUESS_DURATIONS_MS = [
  1000, 2000, 4000, 7000, 11000, 16000,
] as const;

/** Segment caps in seconds — derived from {@link GUESS_DURATIONS_MS} for the audio UI. */
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

type HitGuessDailyPersisted = {
  v: typeof PERSIST_VERSION;
  date: string;
  sessionId: string;
  gameState: GameState;
  attemptsUsed: number;
  slots: GuessSlot[];
  gameStatus: GuessResponse["game_status"] | null;
  gameId: string;
  previewUrl: string;
  difficulty_level: number;
  reveal: TrackDetails | null;
};

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

function normalizePersistedGameState(gs: GameState): GameState {
  if (gs === "LOCKED") return "PLAYING";
  return gs;
}

function isTerminalStatus(
  s: GuessResponse["game_status"] | null,
): s is "WON" | "LOST" {
  return s === "WON" || s === "LOST";
}

function readPersisted(): HitGuessDailyPersisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DAILY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (o.v !== PERSIST_VERSION || typeof o.date !== "string") return null;
    if (typeof o.sessionId !== "string") return null;
    if (typeof o.gameId !== "string" || typeof o.previewUrl !== "string")
      return null;
    if (typeof o.attemptsUsed !== "number" || !Array.isArray(o.slots))
      return null;
    return o as unknown as HitGuessDailyPersisted;
  } catch {
    return null;
  }
}

export function useGame() {
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
  const [difficultyLevel, setDifficultyLevel] = useState(0);

  const [dailyLoading, setDailyLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [guessError, setGuessError] = useState<string | null>(null);

  const bootstrapOnce = useRef(false);

  const applyDailyPayload = useCallback((payload: DailyGamePayload) => {
    setGameId(payload.game_id);
    setPreviewUrl(payload.preview_url);
    setDifficultyLevel(payload.difficulty_level);
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
    if (bootstrapOnce.current) return;
    bootstrapOnce.current = true;

    let cancelled = false;
    const today = getLocalDateKey();

    void (async () => {
      const persisted = readPersisted();
      const stale = !persisted || persisted.date !== today;

      if (stale && typeof window !== "undefined") {
        window.localStorage.removeItem(DAILY_STORAGE_KEY);
      }

      if (persisted && !stale) {
        const finished = isTerminalStatus(persisted.gameStatus);
        setSessionId(persisted.sessionId);
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
        setDifficultyLevel(persisted.difficulty_level);
        setGameState(
          finished
            ? "FINISHED"
            : normalizePersistedGameState(persisted.gameState),
        );

        if (finished) {
          if (!cancelled) {
            setLoadError(null);
            setDailyLoading(false);
            setBootstrapped(true);
          }
          return;
        }
      } else {
        setSessionId(crypto.randomUUID());
      }

      setDailyLoading(true);
      setLoadError(null);

      try {
        const payload = await fetchDailyGame();
        if (cancelled) return;

        if (persisted && !stale && !isTerminalStatus(persisted.gameStatus)) {
          if (payload.game_id !== persisted.gameId) {
            setAttemptsUsed(0);
            setGameStatus("PLAYING");
            setSlots(emptySlots());
            setReveal(null);
            setGameState("PLAYING");
          }
        } else if (stale) {
          setAttemptsUsed(0);
          setGameStatus("PLAYING");
          setSlots(emptySlots());
          setReveal(null);
          setGameState("PLAYING");
        }

        applyDailyPayload(payload);
        setLoadError(null);
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof ApiError ? e.message : "Could not load today's game.";
        setLoadError(msg);
        if (stale || !persisted) {
          setGameId("");
          setPreviewUrl("");
          setGameState("IDLE");
        }
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
  }, [applyDailyPayload]);

  useEffect(() => {
    if (typeof window === "undefined" || !bootstrapped || !gameId) return;

    const toSave: HitGuessDailyPersisted = {
      v: PERSIST_VERSION,
      date: getLocalDateKey(),
      sessionId,
      gameState: gameState === "LOCKED" ? "PLAYING" : gameState,
      attemptsUsed,
      slots,
      gameStatus,
      gameId,
      previewUrl,
      difficulty_level: difficultyLevel,
      reveal,
    };

    try {
      window.localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      /* quota / private mode */
    }
  }, [
    bootstrapped,
    sessionId,
    gameState,
    attemptsUsed,
    slots,
    gameStatus,
    gameId,
    previewUrl,
    difficultyLevel,
    reveal,
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
    if (!gameId || !previewUrl) return null;
    return {
      game_id: gameId,
      preview_url: previewUrl,
      difficulty_level: difficultyLevel,
    };
  }, [gameId, previewUrl, difficultyLevel]);

  const startGame = useCallback(() => {
    setGameState((s) => {
      if (s === "FINISHED" || s === "LOCKED") return s;
      return "PLAYING";
    });
  }, []);

  const pauseGame = useCallback(() => {
    setGameState((s) => (s === "PLAYING" ? "PAUSED" : s));
  }, []);

  const reloadDaily = useCallback(async () => {
    setDailyLoading(true);
    setLoadError(null);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(DAILY_STORAGE_KEY);
      }
      const payload = await fetchDailyGame();
      setSessionId(crypto.randomUUID());
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
  }, [applyDailyPayload]);

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
      const msg = e instanceof ApiError ? e.message : "Skip could not be sent.";
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
