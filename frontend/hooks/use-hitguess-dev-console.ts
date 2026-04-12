"use client";

import { useEffect, useRef } from "react";

import { wipeAllHitGuessLocalStorage } from "@/hooks/use-game";
import { ENABLE_DEV_MODE } from "@/lib/feature-flags";

export type HitGuessDevGlobal = {
  /** Nowa runda w aktywnej kategorii (jak przycisk „DEV: reset kategorii”). */
  reset: () => Promise<void>;
  /** Usuwa wszystkie `hit_guess_*` z localStorage i przeładowuje stronę. */
  wipe: () => void;
  help: () => void;
};

declare global {
  interface Window {
    hitguess?: HitGuessDevGlobal;
  }
}

/**
 * Udostępnia w konsoli `window.hitguess` gdy `NEXT_PUBLIC_DEV_MODE=true`.
 * Wymaga działającego API (reset ładuje `/daily` od zera dla tej kategorii).
 */
export function useHitGuessDevConsole(
  reloadDaily: () => Promise<void>,
): void {
  const reloadRef = useRef(reloadDaily);
  reloadRef.current = reloadDaily;

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
      help: () => {
        // eslint-disable-next-line no-console
        console.info(
          "%c[HIT.GUESS dev]%c\n" +
            "  hitguess.reset()  — nowa runda (bieżąca kategoria), nowa sesja, świeży /daily\n" +
            "  hitguess.wipe()   — usuń cały stan gry (wszystkie kategorie) + reload\n" +
            "  hitguess.help()   — ta pomoc\n" +
            "Wymaga NEXT_PUBLIC_DEV_MODE=true i .env.local po restarcie `npm run dev`.",
          "color:#0000FF;font-weight:bold",
          "color:inherit",
        );
      },
    };

    window.hitguess = api;
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
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
