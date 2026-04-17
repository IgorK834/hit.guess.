"use client";

import { cn } from "@/lib/utils";

export type GuessDistributionProps = {
  distribution: Record<"1" | "2" | "3" | "4" | "5" | "6", number>;
  totalWins: number;
  userAttempt?: number | null;
};

const ATTEMPTS = [1, 2, 3, 4, 5, 6] as const;
const ACCENT = "#0000FF";

export function GuessDistribution({
  distribution,
  totalWins,
  userAttempt,
}: GuessDistributionProps) {
  const max = Math.max(
    1,
    ...ATTEMPTS.map((n) => distribution[String(n) as keyof typeof distribution] ?? 0),
  );

  return (
    <div className="w-full">
      <div className="mb-2 flex items-end justify-between gap-3">
        <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-black/55">
          STATYSTYKI
        </p>
        <span className="font-mono text-[10px] font-bold tabular-nums text-black/45">
          WYGRANE: {totalWins}
        </span>
      </div>

      <div className="grid gap-1.5">
        {ATTEMPTS.map((attempt) => {
          const key = String(attempt) as keyof typeof distribution;
          const count = distribution[key] ?? 0;
          const pct = (count / max) * 100;
          const isUser = userAttempt === attempt;
          const barColor = isUser ? ACCENT : "rgba(0,0,0,0.55)";

          return (
            <div key={attempt} className="flex items-center gap-2">
              <span
                className={cn(
                  "w-4 text-right font-mono text-[10px] font-bold tabular-nums",
                  isUser ? "text-black" : "text-black/55",
                )}
              >
                {attempt}
              </span>
              <div className="relative h-4 flex-1 overflow-hidden rounded-sm border border-black/10 bg-white/40">
                <div
                  className="absolute inset-y-0 left-0"
                  style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%`, backgroundColor: barColor }}
                />
              </div>
              <span
                className={cn(
                  "w-10 text-right font-mono text-[10px] font-bold tabular-nums",
                  isUser ? "text-black" : "text-black/55",
                )}
                aria-label={`Attempt ${attempt}: ${count} wins`}
              >
                {count}
              </span>
            </div>
          );
        })}
      </div>

      {totalWins === 0 ? (
        <p className="mt-2 font-mono text-[10px] font-bold uppercase text-black/45">
          BRAK STATYSTYK DLA TEGO UTWORU.
        </p>
      ) : null}
    </div>
  );
}
