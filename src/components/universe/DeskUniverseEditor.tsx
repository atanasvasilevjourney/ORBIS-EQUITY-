"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useFocusUniverse } from "@/hooks/useFocusUniverse";
import {
  FOCUS_SYMBOL_LIMIT,
  NASDAQ_VENUE_DISCLAIMER,
} from "@/lib/focusUniverse";
import { DeskSymbolChip } from "@/components/universe/DeskSymbolChip";

type SearchHit = {
  symbol: string;
  name: string;
  exchange: string;
};

type Props = {
  compact?: boolean;
};

export function DeskUniverseEditor({ compact }: Props) {
  const { symbols, addSymbol, removeSymbol, setSymbols } = useFocusUniverse();
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

  return (
    <div className={`space-y-4 ${compact ? "" : "p-1"}`}>
      <p className="text-[10px] font-terminal text-[var(--text-muted)] leading-relaxed">
        List is saved in this browser only (no account sync yet). Up to {FOCUS_SYMBOL_LIMIT} symbols.
        Desk scan uses live Yahoo / on-demand EMA200 — not the nightly batch for every Nasdaq name.
      </p>
      <p className="text-[10px] font-terminal text-[var(--text-muted)]">{NASDAQ_VENUE_DISCLAIMER}</p>

      <div>
        <label className="text-[10px] font-terminal text-[var(--text-muted)] uppercase tracking-wide">
          Search Nasdaq
        </label>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ticker or company name"
          className="mt-1 w-full px-3 py-2 text-sm font-terminal bg-[var(--surface-alt)] border border-[var(--panel-border)] rounded text-[var(--text-primary)]"
          autoFocus
        />
        {searchError && (
          <p className="mt-1 text-xs text-[var(--accent-danger)]">Search failed — try again.</p>
        )}
        {searching && <p className="mt-1 text-xs text-[var(--text-muted)]">Searching…</p>}
        {!searching && hits.length > 0 && (
          <ul className="mt-2 divide-y divide-[var(--panel-border)] border border-[var(--panel-border)] rounded max-h-48 overflow-y-auto">
            {hits.map((h) => {
              const inList = symbols.includes(h.symbol);
              return (
                <li
                  key={h.symbol}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm font-terminal"
                >
                  <div className="min-w-0">
                    <Link href={`/ticker/${h.symbol}`} className="text-[var(--accent-info)] font-semibold">
                      {h.symbol}
                    </Link>
                    <span className="text-[var(--text-muted)] ml-2 truncate">{h.name}</span>
                  </div>
                  <button
                    type="button"
                    disabled={inList || symbols.length >= FOCUS_SYMBOL_LIMIT}
                    onClick={() => addSymbol(h.symbol)}
                    className="text-[10px] uppercase px-2 py-1 border border-[var(--panel-border)] rounded disabled:opacity-40 shrink-0"
                  >
                    {inList ? "On list" : "Add"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-terminal text-[var(--text-muted)] uppercase">
            My list ({symbols.length}/{FOCUS_SYMBOL_LIMIT})
          </span>
          {symbols.length > 0 && (
            <button
              type="button"
              onClick={() => setSymbols([])}
              className="text-[10px] text-[var(--text-muted)] underline"
            >
              Clear all
            </button>
          )}
        </div>
        {symbols.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] font-terminal">No symbols yet — search above to add.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {symbols.map((s) => (
              <DeskSymbolChip key={s} symbol={s} onRemove={() => removeSymbol(s)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
