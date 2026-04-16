"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Calendar as CalendarIcon, Check, ChevronLeft, ChevronRight, Lock, Music2, Trash2 } from "lucide-react";

import { CategoryPills } from "@/components/category-pills";
import { SearchCombobox } from "@/components/search-combobox";
import { useToast } from "@/hooks/use-toast";
import {
  assignDailySong,
  deleteDailySong,
  fetchAdminDaySong,
  fetchAdminCalendarMonth,
  type SearchTrackResult,
} from "@/lib/api";
import { safeAlbumCoverSrc } from "@/lib/cover-url";

const CATEGORIES = [
  "RAP",
  "POPULARNE",
  "POP",
  "POLSKIE KLASYKI",
  "KLASYKI ŚWIATA",
] as const;

type DayCell = {
  isoDate: string;
  day: number;
  isFuture: boolean;
  isToday: boolean;
  assigned: boolean;
};

type AdminDaySong = {
  exists: boolean;
  date: string;
  category: string;
  editable: boolean;
  tidal_track_id: string | null;
  title: string | null;
  artist: string | null;
  album_cover: string | null;
};

function isoForDay(year: number, monthIndex: number, day: number): string {
  const d = new Date(year, monthIndex, day);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function AdminSecretDashboardPage() {
  const { toast } = useToast();
  const [activeCategory, setActiveCategory] = useState<string>("POP");
  const [adminToken, setAdminToken] = useState("");
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<SearchTrackResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [currentDaySong, setCurrentDaySong] = useState<AdminDaySong | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const today = new Date();
  const todayIso = isoForDay(today.getFullYear(), today.getMonth(), today.getDate());
  const year = viewDate.getFullYear();
  const monthIndex = viewDate.getMonth();
  const monthName = viewDate.toLocaleDateString("pl-PL", { month: "long" });
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, monthIndex, 1).getDay();
  const startOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem("hitguess_admin_token");
      if (saved) setAdminToken(saved);
    } catch {
      /* ignore sessionStorage errors */
    }
    setSelectedDate(todayIso);
  }, [todayIso]);

  useEffect(() => {
    try {
      if (adminToken.trim()) {
        window.sessionStorage.setItem("hitguess_admin_token", adminToken.trim());
      } else {
        window.sessionStorage.removeItem("hitguess_admin_token");
      }
    } catch {
      /* ignore sessionStorage errors */
    }
  }, [adminToken]);

  useEffect(() => {
    let cancelled = false;
    if (!adminToken.trim()) {
      setAvailableDates([]);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      try {
        const dates = await fetchAdminCalendarMonth(
          activeCategory,
          year,
          monthIndex + 1,
          adminToken,
        );
        if (!cancelled) setAvailableDates(dates);
      } catch (e) {
        if (!cancelled) {
          setAvailableDates([]);
          const message = e instanceof Error ? e.message : "Nie udało się pobrać kalendarza.";
          toast({
            title: "Błąd kalendarza",
            description: message,
            variant: "destructive",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCategory, adminToken, monthIndex, toast, year]);

  useEffect(() => {
    let cancelled = false;
    if (!adminToken.trim() || !selectedDate) {
      setCurrentDaySong(null);
      return () => {
        cancelled = true;
      };
    }
    setDayLoading(true);
    void (async () => {
      try {
        const data = await fetchAdminDaySong(selectedDate, activeCategory, adminToken);
        if (!cancelled) setCurrentDaySong(data);
      } catch (e) {
        if (!cancelled) {
          setCurrentDaySong(null);
          const message = e instanceof Error ? e.message : "Nie udało się pobrać danych dnia.";
          toast({
            title: "Błąd dnia",
            description: message,
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setDayLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCategory, adminToken, selectedDate, toast]);

  const dayCells = useMemo((): DayCell[] => {
    const assignedSet = new Set(availableDates);
    const cells: DayCell[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const isoDate = isoForDay(year, monthIndex, day);
      cells.push({
        isoDate,
        day,
        isFuture: isoDate > todayIso,
        isToday: isoDate === todayIso,
        assigned: assignedSet.has(isoDate),
      });
    }
    return cells;
  }, [availableDates, daysInMonth, monthIndex, todayIso, year]);

  const canAssign =
    adminToken.trim().length > 0 &&
    selectedDate &&
    selectedDate >= todayIso &&
    selectedTrack &&
    !submitting;

  const missingSteps = [
    adminToken.trim().length === 0 ? "wklej token admina" : null,
    !selectedDate ? "wybierz dzień w kalendarzu" : null,
    selectedDate && selectedDate < todayIso ? "nie możesz edytować przeszłych dni" : null,
    !selectedTrack ? "wybierz utwór z wyszukiwarki" : null,
  ].filter(Boolean);

  const handleAssign = async () => {
    if (!selectedDate || !selectedTrack) return;
    setSubmitting(true);
    try {
      const res = await assignDailySong(
        {
          date: selectedDate,
          category: activeCategory,
          tidal_track_id: selectedTrack.tidal_id,
        },
        adminToken,
      );
      setAvailableDates((prev) =>
        prev.includes(selectedDate) ? prev : [...prev, selectedDate].sort(),
      );
      setCurrentDaySong({
        exists: true,
        date: res.date,
        category: res.category,
        editable: selectedDate > todayIso,
        tidal_track_id: res.tidal_track_id,
        title: res.title,
        artist: res.artist,
        album_cover: selectedTrack.cover_url,
      });
      toast({
        title: "Przypisano",
        description: `${res.artist} — ${res.title} zapisano dla ${res.date} (${res.category}).`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Nie udało się przypisać utworu.";
      toast({
        title: "Błąd przypisania",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedDate || !currentDaySong?.exists || !currentDaySong.editable) return;
    setDeleting(true);
    try {
      await deleteDailySong(selectedDate, activeCategory, adminToken);
      setAvailableDates((prev) => prev.filter((d) => d !== selectedDate));
      setCurrentDaySong({
        exists: false,
        date: selectedDate,
        category: activeCategory,
        editable: selectedDate > todayIso,
        tidal_track_id: null,
        title: null,
        artist: null,
        album_cover: null,
      });
      toast({
        title: "Usunięto",
        description: `Usunięto przypisaną piosenkę dla ${selectedDate} (${activeCategory}).`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Nie udało się usunąć przypisania.";
      toast({
        title: "Błąd usuwania",
        description: message,
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-[#0B0B0D] text-[#EBE7DF]">
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-4 md:px-10">
        <div>
          <Link href="/" className="text-lg font-black uppercase tracking-tight md:text-xl">
            HIT.GUESS.
          </Link>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
            admin secret dashboard
          </p>
        </div>
        <div className="w-[min(34vw,280px)] min-w-[220px]">
          <label className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
            <Lock className="h-3 w-3" aria-hidden />
            Admin Token
          </label>
          <input
            type="password"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const trimmed = adminToken.trim();
              if (!trimmed) {
                toast({
                  title: "Brak tokenu",
                  description: "Wklej token admina z backend/.env.local.",
                  variant: "destructive",
                });
                return;
              }
              toast({
                title: "Token zapisany",
                description: "Możesz teraz wybrać dzień i utwór do przypisania.",
              });
            }}
            placeholder="Wklej token z backend/.env.local"
            className="h-10 w-full border border-white/15 bg-black/40 px-3 text-xs font-bold uppercase tracking-wide text-white placeholder:text-white/25 focus:border-[#0000FF] focus:outline-none focus:ring-1 focus:ring-[#0000FF]"
          />
          <p className="mt-2 text-[10px] uppercase tracking-wide text-white/35">
            Enter zapisuje token tylko w bieżącej sesji przeglądarki.
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-h-0 flex-col border-b border-white/10 p-6 md:p-8 lg:w-1/2 lg:border-b-0 lg:border-r lg:p-10">
          <div className="mb-5 shrink-0">
            <CategoryPills
              categories={CATEGORIES}
              selected={activeCategory}
              onSelect={setActiveCategory}
            />
          </div>

          <div className="mb-5 flex shrink-0 items-center gap-3">
            <CalendarIcon className="h-4 w-4 text-white/45" aria-hidden />
            <h2 className="text-xl font-black uppercase tracking-tight">
              {monthName} {year}
            </h2>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
                  setSelectedDate(null);
                }}
                className="flex h-8 w-8 items-center justify-center border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]"
                aria-label="Poprzedni miesiąc"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
                  setSelectedDate(null);
                }}
                className="flex h-8 w-8 items-center justify-center border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]"
                aria-label="Następny miesiąc"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          <div className="mb-1 grid shrink-0 grid-cols-7 gap-1">
            {["PON", "WTO", "ŚRO", "CZW", "PIĄ", "SOB", "NIE"].map((d) => (
              <div key={d} className="py-1 text-center font-mono text-[10px] text-white/35">
                {d}
              </div>
            ))}
          </div>

          <div className="grid flex-1 grid-cols-7 gap-1">
            {Array.from({ length: startOffset }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-square" />
            ))}
            {dayCells.map((cell) => {
              const isSelected = selectedDate === cell.isoDate;
              return (
                <button
                  key={cell.isoDate}
                  type="button"
                  disabled={false}
                  onClick={() => setSelectedDate(cell.isoDate)}
                  className={[
                    "relative aspect-square border text-xs font-mono transition-all",
                    cell.isoDate < todayIso
                      ? "cursor-not-allowed border-white/5 bg-white/[0.03] text-white/18"
                      : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]",
                    cell.isToday ? "border-[#0000FF] text-[#0000FF]" : "",
                    isSelected ? "ring-2 ring-[#0000FF]" : "",
                  ].join(" ")}
                >
                  {cell.day}
                  {cell.assigned ? (
                    <span className="absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 bg-[#0000FF]" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex shrink-0 items-center gap-4 border-t border-white/10 pt-4">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 bg-[#0000FF]" />
              <span className="text-[10px] text-white/45">Przypisane w DB</span>
            </div>
            <div className="text-[10px] text-white/35">
              Wybrany dzień: <span className="font-bold text-white">{selectedDate ?? "—"}</span>
            </div>
            <div className="text-[10px] text-white/35">
              Przeszłość: <span className="font-bold text-white">zablokowana</span>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col p-6 md:p-8 lg:w-1/2 lg:p-10">
          <div className="mb-5 shrink-0">
            <h3 className="mb-3 font-mono text-xs font-bold uppercase tracking-[0.18em] text-white/45">
              Tidal Search
            </h3>
            <SearchCombobox
              onTrackSelect={setSelectedTrack}
              className="max-w-none"
            />
          </div>

          <div className="mb-5 shrink-0 border border-white/10 bg-white/[0.04] p-4">
            <p className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">
              Podgląd przypisania
            </p>
            <div className="grid gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-white/35">Kategoria</div>
                <div className="mt-1 text-sm font-black">{activeCategory}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-white/35">Data</div>
                <div className="mt-1 text-sm font-black">{selectedDate ?? "Wybierz dzień"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-white/35">Utwór</div>
                {selectedTrack ? (
                  <div className="mt-1">
                    <div className="text-sm font-black">{selectedTrack.title}</div>
                    <div className="text-xs uppercase text-white/55">{selectedTrack.artist}</div>
                    <div className="mt-1 break-all font-mono text-[10px] text-white/35">
                      {selectedTrack.tidal_id}
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 text-sm text-white/40">Wyszukaj i wybierz utwór</div>
                )}
              </div>
            </div>
          </div>

          <div className="mb-5 shrink-0 border border-white/10 bg-white/[0.04] p-4">
            <p className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">
              Piosenka przypisana do dnia
            </p>
            {dayLoading ? (
              <div className="text-sm text-white/45">Ładowanie...</div>
            ) : currentDaySong?.exists ? (
              <div className="flex gap-4">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden border border-white/10 bg-black/20">
                  {currentDaySong.album_cover ? (
                    <Image
                      src={safeAlbumCoverSrc(currentDaySong.album_cover)}
                      alt={`${currentDaySong.title ?? "Assigned song"} cover`}
                      unoptimized
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black">{currentDaySong.title}</div>
                  <div className="mt-1 text-xs uppercase text-white/55">{currentDaySong.artist}</div>
                  <div className="mt-2 break-all font-mono text-[10px] text-white/35">
                    {currentDaySong.tidal_track_id}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-white/45">
                      {currentDaySong.editable ? "Można usunąć" : "Tylko podgląd"}
                    </span>
                    {currentDaySong.editable ? (
                      <button
                        type="button"
                        onClick={() => void handleDelete()}
                        disabled={deleting}
                        className="inline-flex h-8 items-center justify-center gap-1 border border-red-500/40 bg-red-500/10 px-3 text-[10px] font-black uppercase tracking-[0.18em] text-red-200 disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        {deleting ? "Usuwanie..." : "Usuń"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-white/45">
                Brak przypisanej piosenki dla tego dnia i kategorii.
              </div>
            )}
          </div>

          <div className="mb-5 shrink-0 border border-white/10 bg-black/25 p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">
              Status
            </div>
            <div className="mt-2 text-sm font-black">
              {canAssign ? "Gotowe do zapisania" : "Brakuje danych do przypisania"}
            </div>
            <div className="mt-2 text-[10px] uppercase tracking-wide text-white/40">
              {missingSteps.length > 0 ? missingSteps.join(" • ") : "możesz kliknąć przycisk poniżej"}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col justify-end">
            <button
              type="button"
              disabled={!canAssign}
              onClick={() => void handleAssign()}
              className="inline-flex h-12 items-center justify-center gap-2 border border-[#0000FF] bg-[#0000FF] px-5 text-xs font-black uppercase tracking-[0.18em] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? (
                <>
                  <Music2 className="h-4 w-4 animate-pulse" aria-hidden />
                  Zapisywanie...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" aria-hidden />
                  Przypisz do dnia
                </>
              )}
            </button>
            <p className="mt-3 text-[10px] uppercase tracking-wide text-white/35">
              Strona jest ukryta i dostępna tylko przez bezpośredni URL.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
