"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { ModulePanel } from "@/components/ui/ModulePanel";
import { useFocusUniverse } from "@/hooks/useFocusUniverse";
import { FOCUS_SYMBOL_LIMIT } from "@/lib/focusUniverse";

type SearchHit = {
  symbol: string;
  name: string;
  exchange: string;
};

export default function ExplorePage() {
  const { mode, symbols, setMode, addSymbol, removeSymbol, setSymbols } = useFocusUniverse();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 1) {
      setHits([]);
      return;
    }
    setSearching(true);
    setSearchError(false);
    try {
      const res = await fetch(`/api/symbols/search?q=${encodeURIComponent(trimmed)}&limit=30`);
      const body = await res.json();
      setHits(body.hits ?? []);
    } catch {
      setSearchError(true);
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 280);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const moduleLinks = symbols.length
    ? [
        { href: "/screener", label: "Watchlist" },
        { href: "/ema200?desk=1", label: "EMA200 ribbon scan" },
        { href: "/bias", label: "Daily bias" },
        { href: "/analysis", label: "Analyze" },
      ]
    : [];

  return (
    <div className="px-4 py-6 space-y-4">
      <ModuleHeader
        module="EXPLORE"
        title="NASDAQ DESK LIST"
        description="When the index watchlists have nothing you like, search the broader Nasdaq venue, build your own symbol list, then flip modules to “My Nasdaq list” to scan only those names (live Yahoo + on-demand EMA200)."
        source="Yahoo search · client-side list"
        accent="var(--accent-warn)"
      />

      <div className="flex flex-wrap gap-2 text-[10px] font-terminal">
        <button
          type="button"
          onClick={() => setMode("index")}
          className={`px-3 py-1 rounded border ${
            mode === "index"
              ? "border-[var(--accent-warn)] text-[var(--accent-warn)]"
              : "border-[var(--panel-border)] text-[var(--text-muted)]"
          }`}
        >
          Use index universe (S&P + NDX-100)
        </button>
        <button
          type="button"
          onClick={() => setMode("focus")}
          className={`px-3 py-1 rounded border ${
            mode === "focus"
              ? "border-[var(--accent-warn)] text-[var(--accent-warn)]"
              : "border-[var(--panel-border)] text-[var(--text-muted)]"
          }`}
        >
          Use my Nasdaq list ({symbols.length})
        </button>
      </div>

      <ModulePanel title="Search Nasdaq" badge="live" accent="var(--accent-warn)">
        <div className="p-3 space-y-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ticker or company name (e.g. NBIS, Nebius)"
            className="w-full max-w-xl px-3 py-2 text-sm font-terminal bg-[var(--surface-alt)] border border-[var(--panel-border)] rounded text-[var(--text-primary)]"
            autoFocus
          />
          {searchError && (
            <p className="text-xs text-[var(--accent-danger)]">Search failed — try again in a moment.</p>
          )}
          {searching && <p className="text-xs text-[var(--text-muted)]">Searching…</p>}
          {!searching && hits.length > 0 && (
            <ul className="divide-y divide-[var(--panel-border)] border border-[var(--panel-border)] rounded">
              {hits.map((h) => {
                const inList = symbols.includes(h.symbol);
                return (
                  <li
                    key={h.symbol}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm font-terminal"
                  >
                    <div>
                      <Link href={`/ticker/${h.symbol}`} className="text-[var(--accent-info)] font-semibold">
                        {h.symbol}
                      </Link>
                      <span className="text-[var(--text-muted)] ml-2">{h.name}</span>
                      <span className="text-[10px] text-[var(--text-muted)] ml-2">{h.exchange}</span>
                    </div>
                    <button
                      type="button"
                      disabled={inList || symbols.length >= FOCUS_SYMBOL_LIMIT}
                      onClick={() => addSymbol(h.symbol)}
                      className="text-[10px] uppercase px-2 py-1 border border-[var(--panel-border)] rounded disabled:opacity-40"
                    >
                      {inList ? "On list" : "Add to desk"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </ModulePanel>

      <ModulePanel
        title="My desk symbols"
        badge={`${symbols.length}/${FOCUS_SYMBOL_LIMIT}`}
        accent="var(--accent-info)"
      >
        <div className="p-3 space-y-3">
          {symbols.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] font-terminal">
              No symbols yet. Search above and tap <strong>Add to desk</strong>, then switch modules to{" "}
              <em>My Nasdaq list</em>.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {symbols.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--panel-border)] text-xs font-terminal"
                  >
                    <Link href={`/ticker/${s}`} className="text-[var(--accent-info)]">{s}</Link>
                    <button
                      type="button"
                      aria-label={`Remove ${s}`}
                      onClick={() => removeSymbol(s)}
                      className="text-[var(--text-muted)] hover:text-[var(--accent-danger)]"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSymbols([])}
                className="text-[10px] text-[var(--text-muted)] underline"
              >
                Clear list
              </button>
              {mode === "focus" && moduleLinks.length > 0 && (
                <div className="pt-2 border-t border-[var(--panel-border)]">
                  <p className="text-[10px] text-[var(--text-muted)] mb-2">Open modules (my list active):</p>
                  <div className="flex flex-wrap gap-2">
                    {moduleLinks.map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        className="text-xs px-2 py-1 rounded border border-[var(--accent-info)] text-[var(--accent-info)]"
                      >
                        {l.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </ModulePanel>
    </div>
  );
}
