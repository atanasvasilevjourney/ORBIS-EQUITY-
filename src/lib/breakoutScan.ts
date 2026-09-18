import type { SessionMover } from "@/lib/sessionMovers";
import type { SparkItem } from "@/lib/yahooSpark";

export const BREAKOUT_LOOKBACK = 100;
export const BREAKOUT_MIN_PRICE = 1;
export const BREAKOUT_MIN_VOLUME = 1_000_000;

export type BreakoutHit = SessionMover & {
  priorHigh: number;
  lookback: number;
  excessPct: number;
  rsi: number | null;
  tf: "1d" | "5m";
};

/** Highest close of the last `lookback` bars, excluding the current bar. ThinkScript Highest(close, n)[1]. */
export function highestPriorClose(closes: number[], lookback = BREAKOUT_LOOKBACK): number | null {
  if (closes.length < lookback + 1) return null;
  const end = closes.length - 1;
  const start = end - lookback;
  let hi = -Infinity;
  for (let i = start; i < end; i++) {
    const v = closes[i];
    if (Number.isFinite(v) && v > hi) hi = v;
  }
  return Number.isFinite(hi) ? hi : null;
}

/** Wilder RSI; last value or null if the series is too short. */
export function rsiWilder(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0 && avgGain === 0) return 50;
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function closeBreakout(
  closes: number[],
  lookback = BREAKOUT_LOOKBACK
): { last: number; priorHigh: number; excessPct: number } | null {
  const priorHigh = highestPriorClose(closes, lookback);
  const last = closes[closes.length - 1];
  if (priorHigh == null || last == null || !(last > 0) || !(priorHigh > 0)) return null;
  if (!(last > priorHigh)) return null;
  return { last, priorHigh, excessPct: last / priorHigh - 1 };
}

export function sparkCloses(item: SparkItem): number[] {
  const raw = item.response?.[0]?.indicators?.quote?.[0]?.close ?? [];
  const out: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (v != null && Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
}

type Bar = {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

export function dailyCloseBreakouts(
  bars: Bar[],
  names: Record<string, string> = {},
  opts?: { lookback?: number; minPrice?: number; minVolume?: number }
): BreakoutHit[] {
  const lookback = opts?.lookback ?? BREAKOUT_LOOKBACK;
  const minPrice = opts?.minPrice ?? BREAKOUT_MIN_PRICE;
  const minVolume = opts?.minVolume ?? BREAKOUT_MIN_VOLUME;
  const bySym = new Map<string, Bar[]>();
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!b?.symbol || !(b.close > 0)) continue;
    const list = bySym.get(b.symbol);
    if (list) list.push(b);
    else bySym.set(b.symbol, [b]);
  }
  const out: BreakoutHit[] = [];
  bySym.forEach((list, symbol) => {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const closes = list.map((r) => r.close);
    const hit = closeBreakout(closes, lookback);
    if (!hit) return;
    const lastBar = list[list.length - 1];
    const vol = lastBar.volume;
    if (hit.last < minPrice) return;
    if (vol == null || vol < minVolume) return;
    const prev = list.length >= 2 ? list[list.length - 2].close : hit.last;
    out.push({
      ticker: symbol,
      companyName: names[symbol] ?? "",
      last: hit.last,
      prevClose: prev,
      open: lastBar.open,
      high: lastBar.high,
      low: lastBar.low,
      volume: vol,
      chgPct: prev > 0 ? hit.last / prev - 1 : 0,
      chgAbs: hit.last - prev,
      gapPct: prev > 0 ? lastBar.open / prev - 1 : 0,
      dollarVol: hit.last * vol,
      priorHigh: hit.priorHigh,
      lookback,
      excessPct: hit.excessPct,
      rsi: rsiWilder(closes),
      tf: "1d",
    });
  });
  return out;
}

export function sparkCloseBreakouts(
  items: SparkItem[],
  names: Record<string, string> = {},
  dailyVol: Record<string, number | null> = {},
  opts?: { lookback?: number; minPrice?: number; minVolume?: number }
): BreakoutHit[] {
  const lookback = opts?.lookback ?? BREAKOUT_LOOKBACK;
  const minPrice = opts?.minPrice ?? BREAKOUT_MIN_PRICE;
  const minVolume = opts?.minVolume ?? BREAKOUT_MIN_VOLUME;
  const out: BreakoutHit[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const ticker = String(item.symbol || item.response?.[0]?.meta?.symbol || "").toUpperCase();
    if (!ticker) continue;
    const closes = sparkCloses(item);
    const hit = closeBreakout(closes, lookback);
    if (!hit) continue;
    if (hit.last < minPrice) continue;
    const vol = dailyVol[ticker];
    if (vol == null || vol < minVolume) continue;
    const q = item.response?.[0]?.indicators?.quote?.[0];
    const prev = closes.length >= 2 ? closes[closes.length - 2] : hit.last;
    const open = q?.open?.[q.open.length - 1];
    const high = q?.high?.[q.high.length - 1];
    const low = q?.low?.[q.low.length - 1];
    out.push({
      ticker,
      companyName: names[ticker] ?? "",
      last: hit.last,
      prevClose: prev,
      open: open != null && Number.isFinite(open) ? open : hit.last,
      high: high != null && Number.isFinite(high) ? high : hit.last,
      low: low != null && Number.isFinite(low) ? low : hit.last,
      volume: vol,
      chgPct: prev > 0 ? hit.last / prev - 1 : 0,
      chgAbs: hit.last - prev,
      gapPct: 0,
      dollarVol: vol * hit.last,
      priorHigh: hit.priorHigh,
      lookback,
      excessPct: hit.excessPct,
      rsi: rsiWilder(closes),
      tf: "5m",
    });
  }
  return out;
}

export type CandleSeries = {
  ticker: string;
  candles: Array<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }>;
};

/** Same `close > Highest(close, 100)[1]` study on LSE vault (or any) 5m candles. */
export function candleCloseBreakouts(
  series: CandleSeries[],
  names: Record<string, string> = {},
  dailyVol: Record<string, number | null> = {},
  opts?: { lookback?: number; minPrice?: number; minVolume?: number }
): BreakoutHit[] {
  const lookback = opts?.lookback ?? BREAKOUT_LOOKBACK;
  const minPrice = opts?.minPrice ?? BREAKOUT_MIN_PRICE;
  const minVolume = opts?.minVolume ?? BREAKOUT_MIN_VOLUME;
  const out: BreakoutHit[] = [];
  for (let i = 0; i < series.length; i++) {
    const item = series[i];
    const ticker = String(item?.ticker || "").toUpperCase();
    if (!ticker) continue;
    const candles = item.candles ?? [];
    const closes: number[] = [];
    for (let j = 0; j < candles.length; j++) {
      const c = candles[j]?.close;
      if (c != null && Number.isFinite(c) && c > 0) closes.push(c);
    }
    const hit = closeBreakout(closes, lookback);
    if (!hit) continue;
    if (hit.last < minPrice) continue;
    const vol = dailyVol[ticker];
    if (vol == null || vol < minVolume) continue;
    const lastBar = candles[candles.length - 1];
    const prev = closes.length >= 2 ? closes[closes.length - 2] : hit.last;
    out.push({
      ticker,
      companyName: names[ticker] ?? "",
      last: hit.last,
      prevClose: prev,
      open: lastBar?.open ?? hit.last,
      high: lastBar?.high ?? hit.last,
      low: lastBar?.low ?? hit.last,
      volume: vol,
      chgPct: prev > 0 ? hit.last / prev - 1 : 0,
      chgAbs: hit.last - prev,
      gapPct: 0,
      dollarVol: vol * hit.last,
      priorHigh: hit.priorHigh,
      lookback,
      excessPct: hit.excessPct,
      rsi: rsiWilder(closes),
      tf: "5m",
    });
  }
  return out;
}

export function rankBreakouts(
  rows: BreakoutHit[],
  sort: "volume" | "rsi" = "volume",
  n = 80
): BreakoutHit[] {
  const copy = [...rows];
  if (sort === "rsi") {
    copy.sort((a, b) => (b.rsi ?? -1) - (a.rsi ?? -1));
  } else {
    copy.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  }
  return copy.slice(0, n);
}
