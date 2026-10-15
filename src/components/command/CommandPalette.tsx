"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { addFocusSymbol, deskEma200Href, getFocusSymbols } from "@/lib/focusUniverse";

type PaletteItem = {
  id: string;
  label: string;
  hint: string;
  href?: string;
  run?: () => void;
  group: string;
};

const STATIC_ITEMS: PaletteItem[] = [
  { id: "home", label: "Home Cockpit", hint: "HOME", href: "/", group: "Navigate" },
  { id: "watchlist-edit", label: "Edit my watchlist", hint: "DESK", href: "/?desk=edit", group: "Navigate" },
  { id: "screener", label: "Watchlist", hint: "SCR", href: "/screener", group: "Navigate" },
  { id: "ema200", label: "EMA200", hint: "EMA", href: "/ema200", group: "Navigate" },
  { id: "fundamentals", label: "Fundamentals", hint: "FA", href: "/fundamentals", group: "Navigate" },
  { id: "fund-screener", label: "Fundamental Screener", hint: "FSCR", href: "/fundamentals/screener", group: "Navigate" },
  { id: "health", label: "Health Sector", hint: "HC", href: "/health", group: "Navigate" },
  { id: "earnings", label: "Earnings & News", hint: "ERN", href: "/earnings-news", group: "Navigate" },
];

type SearchHit = { symbol: string; name: string };

function recentTickers(): string[] {
  try {
    const raw =
      localStorage.getItem("orbis-equity-recent-tickers") ||
      localStorage.getItem("kovaview-recent-tickers");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function recordRecentTicker(ticker: string) {
  try {
    const t = ticker.toUpperCase();
    const prev = recentTickers().filter((x) => x !== t);
    localStorage.setItem(
      "orbis-equity-recent-tickers",
      JSON.stringify([t, ...prev].slice(0, 8))
    );
    localStorage.removeItem("kovaview-recent-tickers");
  } catch {
    /* ignore */
  }
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("orbis:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("orbis:open-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      setRecents(recentTickers());
      setSearchHits([]);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    const looksSearchable = trimmed.length >= 1 && /[a-zA-Z]/.test(trimmed);
    if (!looksSearchable) {
      setSearchHits([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/symbols/search?q=${encodeURIComponent(trimmed)}&limit=8`)
        .then((r) => r.json())
        .then((body) => setSearchHits(body.hits ?? []))
        .catch(() => setSearchHits([]));
    }, 280);
    return () => clearTimeout(t);
  }, [query]);

  const items = useMemo(() => {
    const q = query.trim().toUpperCase();
    const tickerItems: PaletteItem[] = recents.map((t) => ({
      id: `t-${t}`,
      label: t,
      hint: "TICKER",
      href: `/ticker/${t}`,
      group: "Recent",
    }));

    if (!q) return [...STATIC_ITEMS, ...tickerItems];

    const moduleHits = STATIC_ITEMS.filter(
      (i) =>
        i.label.toUpperCase().includes(q) ||
        i.hint.includes(q) ||
        (i.href ?? "").toUpperCase().includes(q)
    );
    const recentHits = tickerItems.filter((i) => i.label.includes(q));
    const looksLikeTicker = /^[A-Z0-9.\-]{1,12}$/.test(q);

    const symbolActions: PaletteItem[] = [];
    const symbolsToOffer = new Set<string>();
    if (looksLikeTicker) symbolsToOffer.add(q);
    for (const h of searchHits) symbolsToOffer.add(h.symbol);

    for (const sym of Array.from(symbolsToOffer)) {
      const onList = getFocusSymbols().includes(sym);
      symbolActions.push({
        id: `chart-${sym}`,
        label: `Open chart · ${sym}`,
        hint: "CHART",
        href: `/ticker/${sym}`,
        group: "Symbol",
      });
      if (!onList) {
        symbolActions.push({
          id: `add-${sym}`,
          label: `Add ${sym} to my list`,
          hint: "DESK",
          run: () => addFocusSymbol(sym),
          group: "Symbol",
        });
      }
      const deskHref = deskEma200Href(
        onList ? getFocusSymbols() : [...getFocusSymbols(), sym].slice(0, 50)
      );
      symbolActions.push({
        id: `ema-${sym}`,
        label: `EMA200 desk scan · ${sym}`,
        hint: "EMA",
        href: deskHref,
        group: "Symbol",
      });
    }

    const direct: PaletteItem[] =
      looksLikeTicker && symbolActions.length === 0
        ? [
            {
              id: `go-${q}`,
              label: `Open ${q}`,
              hint: "GO",
              href: `/ticker/${q}`,
              group: "Ticker",
            },
          ]
        : [];

    const merged = [...moduleHits, ...symbolActions, ...direct, ...recentHits];
    const seen = new Set<string>();
    return merged.filter((i) => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });
  }, [query, recents, searchHits]);

  const go = useCallback(
    (item: PaletteItem) => {
      if (item.run) {
        item.run();
        setOpen(false);
        return;
      }
      if (item.href) {
        if (item.group === "Ticker" || item.group === "Recent" || item.group === "Symbol") {
          const t = item.href.split("/").pop()?.split("?")[0];
          if (t) recordRecentTicker(t);
        }
        setOpen(false);
        router.push(item.href);
      }
    },
    [router]
  );

  useEffect(() => {
    setCursor(0);
  }, [query, searchHits]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close palette"
        onClick={() => setOpen(false)}
      />
      <div
        className="relative w-full max-w-lg rounded-lg border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-2xl overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === "Enter" && items[cursor]) {
            e.preventDefault();
            go(items[cursor]);
          }
        }}
      >
        <div className="flex items-center gap-2 px-3 py-3 border-b border-[var(--panel-border)]">
          <span className="text-[10px] font-terminal text-[var(--text-muted)]">⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to module or ticker…"
            className="flex-1 bg-transparent text-sm font-terminal outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-[var(--text-muted)] font-terminal">
              No matches
            </li>
          )}
          {items.map((item, idx) => (
            <li key={item.id}>
              <button
                type="button"
                onMouseEnter={() => setCursor(idx)}
                onClick={() => go(item)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm font-terminal ${
                  idx === cursor
                    ? "bg-[var(--surface-alt)] text-[var(--accent-info)]"
                    : "text-[var(--text-primary)]"
                }`}
              >
                <span>
                  <span className="text-[9px] text-[var(--text-muted)] mr-2">{item.group}</span>
                  {item.label}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] tracking-wider">
                  {item.hint}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
