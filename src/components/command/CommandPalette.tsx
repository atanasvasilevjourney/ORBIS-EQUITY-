"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type PaletteItem = {
  id: string;
  label: string;
  hint: string;
  href: string;
  group: string;
};

const STATIC_ITEMS: PaletteItem[] = [
  { id: "home", label: "Home Cockpit", hint: "HOME", href: "/", group: "Navigate" },
  { id: "screener", label: "Swing Screener", hint: "SCR", href: "/screener", group: "Navigate" },
  { id: "fundamentals", label: "Fundamentals", hint: "FA", href: "/fundamentals", group: "Navigate" },
  { id: "pharma", label: "Pharma Pipeline", hint: "PHAR", href: "/pharma", group: "Navigate" },
  { id: "earnings", label: "Earnings & News", hint: "ERN", href: "/earnings-news", group: "Navigate" },
];

function recentTickers(): string[] {
  try {
    const raw = localStorage.getItem("kovaview-recent-tickers");
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
    localStorage.setItem("kovaview-recent-tickers", JSON.stringify([t, ...prev].slice(0, 8)));
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
    window.addEventListener("kovaview:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("kovaview:open-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      setRecents(recentTickers());
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

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

    // Prefer module matches (e.g. "SCR" → Swing Screener) over raw ticker jumps
    const moduleHits = STATIC_ITEMS.filter(
      (i) =>
        i.label.toUpperCase().includes(q) ||
        i.hint.includes(q) ||
        i.href.toUpperCase().includes(q)
    );
    const recentHits = tickerItems.filter((i) => i.label.includes(q));
    const looksLikeTicker = /^[A-Z0-9.\-]{1,12}$/.test(q);
    const exactModuleHint = STATIC_ITEMS.some((i) => i.hint === q);
    const direct: PaletteItem[] =
      looksLikeTicker && !exactModuleHint
        ? [
            {
              id: `go-${q}`,
              label: `Open ${q}`,
              hint: "GO",
              href: `/ticker/${q}`,
              group: "Ticker",
            },
          ]
        : looksLikeTicker && exactModuleHint
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

    // Module hits first, then ticker open (if any), then recent
    const merged = [...moduleHits, ...direct, ...recentHits];
    const seen = new Set<string>();
    return merged.filter((i) => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });
  }, [query, recents]);

  const go = useCallback(
    (item: PaletteItem) => {
      if (item.group === "Ticker" || item.group === "Recent") {
        const t = item.href.split("/").pop();
        if (t) recordRecentTicker(t);
      }
      setOpen(false);
      router.push(item.href);
    },
    [router]
  );

  useEffect(() => {
    setCursor(0);
  }, [query]);

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
