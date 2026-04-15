"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CategoryPills } from "@/components/category-pills";
import { GameCategoryPanel } from "@/components/game-category-panel";

const CATEGORIES = [
  "RAP",
  "POPULARNE",
  "POP",
  "POLSKIE KLASYKI",
  "KLASYKI ŚWIATA",
] as const;

export default function Home() {
  const pathname = usePathname();
  const sp = useSearchParams();

  const urlCategory = (sp.get("category") ?? "").trim();
  const urlDate = (sp.get("date") ?? "").trim();

  const initialCategory = useMemo(() => {
    return (CATEGORIES as readonly string[]).includes(urlCategory) ? urlCategory : "POP";
  }, [urlCategory]);

  const [activeCategory, setActiveCategory] = useState<string>(initialCategory);

  useEffect(() => {
    setActiveCategory(initialCategory);
  }, [initialCategory]);

  return (
    <div className="relative flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-[#EBE7DF] text-black">
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

      <div className="flex min-h-0 flex-1 flex-col px-6 py-6 md:flex-row md:gap-0 md:px-10 md:py-6">
        <section className="flex min-h-0 w-full shrink-0 flex-col justify-center font-mono md:w-[40%] md:pr-10">
          <div className="space-y-0">
            <h2 className="hit-brutal-heading text-3xl md:text-4xl lg:text-5xl">
              <span className="text-black">SŁUCHAJ.</span>
              <span style={{ color: "#0000FF" }}>ZGADUJ.</span>
            </h2>
            <h2 className="hit-brutal-heading mt-1 text-3xl md:text-4xl lg:text-5xl">
              <span className="text-black/45">POWTÓRZ.</span>
            </h2>
            <h2
              className="hit-brutal-heading mt-1 text-3xl md:text-4xl lg:text-5xl"
              style={{ color: "#0000FF" }}
            >
              {"SZEŚĆ PRÓB."}
            </h2>
            <h2 className="hit-brutal-heading mt-1 text-3xl text-black md:text-4xl lg:text-5xl">
              WYGRYWAJ.
            </h2>
            <h2 className="hit-brutal-heading mt-1 text-3xl text-black md:text-4xl lg:text-5xl">
              CODZIENNIE.
            </h2>
          </div>
        </section>

        <section className="relative mt-8 flex min-h-0 min-w-0 flex-1 flex-col border-black/10 md:mt-0 md:border-l md:pl-12">
          <div className="mb-4 shrink-0">
            <CategoryPills
              categories={CATEGORIES}
              selected={activeCategory}
              onSelect={setActiveCategory}
            />
          </div>

          {/* key=category: jedna instancja useGame na kategorię. Stabilny key powodował
              zapis stanu poprzedniej kategorii pod kluczem nowej (localStorage). */}
          <GameCategoryPanel key={`${activeCategory}:${urlDate || "today"}`} category={activeCategory} date={urlDate || undefined} />
        </section>
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-black/10 px-6 py-3 md:px-10">
        <div className="flex gap-3 text-black">
          <a href="#" aria-label="Instagram" className="opacity-80 hover:opacity-100">
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
            </svg>
          </a>
          <a href="#" aria-label="YouTube" className="opacity-80 hover:opacity-100">
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
            </svg>
          </a>
          <a href="#" aria-label="TikTok" className="opacity-80 hover:opacity-100">
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
            </svg>
          </a>
          <a href="#" aria-label="X" className="opacity-80 hover:opacity-100">
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </div>
        <div className="flex gap-4 text-[9px] text-black/45">
          <a href="#" className="hover:underline hover:underline-offset-2">
            Polityka Prywatności
          </a>
          <a href="#" className="hover:underline hover:underline-offset-2">
            Regulamin
          </a>
          <a href="#" className="hover:underline hover:underline-offset-2">
            Kontakt
          </a>
        </div>
      </footer>
    </div>
  );
}
