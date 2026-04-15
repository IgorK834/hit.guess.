"use client";

import { useEffect, useMemo, useState } from "react";

import { useHitGuessDevConsole } from "@/hooks/use-hitguess-dev-console";
import { dailyStateStorageKey, type GuessSlot, MAX_ATTEMPTS } from "@/hooks/use-game";
import { getLocalDateKey } from "@/lib/clientTimezone";
import { ENABLE_DEV_MODE } from "@/lib/feature-flags";

export type DevConsoleActions = {
  category: string;
  gameId: string | null;
  previewUrl: string | null;
  resetCategory: () => Promise<void>;
  wipeAll: () => void;
};

function prettyCategory(cat: string): string {
  return (cat || "").trim() || "—";
}

type DevPersisted = {
  v: 5;
  date: string;
  uiCategory: string;
  gameState: "FINISHED";
  attemptsUsed: number;
  gameStatus: "WON" | "LOST";
  slots: GuessSlot[];
  gameId: string;
  previewUrl: string;
  reveal: { title: string; artist: string; album_cover: string } | null;
};

function writeDevSnapshot(payload: DevPersisted) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      dailyStateStorageKey(payload.date, payload.uiCategory),
      JSON.stringify(payload),
    );
  } catch {
    /* ignore */
  }
}

export function DevConsole(props: DevConsoleActions) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<null | "gameId">(null);

  const title = useMemo(() => {
    return `DEV • ${prettyCategory(props.category)}`;
  }, [props.category]);

  useEffect(() => {
    if (!ENABLE_DEV_MODE) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!ENABLE_DEV_MODE) return null;

  const force = (s: "WON" | "LOST") => {
    const date = getLocalDateKey();
    const gid = (props.gameId ?? "").trim();
    const p = (props.previewUrl ?? "").trim();
    if (!gid || !p) return;

    const slots: GuessSlot[] =
      s === "WON"
        ? [
            { line: "DEV — WRONG 1", variant: "wrong" },
            { line: "DEV — WRONG 2", variant: "wrong" },
            { line: "DEV — WRONG 3", variant: "wrong" },
            { line: "DEV — WRONG 4", variant: "wrong" },
            { line: "DEV — CORRECT", variant: "correct" },
            { line: "", variant: "empty" },
          ]
        : Array.from({ length: MAX_ATTEMPTS }, (_, i) => ({
            line: `DEV — WRONG ${i + 1}`,
            variant: "wrong" as const,
          }));

    writeDevSnapshot({
      v: 5,
      date,
      uiCategory: props.category,
      gameState: "FINISHED",
      attemptsUsed: s === "WON" ? 5 : MAX_ATTEMPTS,
      gameStatus: s,
      slots,
      gameId: gid,
      previewUrl: p,
      reveal: {
        title: "DEV: MOCK TRACK",
        artist: "HIT.GUESS",
        album_cover: "/placeholder-album.svg",
      },
    });
    window.location.reload();
  };

  const mock = (m: "almost-won" | "lost") => force(m === "lost" ? "LOST" : "WON");

  useHitGuessDevConsole({
    reloadDaily: props.resetCategory,
    getGameId: () => props.gameId,
    forceFinish: force,
    injectMock: mock,
  });

  return (
    <div className="fixed bottom-3 right-3 z-[80]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="border border-black/40 bg-[#EBE7DF] px-2 py-1 font-mono text-[8px] font-bold uppercase tracking-wide text-black shadow-sm hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#EBE7DF]"
        title="Ctrl+Shift+D"
      >
        DEV
      </button>

      {open ? (
        <div className="mt-2 w-[min(92vw,360px)] border-2 border-black bg-[#EBE7DF] p-3 shadow-[8px_8px_0_0_rgba(0,0,0,0.08)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div
                className="text-[10px] font-black uppercase tracking-[0.22em]"
                style={{ color: "#0000FF" }}
              >
                {title}
              </div>
              <div className="mt-1 font-mono text-[10px] text-black/60">
                Ctrl+Shift+D toggles
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="border border-black/20 bg-white/40 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-wide text-black hover:bg-black/5"
            >
              Close
            </button>
          </div>

          <div className="mt-3 grid gap-2">
            <div className="border border-black/10 bg-white/45 p-2 font-mono text-[10px] text-black/75">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">game_id</span>
                <button
                  type="button"
                  disabled={!props.gameId}
                  onClick={async () => {
                    if (!props.gameId) return;
                    await navigator.clipboard.writeText(props.gameId);
                    setCopied("gameId");
                    window.setTimeout(() => setCopied(null), 900);
                  }}
                  className="border border-black/20 bg-[#EBE7DF] px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-black disabled:opacity-40"
                >
                  {copied === "gameId" ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="mt-1 break-all text-[10px]">
                {props.gameId ?? "—"}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void props.resetCategory()}
                className="border border-black/30 bg-[#EBE7DF] px-2 py-2 font-mono text-[9px] font-bold uppercase tracking-wide text-black hover:bg-black/5"
                title="Clear this category state + reload /daily"
              >
                Reset category
              </button>
              <button
                type="button"
                onClick={() => {
                  props.wipeAll();
                  window.location.reload();
                }}
                className="border border-black/30 bg-[#EBE7DF] px-2 py-2 font-mono text-[9px] font-bold uppercase tracking-wide text-black hover:bg-black/5"
                title="Wipe all hit_guess_* keys + reload"
              >
                Wipe all
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => force("WON")}
                className="border border-black/30 bg-white/50 px-2 py-2 font-mono text-[9px] font-bold uppercase tracking-wide text-black hover:bg-black/5"
                title="Force game end state"
              >
                Force WON
              </button>
              <button
                type="button"
                onClick={() => force("LOST")}
                className="border border-black/30 bg-white/50 px-2 py-2 font-mono text-[9px] font-bold uppercase tracking-wide text-black hover:bg-black/5"
                title="Force game end state"
              >
                Force LOST
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => mock("almost-won")}
                className="border border-black/30 bg-[#EBE7DF] px-2 py-2 font-mono text-[9px] font-bold uppercase tracking-wide text-black hover:bg-black/5"
                title="4 wrong + 1 correct (mock UI)"
              >
                Mock 4W+1C
              </button>
              <button
                type="button"
                onClick={() => mock("lost")}
                className="border border-black/30 bg-[#EBE7DF] px-2 py-2 font-mono text-[9px] font-bold uppercase tracking-wide text-black hover:bg-black/5"
                title="6 wrong (mock UI)"
              >
                Mock LOST
              </button>
            </div>
          </div>

          <div className="mt-3 border-t border-black/10 pt-2 font-mono text-[9px] text-black/55">
            This panel is gated by{" "}
            <span className="font-bold">NEXT_PUBLIC_ENABLE_DEV_MODE</span>.
          </div>
        </div>
      ) : null}
    </div>
  );
}

