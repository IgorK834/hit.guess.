"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, Check, ChevronLeft, ChevronRight, Play, X } from "lucide-react";

import { CategoryPills } from "@/components/category-pills";
import { dailyStateStorageKey, type GuessSlot } from "@/hooks/use-game";
import { fetchCalendarMonth } from "@/lib/api";
import { getLocalDateKey } from "@/lib/clientTimezone";

type DayStatus = "won" | "lost" | "unplayed" | "today" | "future" | "unavailable";

type DayData = {
  isoDate: string; // YYYY-MM-DD
  date: number; // day of month
  status: DayStatus;
  attemptsUsed?: number;
  track?: {
    title: string;
    artist: string;
  };
};

const CATEGORIES = [
  "RAP",
  "POPULARNE",
  "POP",
  "POLSKIE KLASYKI",
  "KLASYKI ŚWIATA",
] as const;

function parseIsoDate(d: string): Date | null {
  const s = d.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, day] = s.split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, day);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== day) return null;
  return dt;
}

function isoForDay(year: number, monthIndex: number, day: number): string {
  const d = new Date(year, monthIndex, day);
  return getLocalDateKey(d);
}

type PersistedShape = {
  v: number;
  date: string;
  uiCategory: string;
  attemptsUsed?: number;
  gameStatus?: "PLAYING" | "WON" | "LOST" | null;
  slots?: GuessSlot[];
  reveal?: { title: string; artist: string } | null;
};

function readDayFromStorage(iso: string, category: string): PersistedShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(dailyStateStorageKey(iso, category));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as PersistedShape;
  } catch {
    return null;
  }
}

function computeStreak(monthData: DayData[], todayIso: string): number {
  // Current streak of consecutive WON ending today-1 or today if already won today.
  const byIso = new Map(monthData.map((d) => [d.isoDate, d]));
  const today = parseIsoDate(todayIso);
  if (!today) return 0;

  const cursor = new Date(today);
  let streak = 0;
  while (true) {
    const iso = getLocalDateKey(cursor);
    const d = byIso.get(iso);
    if (!d) break;
    if (d.status === "won") {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    break;
  }
  return streak;
}

export default function CalendarPage() {
  const pathname = usePathname();
  const [activeCategory, setActiveCategory] = useState<string>("POP");
  const [selectedDayIso, setSelectedDayIso] = useState<string | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);

  const today = new Date();
  const monthName = today.toLocaleDateString("pl-PL", { month: "long" });
  const year = today.getFullYear();
  const monthIndex = today.getMonth();
  const todayIso = getLocalDateKey(today);
  const currentDay = today.getDate();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  // Calculate first day offset (0 = Sunday, adjust for Monday start)
  const firstDayOfMonth = new Date(year, monthIndex, 1).getDay();
  const startOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const dates = await fetchCalendarMonth(activeCategory, year, monthIndex + 1);
        if (!cancelled) {
          setAvailableDates(dates);
        }
      } catch {
        if (!cancelled) {
          setAvailableDates([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeCategory, year, monthIndex]);

  const monthData = useMemo((): DayData[] => {
    const availableSet = new Set(availableDates);
    // Compute from localStorage on the client. This component is `use client`, so
    // it is safe to access `window` after hydration without syncing state via effects.
    const data: DayData[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = isoForDay(year, monthIndex, day);
      let status: DayStatus;
      let track: { title: string; artist: string } | undefined;
      let attemptsUsed: number | undefined;

      if (day > currentDay) {
        status = "future";
      } else if (iso === todayIso) {
        status = "today";
      } else {
        const persisted = readDayFromStorage(iso, activeCategory);
        const gs = persisted?.gameStatus ?? null;
        if (gs === "WON") {
          status = "won";
          if (persisted?.reveal?.title && persisted?.reveal?.artist) {
            track = { title: persisted.reveal.title, artist: persisted.reveal.artist };
          }
          if (typeof persisted?.attemptsUsed === "number") attemptsUsed = persisted.attemptsUsed;
        } else if (gs === "LOST") {
          status = "lost";
          if (persisted?.reveal?.title && persisted?.reveal?.artist) {
            track = { title: persisted.reveal.title, artist: persisted.reveal.artist };
          }
          if (typeof persisted?.attemptsUsed === "number") attemptsUsed = persisted.attemptsUsed;
        } else {
          status = availableSet.has(iso) ? "unplayed" : "unavailable";
        }
      }

      data.push({ isoDate: iso, date: day, status, track, attemptsUsed });
    }
    return data;
  }, [activeCategory, availableDates, currentDay, daysInMonth, monthIndex, todayIso, year]);

  const selectedDay =
    selectedDayIso != null
      ? monthData.find((d) => d.isoDate === selectedDayIso) ?? null
      : null;

  const stats = useMemo(() => {
    const won = monthData.filter((d) => d.status === "won").length;
    const lost = monthData.filter((d) => d.status === "lost").length;
    const played = won + lost;
    const total = monthData.filter((d) => d.status !== "future" && d.status !== "unavailable").length;
    const winRate = played > 0 ? Math.round((won / played) * 100) : 0;
    return { won, lost, played, total, winRate };
  }, [monthData]);

  const distribution = useMemo(() => {
    // Attempts distribution for wins only (1..5). If attemptsUsed >= 6, bucket into 5.
    const counts = new Map<number, number>([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
    ]);
    for (const d of monthData) {
      if (d.status !== "won") continue;
      const n = typeof d.attemptsUsed === "number" ? d.attemptsUsed : 0;
      const bucket = Math.min(Math.max(n, 1), 5);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    return counts;
  }, [monthData]);

  const streak = useMemo(() => computeStreak(monthData, todayIso), [monthData, todayIso]);

  const getDayClasses = (day: DayData) => {
    const base =
      "w-full aspect-square flex items-center justify-center text-xs font-mono relative transition-all";
    const isSelected = selectedDayIso === day.isoDate;

    switch (day.status) {
      case "won":
      case "lost":
      case "unplayed":
        return `${base} bg-white/40 hover:bg-black/5 cursor-pointer ${
          isSelected ? "ring-2 ring-[#0000FF]" : ""
        }`;
      case "today":
        return `${base} bg-[#0000FF] text-white cursor-pointer ${
          isSelected ? "ring-2 ring-black ring-offset-2 ring-offset-[#EBE7DF]" : ""
        }`;
      case "unavailable":
      case "future":
        return `${base} bg-black/5 text-black/25 cursor-not-allowed`;
      default:
        return base;
    }
  };

  const getStatusIndicator = (day: DayData) => {
    switch (day.status) {
      case "won":
        return <div className="absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 bg-[#0000FF]" />;
      case "lost":
        return <div className="absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 bg-black/35" />;
      case "unplayed":
        return (
          <Play className="absolute bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 text-black/35" />
        );
      default:
        return null;
    }
  };

  return (
    <main className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-[#EBE7DF] text-black">
      <header className="flex shrink-0 items-center justify-between border-b border-black/10 px-6 py-4 md:px-10">
        <Link href="/" className="text-lg font-black uppercase tracking-tight md:text-xl">
          HIT.GUESS.
        </Link>
        <div className="flex items-center gap-6 md:gap-8">
          <nav className="hidden items-center gap-4 text-xs font-normal sm:flex">
            <Link
              href="/"
              className={pathname === "/" ? "text-black underline underline-offset-2" : "text-black hover:underline hover:underline-offset-2"}
            >
              Graj Teraz
            </Link>
            <Link
              href="/calendar"
              className={pathname === "/calendar" ? "text-black underline underline-offset-2" : "text-black hover:underline hover:underline-offset-2"}
            >
              Kalendarz
            </Link>
            <a href="#" className="text-black hover:underline hover:underline-offset-2">
              O grze
            </a>
          </nav>
          <span className="hidden text-[10px] font-normal tracking-wide text-black/45 sm:inline">
            [POWERED BY TIDAL API]
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex flex-col border-b border-black/10 p-6 md:p-8 lg:w-1/2 lg:border-b-0 lg:border-r lg:p-10">
          <div className="mb-4 shrink-0">
            <CategoryPills
              categories={CATEGORIES}
              selected={activeCategory}
              onSelect={setActiveCategory}
            />
          </div>

          <div className="mb-6 flex shrink-0 items-center justify-between">
            <div className="flex items-center gap-3">
              <CalendarIcon className="h-4 w-4 text-black/45" aria-hidden />
              <h2 className="text-xl font-black uppercase tracking-tight md:text-2xl">
                {monthName} {year}
              </h2>
            </div>
            <div className="flex gap-1">
              <button type="button" className="p-1.5 opacity-40" disabled aria-label="Poprzedni miesiąc">
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" className="p-1.5 opacity-40" disabled aria-label="Następny miesiąc">
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          <div className="mb-1 grid shrink-0 grid-cols-7 gap-1">
            {["PON", "WTO", "ŚRO", "CZW", "PIĄ", "SOB", "NIE"].map((d) => (
              <div key={d} className="py-1 text-center font-mono text-[10px] text-black/45">
                {d}
              </div>
            ))}
          </div>

          <div className="grid flex-1 grid-cols-7 gap-1">
            {Array.from({ length: startOffset }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-square" />
            ))}
            {monthData.map((day) => (
              <button
                key={day.isoDate}
                type="button"
                onClick={() => day.status !== "future" && day.status !== "unavailable" && setSelectedDayIso(day.isoDate)}
                disabled={day.status === "future" || day.status === "unavailable"}
                className={getDayClasses(day)}
              >
                {day.date}
                {getStatusIndicator(day)}
              </button>
            ))}
          </div>

          <div className="mt-4 flex shrink-0 items-center gap-4 border-t border-black/10 pt-4">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 bg-[#0000FF]" />
              <span className="text-[10px] text-black/45">Wygrana</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 bg-black/35" />
              <span className="text-[10px] text-black/45">Przegrana</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Play className="h-2.5 w-2.5 text-black/35" aria-hidden />
              <span className="text-[10px] text-black/45">Niegrany</span>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col p-6 md:p-8 lg:w-1/2 lg:p-10">
          <div className="mb-6 shrink-0">
            <h3 className="mb-3 font-mono text-xs font-bold uppercase tracking-wider text-black/45">
              Statystyki miesiąca
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white/40 p-3">
                <div className="text-2xl font-black text-[#0000FF] md:text-3xl">
                  {stats.winRate}%
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-black/45">
                  Skuteczność
                </div>
              </div>
              <div className="bg-white/40 p-3">
                <div className="text-2xl font-black md:text-3xl">{stats.won}</div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-black/45">
                  Wygrane
                </div>
              </div>
              <div className="bg-white/40 p-3">
                <div className="text-2xl font-black md:text-3xl">
                  {stats.played}/{stats.total}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-black/45">
                  Zagrane
                </div>
              </div>
            </div>
          </div>

          <div className="mb-6 shrink-0">
            <h3 className="mb-3 font-mono text-xs font-bold uppercase tracking-wider text-black/45">
              Rozkład prób
            </h3>
            <div className="space-y-1">
              {[1, 2, 3, 4, 5].map((attempt) => {
                const count = distribution.get(attempt) ?? 0;
                const percentage = stats.won > 0 ? (count / stats.won) * 100 : 0;
                return (
                  <div key={attempt} className="flex items-center gap-2">
                    <span className="w-3 font-mono text-[10px] font-bold">{attempt}</span>
                    <div className="h-4 flex-1 bg-white/40">
                      <div
                        className="h-full bg-[#0000FF]"
                        style={{ width: `${Math.max(percentage, 2)}%` }}
                      />
                    </div>
                    <span className="w-4 text-right font-mono text-[10px] font-bold">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <h3 className="mb-3 shrink-0 font-mono text-xs font-bold uppercase tracking-wider text-black/45">
              {selectedDay ? `Dzień ${selectedDay.date}` : "Wybierz dzień"}
            </h3>

            {selectedDay ? (
              <div className="flex flex-1 flex-col bg-white/40 p-4">
                {selectedDay.status === "today" ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-4">
                    <div className="text-center">
                      <div className="mb-1 text-lg font-black">Dzisiejszy hit</div>
                      <div className="text-xs text-black/55">Zagraj teraz i zgadnij utwór!</div>
                    </div>
                    <Link
                      href={`/?category=${encodeURIComponent(activeCategory)}`}
                      className="px-6 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:opacity-90"
                      style={{ backgroundColor: "#0000FF" }}
                    >
                      Graj Teraz
                    </Link>
                  </div>
                ) : selectedDay.status === "unplayed" ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-4">
                    <div className="text-center">
                      <div className="mb-1 text-lg font-black">
                        Archiwum: {selectedDay.isoDate}
                      </div>
                      <div className="text-xs text-black/55">Ten dzień czeka na Twoją próbę!</div>
                    </div>
                    <Link
                      href={`/?date=${encodeURIComponent(selectedDay.isoDate)}&category=${encodeURIComponent(activeCategory)}`}
                      className="px-6 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:opacity-90"
                      style={{ backgroundColor: "#0000FF" }}
                    >
                      Zagraj archiwum
                    </Link>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col">
                    <div className="mb-4 flex items-center gap-2">
                      {selectedDay.status === "won" ? (
                        <>
                          <div className="flex h-5 w-5 items-center justify-center bg-[#0000FF]">
                            <Check className="h-3 w-3 text-white" aria-hidden />
                          </div>
                          <span className="text-xs font-black uppercase" style={{ color: "#0000FF" }}>
                            Wygrana
                          </span>
                        </>
                      ) : (
                        <>
                          <div className="flex h-5 w-5 items-center justify-center bg-black/15">
                            <X className="h-3 w-3 text-black" aria-hidden />
                          </div>
                          <span className="text-xs font-black uppercase text-black/55">
                            Przegrana
                          </span>
                        </>
                      )}
                    </div>

                    {selectedDay.track ? (
                      <div className="flex gap-4">
                        <div className="flex h-16 w-16 items-center justify-center bg-black/5">
                          <div className="font-mono text-[8px] text-black/35">COVER</div>
                        </div>
                        <div className="flex flex-col justify-center">
                          <div className="text-sm font-black">{selectedDay.track.title}</div>
                          <div className="text-xs text-black/55">{selectedDay.track.artist}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-black/55">
                        Brak danych utworu (zagraj ten dzień, aby odblokować szczegóły).
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center bg-white/40 p-4 text-center">
                <div>
                  <div className="text-sm text-black/55">Kliknij dzień w kalendarzu</div>
                  <div className="text-xs text-black/35">aby zobaczyć szczegóły</div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 shrink-0 border-t border-black/10 pt-4">
            <div className="flex items-center justify-between">
              <div className="text-[9px] text-black/45">
                Streak: <span className="font-black text-black">{streak} dni</span>
              </div>
              <div className="flex gap-4 text-[9px] text-black/45">
                <a href="#" className="hover:underline hover:underline-offset-2">
                  Polityka Prywatności
                </a>
                <a href="#" className="hover:underline hover:underline-offset-2">
                  Regulamin
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

