/**
 * Compute EMA200 watchlist features from prices_daily when ema200_features is empty
 * (migrations not applied yet). Matches pipeline/ema200_scanner feature math.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { emaPineSeries } from "@/lib/chartEma";
import { EMA200_SYMBOL_SUPPLEMENTS, EMA200_WEEKLY_SYMBOL_CAP } from "@/lib/ema200Config";
import type { Ema200Timeframe } from "@/lib/ema200Timeframe";
import { aggregateDailyToWeekly } from "@/lib/ohlcWeekly";
import { fetchAll } from "@/lib/supabase/paginate";
import { fetchYahooDaily, fetchYahooWeekly } from "@/lib/yahooDaily";

const EMA_PERIOD = 200;
const ATR_PERIOD = 14;
/** Match ema200_scanner.yaml history_min_bars (hosted DB ~307 EOD bars). */
const HISTORY_MIN = 200;
const SLOPE_LOOKBACK = 20;
const HISTORY_TAIL = 45;

export type LiveFeatureRow = {
  symbol: string;
  bar_date: string;
  close: number | null;
  ema200: number | null;
  ema200_high: number | null;
  dist_atr: number | null;
  ribbon_dist_atr: number | null;
  days_above: number | null;
  ema200_slope: number | null;
  rvol: number | null;
  regime: string | null;
};

type PriceRow = {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type Ohlc = { date: string; open: number; high: number; low: number; close: number; volume: number };

function computeAtr(bars: Ohlc[], period: number): (number | null)[] {
  const n = bars.length;
  const out: (number | null)[] = Array(n).fill(null);
  const tr: number[] = [];
  for (let i = 0; i < n; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = i > 0 ? bars[i - 1].close : bars[i].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += tr[j];
    out[i] = sum / period;
  }
  return out;
}

function daysAboveSeries(close: number[], ema: (number | null)[]): number[] {
  const out = new Array(close.length).fill(0);
  for (let i = 1; i < close.length; i++) {
    const prevClose = close[i - 1];
    const prevEma = ema[i - 1];
    if (prevEma == null) {
      out[i] = 0;
      continue;
    }
    const above = prevClose > prevEma;
    out[i] = above ? out[i - 1] + 1 : 0;
  }
  return out;
}

function ribbonDist(close: number, emaC: number, emaH: number): number {
  const lo = Math.min(emaC, emaH);
  const hi = Math.max(emaC, emaH);
  if (close < lo) return lo - close;
  if (close > hi) return close - hi;
  return 0;
}

function featuresForSymbol(symbol: string, bars: Ohlc[]): LiveFeatureRow[] {
  if (bars.length < HISTORY_MIN) return [];
  const close = bars.map((b) => b.close);
  const high = bars.map((b) => b.high);
  const ema = emaPineSeries(close, EMA_PERIOD);
  const emaHigh = emaPineSeries(high, EMA_PERIOD);
  const atr = computeAtr(bars, ATR_PERIOD);
  const daysAbove = daysAboveSeries(close, ema);

  const rows: LiveFeatureRow[] = [];
  const start = Math.max(HISTORY_MIN - 1, bars.length - HISTORY_TAIL);
  for (let i = start; i < bars.length; i++) {
    if (ema[i] == null || atr[i] == null || atr[i] === 0 || emaHigh[i] == null) continue;
    const emaLag = ema[i - SLOPE_LOOKBACK];
    const slope = emaLag != null && emaLag !== 0 ? (ema[i]! - emaLag) / emaLag : null;
    const distAtr = (close[i] - ema[i]!) / atr[i]!;
    const ribbonUsd = ribbonDist(close[i], ema[i]!, emaHigh[i]!);
    const ribbonAtr = ribbonUsd / atr[i]!;
    let rvol: number | null = null;
    if (i >= 19) {
      let vsum = 0;
      for (let j = i - 19; j <= i; j++) vsum += bars[j].volume;
      const vavg = vsum / 20;
      rvol = vavg > 0 ? bars[i].volume / vavg : null;
    }
    rows.push({
      symbol,
      bar_date: bars[i].date.slice(0, 10),
      close: close[i],
      ema200: ema[i],
      ema200_high: emaHigh[i],
      dist_atr: distAtr,
      ribbon_dist_atr: ribbonAtr,
      days_above: daysAbove[i],
      ema200_slope: slope,
      rvol,
      regime: null,
    });
  }
  return rows;
}

const PAGE = 1000;

function cutoffDays(tf: Ema200Timeframe): number {
  return tf === "weekly" ? 2100 : 620;
}

async function fetchPricesParallel(
  sb: SupabaseClient,
  cutoffStr: string
): Promise<PriceRow[]> {
  const base = () =>
    sb
      .from("prices_daily")
      .select("symbol, date, open, high, low, close, volume")
      .gte("date", cutoffStr)
      .order("date", { ascending: true });

  const head = await base().range(0, PAGE - 1);
  if (head.error) throw head.error;
  const all: PriceRow[] = (head.data ?? []) as PriceRow[];
  if ((head.data?.length ?? 0) < PAGE) return all;

  let offset = PAGE;
  const batchSize = 12;
  while (true) {
    const tasks: Promise<PriceRow[]>[] = [];
    for (let b = 0; b < batchSize; b++) {
      const from = offset + b * PAGE;
      tasks.push(
        (async () => {
          const { data, error } = await base().range(from, from + PAGE - 1);
          if (error) throw error;
          return (data ?? []) as PriceRow[];
        })()
      );
    }
    const chunks = await Promise.all(tasks);
    let got = 0;
    for (const chunk of chunks) {
      all.push(...chunk);
      got += chunk.length;
    }
    if (got < batchSize * PAGE) break;
    offset += batchSize * PAGE;
  }
  return all;
}

function dailyToOhlc(rows: { date: unknown; open?: unknown; high?: unknown; low?: unknown; close?: unknown; volume?: unknown }[]): Ohlc[] {
  return rows.map((p) => ({
    date: String(p.date),
    open: Number(p.open ?? p.close),
    high: Number(p.high ?? p.close),
    low: Number(p.low ?? p.close),
    close: Number(p.close),
    volume: Number(p.volume ?? 0),
  }));
}

function toTimeframeBars(daily: Ohlc[], tf: Ema200Timeframe): Ohlc[] {
  if (tf === "daily") return daily;
  return aggregateDailyToWeekly(daily);
}

async function weeklyBarsFromYahoo(sym: string): Promise<Ohlc[] | null> {
  const weekly = await fetchYahooWeekly(sym, "10y");
  if (weekly.length >= HISTORY_MIN) return dailyToOhlc(weekly);
  const daily = await fetchYahooDaily(sym, "10y");
  const agg = aggregateDailyToWeekly(dailyToOhlc(daily));
  return agg.length >= HISTORY_MIN ? agg : null;
}

async function barsForSymbol(
  sb: SupabaseClient,
  sym: string,
  cutoffStr: string,
  cachedBySym: Map<string, Ohlc[]>,
  tf: Ema200Timeframe
): Promise<Ohlc[] | null> {
  if (tf === "weekly") {
    const yahoo = await weeklyBarsFromYahoo(sym);
    return yahoo;
  }

  const existing = cachedBySym.get(sym);
  if (existing && existing.length >= HISTORY_MIN) return existing;

  const { data, error } = await sb
    .from("prices_daily")
    .select("date, open, high, low, close, volume")
    .eq("symbol", sym)
    .gte("date", cutoffStr)
    .order("date", { ascending: true });
  if (!error && data && data.length >= HISTORY_MIN) {
    const ohlc = dailyToOhlc(data);
    return ohlc;
  }

  const yahoo = await fetchYahooDaily(sym, "5y");
  if (yahoo.length < HISTORY_MIN) return null;
  return dailyToOhlc(yahoo);
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () => worker())
  );
  return results;
}

export type WeeklyScanMeta = { capped: boolean; scanned: number; requested: number };

/** On-demand EMA200 features (daily or weekly PB-EMA ribbon). */
export async function computeEma200FeaturesForSymbols(
  sb: SupabaseClient,
  symbols: string[],
  tf: Ema200Timeframe = "daily"
): Promise<LiveFeatureRow[]> {
  const list = symbols.map((s) => s.toUpperCase()).filter(Boolean);
  if (!list.length) return [];

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - cutoffDays(tf));
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const bySym = new Map<string, Ohlc[]>();
  const concurrency = tf === "weekly" ? 6 : 1;
  const chunks = await mapPool(list, concurrency, async (sym) => {
    const bars = await barsForSymbol(sb, sym, cutoffStr, bySym, tf);
    if (!bars) return [] as LiveFeatureRow[];
    return featuresForSymbol(sym, bars);
  });
  return chunks.flat();
}

export async function computeEma200FeaturesLive(
  sb: SupabaseClient,
  tf: Ema200Timeframe = "daily"
): Promise<{ rows: LiveFeatureRow[]; weeklyMeta?: WeeklyScanMeta }> {
  const members = await fetchAll<{ symbol: string }>(sb, "universe_members", "symbol", (q) =>
    q.eq("is_active", true)
  );
  const symbols = new Set(members.map((m) => m.symbol));
  for (const s of EMA200_SYMBOL_SUPPLEMENTS) symbols.add(s);
  if (!symbols.size) return { rows: [] };

  if (tf === "weekly") {
    const all = Array.from(symbols);
    const requested = all.length;
    const capped = requested > EMA200_WEEKLY_SYMBOL_CAP;
    const slice = capped ? all.slice(0, EMA200_WEEKLY_SYMBOL_CAP) : all;
    const rows = await computeEma200FeaturesForSymbols(sb, slice, "weekly");
    return {
      rows,
      weeklyMeta: capped ? { capped: true, scanned: slice.length, requested } : undefined,
    };
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - cutoffDays(tf));
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const prices = await fetchPricesParallel(sb, cutoffStr);

  const bySym = new Map<string, Ohlc[]>();
  for (const p of prices) {
    if (!symbols.has(p.symbol)) continue;
    const list = bySym.get(p.symbol) ?? [];
    list.push({
      date: String(p.date),
      open: Number(p.open ?? p.close),
      high: Number(p.high ?? p.close),
      low: Number(p.low ?? p.close),
      close: Number(p.close),
      volume: Number(p.volume ?? 0),
    });
    bySym.set(p.symbol, list);
  }

  const out: LiveFeatureRow[] = [];
  for (const [sym, bars] of Array.from(bySym.entries())) {
    out.push(...featuresForSymbol(sym, toTimeframeBars(bars, tf)));
  }

  for (const sym of EMA200_SYMBOL_SUPPLEMENTS) {
    const existing = bySym.get(sym);
    if (existing && existing.length >= HISTORY_MIN) continue;
    const yahoo = await fetchYahooDaily(sym, "5y");
    if (yahoo.length < HISTORY_MIN) continue;
    const ohlc = dailyToOhlc(yahoo);
    out.push(...featuresForSymbol(sym, ohlc));
  }

  return { rows: out };
}
