"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { AudioPlayer } from "@/components/audio-player";
import { GuessFields } from "@/components/guess-fields";
import { ResultModal } from "@/components/result-modal";
import { SearchCombobox } from "@/components/search-combobox";
import { useGame, wipeAllHitGuessLocalStorage } from "@/hooks/use-game";
import { ENABLE_DEV_MODE } from "@/lib/feature-flags";

type GameCategoryPanelProps = {
  /** Pill label — must match `GET /daily?category=` and localStorage scope. */
  category: string;
  /** Optional archive date (YYYY-MM-DD). */
  date?: string;
};

const DevConsole = ENABLE_DEV_MODE
  ? dynamic(
      () => import("@/components/dev-console").then((m) => m.DevConsole),
      { ssr: false },
    )
  : null;

/**
 * With strict dev mode (`NEXT_PUBLIC_DEV_MODE=true`), parent remounts per category via `key`.
 */
export function GameCategoryPanel({ category, date }: GameCategoryPanelProps) {
  const g = useGame(category, { date });
  const [resultOpen, setResultOpen] = useState(false);

  useEffect(() => {
    const shouldOpen =
      g.isFinished && g.reveal && (g.gameStatus === "WON" || g.gameStatus === "LOST");
    if (shouldOpen) setResultOpen(true);
  }, [g.isFinished, g.gameStatus, g.reveal]);

  const previewForAudio =
    (g.previewUrl ?? g.daily?.preview_url ?? "").trim() || "";

  const canPlayPreview =
    !g.dailyLoading &&
    previewForAudio.length > 0 &&
    (g.isFinished || g.gameState !== "LOCKED");

  const canGuess =
    canPlayPreview && Boolean(g.gameId) && !g.isFinished;

  return (
    <>
      {DevConsole ? (
        <DevConsole
          category={category}
          gameId={g.gameId}
          previewUrl={g.previewUrl}
          resetCategory={g.reloadDaily}
          wipeAll={wipeAllHitGuessLocalStorage}
        />
      ) : null}
      {g.reveal && (g.gameStatus === "WON" || g.gameStatus === "LOST") ? (
        <ResultModal
          isOpen={resultOpen}
          onClose={() => setResultOpen(false)}
          category={category}
          gameStatus={g.gameStatus}
          slots={g.slots}
          trackDetails={g.reveal}
        />
      ) : null}
      {g.loadError ? (
        <div className="mb-3 shrink-0 border border-red-800/30 bg-red-50/90 p-3 text-[11px] font-bold uppercase leading-snug text-red-900">
          {g.loadError}
          <button
            type="button"
            onClick={() => void g.reloadDaily()}
            className="ml-2 underline"
            style={{ color: "#0000FF" }}
          >
            Spróbuj ponownie
          </button>
        </div>
      ) : null}

      <div className="mb-5 shrink-0">
        <AudioPlayer
          key={`${category}-${g.gameId ?? ""}`}
          deckId={category}
          previewUrl={g.previewUrl ?? g.daily?.preview_url}
          currentAttempt={g.attemptsUsed}
          attemptEpoch={g.attemptsUsed}
          isFinished={g.isFinished}
          expandTimelineTo30s={g.isFinished}
          disabled={!canPlayPreview}
          onPlayingChange={(playing) => {
            if (playing) g.startGame();
            else g.pauseGame();
          }}
        />
      </div>

      <div className="mb-4 min-h-0 shrink-0">
        <GuessFields slots={g.slots} activeIndex={g.activeSlotIndex} />
      </div>

      <div className="flex shrink-0 gap-2">
        <SearchCombobox
          disabled={!canGuess}
          onTrackSelect={(t) => void g.submitPick(t)}
        />
        <button
          type="button"
          disabled={!canGuess}
          onClick={() => void g.skip()}
          className="h-9 shrink-0 px-5 text-[10px] font-black uppercase tracking-wider text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#EBE7DF] disabled:cursor-not-allowed disabled:opacity-45"
          style={{ backgroundColor: "#0000FF" }}
        >
          POMIŃ
        </button>
      </div>

      {g.guessError ? (
        <p className="mt-2 shrink-0 text-[10px] font-bold uppercase text-red-800">
          {g.guessError}
        </p>
      ) : null}

      <p className="mt-4 shrink-0 text-[9px] text-black/45">
        Zgłoś błąd?{" "}
        <button
          type="button"
          className="font-normal underline decoration-black/30 underline-offset-2"
        >
          [Konsola]
        </button>
      </p>
    </>
  );
}
