"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Loader2, Search } from "lucide-react";

import {
  Command,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { searchTracks, type SearchTrackResult, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

export type SearchComboboxProps = {
  disabled?: boolean;
  onSelect?: (trackId: string) => void;
  onTrackSelect?: (track: SearchTrackResult) => void;
  className?: string;
};

export function SearchCombobox({
  disabled,
  onSelect,
  onTrackSelect,
  className,
}: SearchComboboxProps) {
  const listId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<SearchTrackResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState<number | undefined>(undefined);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (debounced.trim().length < MIN_QUERY_LEN) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const rows = await searchTracks(debounced);
        if (!cancelled) setResults(rows);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof ApiError ? e.message : "Błąd wyszukiwania.";
          setError(msg);
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    setPanelWidth(anchorRef.current.offsetWidth);
  }, [open, query]);

  const canShowPanel =
    !disabled &&
    (loading || debounced.trim().length >= MIN_QUERY_LEN);

  useEffect(() => {
    if (!loading && debounced.trim().length < MIN_QUERY_LEN) {
      setOpen(false);
    }
  }, [debounced, loading]);

  const commit = useCallback(
    (track: SearchTrackResult) => {
      onSelect?.(track.tidal_id);
      onTrackSelect?.(track);
      setQuery("");
      setDebounced("");
      setResults([]);
      setOpen(false);
      inputRef.current?.blur();
    },
    [onSelect, onTrackSelect],
  );

  const popoverVisible = open && canShowPanel;

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <Popover
        open={popoverVisible}
        onOpenChange={(o) => {
          if (!disabled) setOpen(o);
        }}
        modal={false}
      >
        <PopoverAnchor asChild>
          <div ref={anchorRef} className="relative w-full">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40"
              aria-hidden
            />
            <input
              ref={inputRef}
              id={`${listId}-input`}
              type="search"
              autoComplete="off"
              disabled={disabled}
              placeholder="Znasz ten utwór?"
              value={query}
              role="combobox"
              aria-expanded={popoverVisible}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              className="h-9 w-full border border-black/15 bg-[#e5e1da] pl-10 pr-9 text-xs font-bold uppercase tracking-wide text-black placeholder:text-black/35 focus:border-[#0000FF] focus:outline-none focus:ring-1 focus:ring-[#0000FF] disabled:opacity-50"
            />
            {loading ? (
              <Loader2
                className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin"
                style={{ color: "#0000FF" }}
                aria-label="Trwa wyszukiwanie"
              />
            ) : null}
          </div>
        </PopoverAnchor>

        <PopoverContent
          id={listId}
          align="start"
          side="bottom"
          sideOffset={4}
          className="p-0"
          style={{ width: panelWidth ? `${panelWidth}px` : undefined }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          aria-label="Wyniki wyszukiwania utworów"
        >
          <Command shouldFilter={false}>
            <CommandList role="listbox">
              {loading ? (
                <div
                  className="py-4 text-center text-[10px] font-bold uppercase"
                  style={{ color: "#0000FF" }}
                  aria-live="polite"
                >
                  Wyszukiwanie…
                </div>
              ) : null}

              {!loading &&
              debounced.trim().length >= MIN_QUERY_LEN &&
              results.length === 0 ? (
                <div
                  className="py-6 text-center text-[10px] font-bold uppercase text-black/50"
                  role="status"
                  aria-label="No songs found"
                >
                  Nie znaleziono utworów
                </div>
              ) : null}

              {!loading &&
                results.map((r) => (
                  <CommandItem
                    key={r.tidal_id}
                    value={`${r.tidal_id}\t${r.title}\t${r.artist}`}
                    keywords={[r.title, r.artist, r.tidal_id]}
                    onSelect={() => commit(r)}
                    className="rounded-none"
                  >
                    <img
                      src={r.cover_url}
                      alt=""
                      width={32}
                      height={32}
                      className="h-8 w-8 shrink-0 border border-black/10 object-cover"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                      <span className="truncate text-[11px] font-bold uppercase leading-tight text-black">
                        {r.title}
                      </span>
                      <span className="truncate text-[10px] font-bold uppercase text-black/55">
                        {r.artist}
                      </span>
                    </div>
                  </CommandItem>
                ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {error ? (
        <p
          className="absolute left-0 top-full z-20 mt-1 max-w-full truncate text-[10px] font-bold uppercase text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
