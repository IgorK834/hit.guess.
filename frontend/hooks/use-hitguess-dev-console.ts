"use client";

import { useEffect, useRef } from "react";

import { wipeAllHitGuessLocalStorage } from "@/hooks/use-game";
import { ENABLE_DEV_MODE } from "@/lib/feature-flags";

export type HitGuessDevGlobal = {
  /** Nowa runda w aktywnej kategorii (jak przycisk „DEV: reset kategorii”). */
  reset: () => Promise<void>;
  /** Usuwa wszystkie `hit_guess_*` z localStorage i przeładowuje stronę. */
  wipe: () => void;
  /** Wypisuje aktywny `game_id` (bez ujawniania tytułu/artysty). */
  revealGameId: () => string | null;
  /** Wymuś stan końcowy bez zgadywania. */
  force: (s: "WON" | "LOST") => void;
  /** Wstrzykuje mock stanu (4 błędne + 1 poprawna albo przegrana). */
  mock: (m: "almost-won" | "lost") => void;
  help: () => void;
};

declare global {
  interface Window {
    hitguess?: HitGuessDevGlobal;
  }
}

/**
 * Udostępnia w konsoli `window.hitguess` gdy `NEXT_PUBLIC_ENABLE_DEV_MODE=true`.
 * Wymaga działającego API (reset ładuje `/daily` od zera dla tej kategorii).
 */
export function useHitGuessDevConsole(
  opts: {
    reloadDaily: () => Promise<void>;
    getGameId: () => string | null;
    forceFinish: (s: "WON" | "LOST") => void;
    injectMock: (m: "almost-won" | "lost") => void;
  },
): void {
  const reloadRef = useRef(opts.reloadDaily);
  const getGameIdRef = useRef(opts.getGameId);
  const forceRef = useRef(opts.forceFinish);
  const mockRef = useRef(opts.injectMock);

  useEffect(() => {
    reloadRef.current = opts.reloadDaily;
    getGameIdRef.current = opts.getGameId;
    forceRef.current = opts.forceFinish;
    mockRef.current = opts.injectMock;
  }, [opts.reloadDaily, opts.getGameId, opts.forceFinish, opts.injectMock]);

  useEffect(() => {
    if (!ENABLE_DEV_MODE || typeof window === "undefined") {
      return;
    }

    const api: HitGuessDevGlobal = {
      reset: () => reloadRef.current(),
      wipe: () => {
        wipeAllHitGuessLocalStorage();
        window.location.reload();
      },
      revealGameId: () => getGameIdRef.current(),
      force: (s) => forceRef.current(s),
      mock: (m) => mockRef.current(m),
      help: () => {
        console.info(
          "%c[HIT.GUESS dev]%c\n" +
            "  hitguess.reset()         — nowa runda (bieżąca kategoria), nowa sesja, świeży /daily\n" +
            "  hitguess.wipe()          — usuń cały stan gry (wszystkie kategorie) + reload\n" +
            "  hitguess.revealGameId()  — pokaż game_id bieżącej kategorii\n" +
            "  hitguess.force('WON')    — wymuś wygraną (test modali / share)\n" +
            "  hitguess.force('LOST')   — wymuś przegraną\n" +
            "  hitguess.mock('almost-won') — 4 błędne + 1 poprawna (mock)\n" +
            "  hitguess.mock('lost')       — 6 błędnych (mock)\n" +
            "  hitguess.help()          — ta pomoc\n" +
            "Wymaga NEXT_PUBLIC_ENABLE_DEV_MODE=true (lub legacy NEXT_PUBLIC_DEV_MODE=true) w `.env.local` po restarcie `pnpm dev`.",
          "color:#0000FF;font-weight:bold",
          "color:inherit",
        );
      },
    };

    window.hitguess = api;
    if (process.env.NODE_ENV === "development") {
      console.info(
        "%c[HIT.GUESS dev]%c Wpisz hitguess.help() — reset gry z konsoli.",
        "color:#0000FF;font-weight:bold",
        "color:inherit",
      );
    }

    return () => {
      if (window.hitguess === api) {
        delete window.hitguess;
      }
    };
  }, []);
}
