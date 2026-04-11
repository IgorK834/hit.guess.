"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

const STORAGE_KEY = "hitguess_session_v1";

export const AUDIO_SEGMENT_CAPS = [1, 2, 4, 7, 11, 16] as const;

export const MAX_ATTEMPTS = 6;

export type GuessSlot = {
  line: string;
  variant: "empty" | "wrong" | "skip" | "correct";
};

function emptySlots(): GuessSlot[] {
  return Array.from({ length: MAX_ATTEMPTS }, () => ({
    line: "",
    variant: "empty" as const,
  }));
}

function loadSessionId(): string {
  if (typeof window === "undefined") return "";
  const today = getLocalDateKey();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { date?: string; sessionId?: string };
      if (parsed.date === today && parsed.sessionId) {
        return parsed.sessionId;
      }
    }
  } catch {
    /* ignore */
  }
  const sessionId = crypto.randomUUID();
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ v: 1, date: today, sessionId }),
  );
  return sessionId;
}

function formatWrongLabel(track: SearchTrackResult): string {
  return `${track.artist} — ${track.title}`;
}

export function useGame() {
  const [sessionId] = useState<string>(() => loadSessionId());
  const [daily, setDaily] = useState<DailyGamePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dailyLoading, setDailyLoading] = useState(true);

  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const [gameStatus, setGameStatus] = useState<GuessResponse["game_status"] | null>(null);
  const [slots, setSlots] = useState<GuessSlot[]>(() => emptySlots());
  const [reveal, setReveal] = useState<TrackDetails | null>(null);

  const [guessError, setGuessError] = useState<string | null>(null);
  const [guessSubmitting, setGuessSubmitting] = useState(false);

  const reloadDaily = useCallback(async () => {
    setDailyLoading(true);
    setLoadError(null);
    try {
      const payload = await fetchDailyGame();
      setDaily(payload);
      setAttemptsUsed(0);
      setGameStatus("PLAYING");
      setSlots(emptySlots());
      setReveal(null);
      setGuessError(null);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not load today's game.";
      setLoadError(msg);
      setDaily(null);
    } finally {
      setDailyLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadDaily();
  }, [reloadDaily]);

  const maxPlaySeconds = useMemo(() => {
    const idx = Math.min(Math.max(attemptsUsed, 0), AUDIO_SEGMENT_CAPS.length - 1);
    return AUDIO_SEGMENT_CAPS[idx];
  }, [attemptsUsed]);

  const applyGuessResponse = useCallback(
    (res: GuessResponse, pickedLabel: string, variant: GuessSlot["variant"]) => {
      setAttemptsUsed(res.attempts_used);
      setGameStatus(res.game_status);

      setSlots((prev) => {
        const next = [...prev];
        const idx = Math.min(res.attempts_used - 1, MAX_ATTEMPTS - 1);
        if (idx >= 0 && idx < MAX_ATTEMPTS) {
          const slotVariant: GuessSlot["variant"] = res.is_correct ? "correct" : variant;
          next[idx] = { line: pickedLabel, variant: slotVariant };
        }
        return next;
      });

      if (res.game_status === "WON" || res.game_status === "LOST") {
        setReveal(res.track_details);
      }
    },
    [],
  );

  const submitPick = useCallback(
    async (track: SearchTrackResult) => {
      if (!daily || guessSubmitting || gameStatus === "WON" || gameStatus === "LOST") return;
      setGuessError(null);
      setGuessSubmitting(true);
      const label = formatWrongLabel(track);
      try {
        const res = await apiSubmitGuess({
          session_id: sessionId,
          game_id: daily.game_id,
          guessed_tidal_track_id: track.tidal_id,
        });
        applyGuessResponse(
          res,
          label,
          res.is_correct ? "correct" : "wrong",
        );
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "Guess could not be sent.";
        setGuessError(msg);
      } finally {
        setGuessSubmitting(false);
      }
    },
    [daily, guessSubmitting, gameStatus, sessionId, applyGuessResponse],
  );

  const skip = useCallback(async () => {
    if (!daily || guessSubmitting || gameStatus === "WON" || gameStatus === "LOST") return;
    setGuessError(null);
    setGuessSubmitting(true);
    try {
      const res = await apiSubmitGuess({
        session_id: sessionId,
        game_id: daily.game_id,
        guessed_tidal_track_id: SKIP_GUESS_TIDAL_ID,
      });
      applyGuessResponse(res, "POMINIĘTO", "skip");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Skip could not be sent.";
      setGuessError(msg);
    } finally {
      setGuessSubmitting(false);
    }
  }, [daily, guessSubmitting, gameStatus, sessionId, applyGuessResponse]);

  const isTerminal = gameStatus === "WON" || gameStatus === "LOST";
  const activeSlotIndex = isTerminal ? -1 : Math.min(attemptsUsed, MAX_ATTEMPTS - 1);

  return {
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
    skip,
    isTerminal,
  };
}
