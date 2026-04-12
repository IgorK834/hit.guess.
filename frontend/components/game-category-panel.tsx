"use client";

import { AudioPlayer } from "@/components/audio-player";
import { GuessFields } from "@/components/guess-fields";
import { SearchCombobox } from "@/components/search-combobox";
import { useGame, wipeAllHitGuessLocalStorage } from "@/hooks/use-game";
import { ENABLE_STRICT_CATEGORY_LOGIC } from "@/lib/feature-flags";
import { safeAlbumCoverSrc } from "@/lib/cover-url";

type GameCategoryPanelProps = {
  /** Pill label — must match `GET /daily?category=` and localStorage scope. */
  category: string;
};

/**
 * With strict dev mode (`NEXT_PUBLIC_DEV_MODE=true`), parent remounts per category via `key`.
 */
export function GameCategoryPanel({ category }: GameCategoryPanelProps) {
  const g = useGame(category);

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
      {ENABLE_STRICT_CATEGORY_LOGIC ? (
        <div className="fixed bottom-3 right-3 z-[60] flex flex-col gap-1">
          <button
            type="button"
            className="border border-black/40 bg-[#EBE7DF] px-2 py-1 font-mono text-[8px] font-bold uppercase tracking-wide text-black shadow-sm hover:bg-black/5"
            title="Usuwa stan i sesję tej kategorii z localStorage i ładuje dzisiejszą rundę od zera"
            onClick={() => void g.reloadDaily()}
          >
            DEV: reset kategorii
          </button>
          <button
            type="button"
            className="border border-black/40 bg-[#EBE7DF] px-2 py-1 font-mono text-[8px] font-bold uppercase tracking-wide text-black shadow-sm hover:bg-black/5"
            title="Usuwa WSZYSTKIE klucze hit_guess_* (wszystkie kategorie i daty), potem przeładowanie — jak świeża przeglądarka"
            onClick={() => {
              wipeAllHitGuessLocalStorage();
              window.location.reload();
            }}
          >
            DEV: czysty start (całość)
          </button>
        </div>
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

      {g.isFinished && g.reveal ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#EBE7DF]/95 px-4 backdrop-blur-[1px]">
          <div className="w-full max-w-md border-2 border-black bg-[#EBE7DF] p-6 text-center shadow-[8px_8px_0_0_rgba(0,0,0,0.08)]">
            <p
              className="text-xs font-black uppercase tracking-[0.2em]"
              style={{ color: "#0000FF" }}
            >
              {g.gameStatus === "WON" ? "Wygrana" : "Koniec gry"}
            </p>
            <p className="mt-2 text-[10px] font-bold uppercase text-black/55">
              {category}
            </p>
            <img
              src={safeAlbumCoverSrc(g.reveal.album_cover)}
              alt=""
              referrerPolicy="no-referrer"
              className="mx-auto mt-4 h-40 w-40 border border-black/15 object-cover"
              width={160}
              height={160}
              onError={(e) => {
                const el = e.currentTarget;
                if (el.getAttribute("data-fallback") === "1") return;
                el.setAttribute("data-fallback", "1");
                el.src = "/placeholder-album.svg";
              }}
            />
            <h3 className="mt-4 text-lg font-black uppercase leading-tight text-black">
              {g.reveal.title}
            </h3>
            <p className="mt-1 text-sm font-bold uppercase text-black/60">
              {g.reveal.artist}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 h-10 w-full text-xs font-black uppercase tracking-wider text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
              style={{ backgroundColor: "#0000FF" }}
            >
              Zamknij
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
