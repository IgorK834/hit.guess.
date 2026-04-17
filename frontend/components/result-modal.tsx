"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Check, Share2, X } from "lucide-react";

import type { GuessSlot } from "@/hooks/use-game";
import type { GameStatsResponse, TrackDetails } from "@/lib/api";
import { fetchGameStats } from "@/lib/api";
import { getLocalDateKey } from "@/lib/clientTimezone";
import { safeAlbumCoverSrc } from "@/lib/cover-url";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { GuessDistribution } from "@/components/guess-distribution";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type ResultModalProps = {
  isOpen: boolean;
  onClose: () => void;
  gameId: string;
  category: string;
  gameStatus: "WON" | "LOST";
  slots: GuessSlot[];
  trackDetails: TrackDetails;
};

const SHARE_ATTEMPTS = 5;

function generateEmojiGrid(slots: GuessSlot[]): string {
  const out: string[] = [];
  for (let i = 0; i < SHARE_ATTEMPTS; i++) {
    const s = slots[i];
    if (!s || s.variant === "empty" || s.variant === "skip") out.push("⬛");
    else if (s.variant === "correct") out.push("🟩");
    else out.push("🟥");
  }
  return out.join(" ");
}

export function ResultModal({
  isOpen,
  onClose,
  gameId,
  category,
  gameStatus,
  slots,
  trackDetails,
}: ResultModalProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<GameStatsResponse | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const isWin = gameStatus === "WON";
  const userAttempt = useMemo(() => {
    const idx = slots.findIndex((s) => s.variant === "correct");
    if (idx === -1) return null;
    return idx + 1;
  }, [slots]);
  const handleClose = () => {
    setCopied(false);
    onClose();
  };

  useEffect(() => {
    const gid = gameId.trim();
    if (!isOpen || gid.length === 0) return;
    let cancelled = false;
    setStatsLoading(true);
    setStatsError(null);
    void (async () => {
      try {
        const data = await fetchGameStats(gid);
        if (cancelled) return;
        setStats(data);
      } catch (e) {
        if (cancelled) return;
        setStats(null);
        setStatsError(e instanceof Error ? e.message : "Failed to load community stats.");
      } finally {
        if (cancelled) return;
        setStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId, isOpen]);

  const shareText = useMemo(() => {
    const date = getLocalDateKey();
    const grid = generateEmojiGrid(slots);
    return `HIT.GUESS. (${category}) - ${date}\n🔊 ${grid}\nhttps://hitguess.com`;
  }, [category, slots]);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      toast({
        title: "Skopiowano",
        description: "Wynik skopiowany do schowka.",
      });
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast({
        title: "Nie udało się skopiować",
        description: "Brak uprawnień do schowka.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => (!open ? handleClose() : null)}
    >
      <DialogContent
        showCloseButton={false}
        className="aspect-[5/3] w-[min(92vw,760px)] max-w-none gap-0 rounded-none border-black/70 bg-[#EBE7DF] p-0"
      >
        <DialogHeader className="border-b border-black/10 p-4 pb-3">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xs font-mono font-bold uppercase tracking-widest">
              {isWin ? (
                <span style={{ color: "#0000FF" }}>KATEGORIA UKOŃCZONA</span>
              ) : (
                <span className="text-black">KONIEC PRÓB</span>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Szczegóły wyniku gry dla wybranej kategorii.
            </DialogDescription>
            <button
              type="button"
              onClick={handleClose}
              className="text-black/45 transition-colors hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#EBE7DF]"
              aria-label="Zamknij"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </DialogHeader>

        <div className="border-b border-black/10 p-6">
          <div className="flex items-center gap-5">
            <div className="flex h-28 w-28 shrink-0 items-center justify-center border border-black/10 bg-white/40">
              <Image
                src={safeAlbumCoverSrc(trackDetails.album_cover)}
                alt={`${trackDetails.title} album cover`}
                unoptimized
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
                width={112}
                height={112}
                onError={(e) => {
                  const el = e.currentTarget;
                  if (el.getAttribute("data-fallback") === "1") return;
                  el.setAttribute("data-fallback", "1");
                  el.src = "/placeholder-album.svg";
                }}
              />
            </div>

            <div className="min-w-0">
              <h3 className="truncate text-lg font-black leading-tight text-black md:text-xl">
                {trackDetails.title}
              </h3>
              <p className="mt-1 truncate text-sm font-bold uppercase text-black/55">
                {trackDetails.artist}
              </p>
              <span
                className="mt-2 inline-block border px-2 py-1 font-mono text-[10px] font-bold uppercase"
                style={{ borderColor: "#0000FF", color: "#0000FF" }}
              >
                {category}
              </span>
            </div>
          </div>
        </div>

        <div className="border-b border-black/10 p-4">
          {statsLoading ? (
            <div className="font-mono text-[10px] font-bold uppercase text-black/45">
              Loading community stats...
            </div>
          ) : stats ? (
            <GuessDistribution
              distribution={stats.distribution}
              totalWins={stats.total_wins}
              userAttempt={isWin ? userAttempt : null}
            />
          ) : (
            <div className="font-mono text-[10px] font-bold uppercase text-black/45">
              {statsError ?? "Community stats unavailable."}
            </div>
          )}
        </div>

        <div className="border-b border-black/10 p-4">
          <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-wider text-black/55">
            HISTORIA PRÓB
          </p>
          <div className="flex gap-1.5">
            {Array.from({ length: SHARE_ATTEMPTS }, (_, index) => {
              const s = slots[index];
              const variant = s?.variant ?? "empty";
              const cls =
                variant === "correct"
                  ? "bg-[#0000FF] border-[#0000FF] text-white"
                  : variant === "wrong"
                    ? "bg-black border-black text-[#EBE7DF]"
                    : "bg-white/40 border-black/10 text-black/35";
              return (
                <div
                  key={index}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center border text-[10px] font-mono font-bold",
                    cls,
                  )}
                >
                  {index + 1}
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter className="flex-row gap-2 p-4">
          <button
            type="button"
            onClick={onClose}
            className="h-9 flex-1 border border-black/15 bg-transparent font-mono text-xs font-bold uppercase tracking-wider text-black/55 hover:bg-black/5 hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#EBE7DF]"
          >
            Zamknij
          </button>
          <button
            type="button"
            onClick={() => void handleShare()}
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 bg-[#0000FF] font-mono text-xs font-bold uppercase tracking-wider text-white hover:bg-[#0000CC] focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#EBE7DF]"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden />
                Skopiowano
              </>
            ) : (
              <>
                <Share2 className="h-3.5 w-3.5" aria-hidden />
                Udostępnij wynik
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

