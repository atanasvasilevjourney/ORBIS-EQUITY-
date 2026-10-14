/**
 * Compute EMA200 watchlist features from prices_daily when ema200_features is empty
 * (migrations not applied yet). Matches pipeline/ema200_scanner feature math.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { emaPineSeries } from "@/lib/chartEma";
import { fetchAll } from "@/lib/supabase/paginate";

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

async function fetchPricesParallel(sb: SupabaseClient, cutoffStr: string): Promise<PriceRow[]> {
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

export async function computeEma200FeaturesLive(sb: SupabaseClient): Promise<LiveFeatureRow[]> {
  const members = await fetchAll<{ symbol: string }>(sb, "universe_members", "symbol", (q) =>
    q.eq("is_active", true)
  );
  const symbols = new Set(members.map((m) => m.symbol));
  if (!symbols.size) return [];

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 620);
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
    out.push(...featuresForSymbol(sym, bars));
  }
  return out;
}
