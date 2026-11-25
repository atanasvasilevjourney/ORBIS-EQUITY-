/** Latest-session quotes from prices_daily (close-to-close day %). */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/supabase/paginate";
import { isEodStale, lastExpectedEodDate } from "@/lib/freshness";
import { sessionMove } from "@/lib/rotationDesk";

export type PriceBar = { symbol: string; date: string; close: number; volume?: number | null };

export type SessionQuote = {
  last: number | null;
  dayPct: number | null;
  asOf: string | null;
  stale: boolean;
  volume: number | null;
};

function cutoffIso(daysBack = 14): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

export function quotesFromBars(bars: PriceBar[], expectedEod = lastExpectedEodDate()): Map<string, SessionQuote> {
  const bySym = new Map<string, PriceBar[]>();
  for (const bar of bars) {
    if (!bar.symbol || !Number.isFinite(bar.close)) continue;
    const list = bySym.get(bar.symbol) ?? [];
    list.push(bar);
    bySym.set(bar.symbol, list);
  }
  const out = new Map<string, SessionQuote>();
  for (const [symbol, series] of Array.from(bySym.entries())) {
    const move = sessionMove(series.map((b) => ({ date: b.date, close: b.close })));
    const latest = [...series].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    const asOf = move.asOf ?? latest?.date ?? null;
    out.set(symbol, {
      last: move.last,
      dayPct: move.dayPct,
      asOf,
      stale: asOf ? isEodStale(asOf) : true,
      volume: latest?.volume ?? null,
    });
  }
  return out;
}

export async function fetchRecentPriceBars(
  sb: SupabaseClient,
  symbols: string[]
): Promise<PriceBar[]> {
  const uniq = Array.from(new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean)));
  if (!uniq.length) return [];
  const since = cutoffIso(14);
  const rows = await fetchAll<{
    symbol: string;
    date: string;
    close: number | string | null;
    adj_close?: number | string | null;
    volume?: number | null;
  }>(
    sb,
    "prices_daily",
    "symbol, date, close, adj_close, volume",
    (q) => q.in("symbol", uniq).gte("date", since).order("date", { ascending: true })
  ).catch(() => []);
  const out: PriceBar[] = [];
  for (const r of rows) {
    const px = Number(r.adj_close ?? r.close);
    if (!Number.isFinite(px)) continue;
    out.push({
      symbol: r.symbol,
      date: String(r.date).slice(0, 10),
      close: px,
      volume: r.volume != null && Number.isFinite(Number(r.volume)) ? Number(r.volume) : null,
    });
  }
  return out;
}

export async function fetchSessionQuotes(
  sb: SupabaseClient,
  symbols: string[],
  expectedEod = lastExpectedEodDate()
): Promise<Map<string, SessionQuote>> {
  const bars = await fetchRecentPriceBars(sb, symbols);
  return quotesFromBars(bars, expectedEod);
}

/** Price × session volume — not options tape; crude activity proxy only. */
export function optionsFlowProxy(quote: SessionQuote | undefined): {
  value: number | null;
  isProxy: true;
  definition: string;
} {
  const definition =
    "Session price × share volume from cash EOD bars. Not listed options flow or net premium.";
  if (!quote?.last || quote.volume == null || quote.volume <= 0) {
    return { value: null, isProxy: true, definition };
  }
  return { value: quote.last * quote.volume, isProxy: true, definition };
}