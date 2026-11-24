/**
 * Trend-band pullback — mirrors pipeline/trend_band_scanner (EMA 20/50 cloud).
 * Heuristic only; not a trade signal.
 */

import { emaPineSeries } from "@/lib/chartEma";

export const TREND_BAND_DEFAULTS = {
  emaFast: 20,
  emaSlow: 50,
  slopeLookback: 5,
  minBandSlopePct: 0.02,
  swingHighLookback: 40,
  minAdvancePct: 6,
  minPullbackPct: 2.5,
  maxPullbackPct: 22,
  proximityPct: 2.5,
  lowTouchExtraPct: 1.5,
  flipLookbackDays: 12,
  sparkBars: 90,
} as const;

export type TrendBandSparkBar = {
  date: string;
  close: number;
  emaFast: number;
  emaSlow: number;
  rising: boolean;
};

export type TrendBandHit = {
  setupKind: "pullback" | "band_flip";
  score: number;
  close: number;
  bandLo: number;
  bandHi: number;
  invalidation: number;
  distToBandPct: number;
  pullbackPct: number;
  advancePct: number;
  bandSlopePct: number;
  bandColor: string;
  bandFlip: boolean;
  daysSinceFlip: number | null;
  spark: TrendBandSparkBar[];
  emaFast: number;
  emaSlow: number;
};

type Ohlc = { time: string; high: number; low: number; close: number };

function midBand(fast: number, slow: number) {
  return (fast + slow) / 2;
}

function bandRising(mids: (number | null)[], lookback: number, minSlopePct: number): boolean[] {
  const out: boolean[] = mids.map(() => false);
  for (let i = lookback; i < mids.length; i++) {
    const now = mids[i];
    const lag = mids[i - lookback];
    if (now == null || lag == null || lag <= 0) continue;
    const pct = ((now - lag) / lag) * 100;
    out[i] = pct >= minSlopePct;
  }
  return out;
}

function daysSinceFlip(rising: boolean[]): (number | null)[] {
  const out: (number | null)[] = rising.map(() => null);
  let last: number | null = null;
  for (let i = 0; i < rising.length; i++) {
    if (i > 0 && rising[i] && !rising[i - 1]) last = i;
    if (rising[i] && last != null) out[i] = i - last;
  }
  return out;
}

export function buildBandSeries(closes: number[], fast = 20, slow = 50) {
  const emaFast = emaPineSeries(closes, fast);
  const emaSlow = emaPineSeries(closes, slow);
  const mids: (number | null)[] = closes.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    if (f == null || s == null) return null;
    return midBand(f, s);
  });
  const rising = bandRising(mids, TREND_BAND_DEFAULTS.slopeLookback, TREND_BAND_DEFAULTS.minBandSlopePct);
  const flipAge = daysSinceFlip(rising);
  return { emaFast, emaSlow, rising, flipAge };
}

function scoreHit(
  distPct: number,
  slopePct: number,
  pullbackPct: number,
  bandFlip: boolean
): number {
  const prox = Math.max(0, 100 - distPct * (100 / (TREND_BAND_DEFAULTS.proximityPct * 2)));
  const proxPts = Math.min(40, Math.max(0, prox * 0.4));
  const trend = Math.min(25, Math.max(0, slopePct * 8));
  const pull = Math.min(20, Math.max(0, 20 - Math.abs(pullbackPct - 10) * 1.5));
  const flipBonus = bandFlip ? 15 : 0;
  return Math.round((proxPts + trend + pull + flipBonus) * 100) / 100;
}

export function scanTrendBandFromCandles(candles: Ohlc[]): TrendBandHit | null {
  const p = TREND_BAND_DEFAULTS;
  if (candles.length < p.emaSlow + p.swingHighLookback + 5) return null;
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const { emaFast, emaSlow, rising, flipAge } = buildBandSeries(closes, p.emaFast, p.emaSlow);
  const i = candles.length - 1;
  const f = emaFast[i];
  const s = emaSlow[i];
  if (f == null || s == null) return null;
  const bandLo = Math.min(f, s);
  const bandHi = Math.max(f, s);
  const lastClose = closes[i];
  const lastLow = lows[i];

  let okRising = rising[i];
  const flipDays = flipAge[i];
  if (!okRising) {
    if (flipDays == null || flipDays > p.flipLookbackDays) return null;
  }

  if (lastClose < bandLo * (1 - p.lowTouchExtraPct / 100)) return null;

  const look = p.swingHighLookback;
  const sliceH = highs.slice(-look);
  const sliceL = lows.slice(-look);
  const recentHigh = Math.max(...sliceH);
  const anchorLow = Math.min(...sliceL);
  const pullbackPct = ((recentHigh - lastClose) / recentHigh) * 100;
  if (pullbackPct < p.minPullbackPct || pullbackPct > p.maxPullbackPct) return null;
  const advancePct = anchorLow > 0 ? ((recentHigh - anchorLow) / anchorLow) * 100 : 0;
  if (advancePct < p.minAdvancePct) return null;

  const distToBand = ((lastClose - bandHi) / bandHi) * 100;
  const touched = lastLow <= bandHi * (1 + p.lowTouchExtraPct / 100);
  const near = distToBand <= p.proximityPct;
  if (!touched && !near) return null;

  const midNow = midBand(f, s);
  const midLagIdx = i - p.slopeLookback;
  const fLag = emaFast[midLagIdx];
  const sLag = emaSlow[midLagIdx];
  const midLag = fLag != null && sLag != null ? midBand(fLag, sLag) : null;
  const slopePct = midLag && midLag > 0 ? ((midNow - midLag) / midLag) * 100 : 0;

  const bandFlip = rising[i] && flipDays != null && flipDays <= p.flipLookbackDays;
  const setupKind = bandFlip ? "band_flip" : "pullback";

  const spark: TrendBandSparkBar[] = [];
  const start = Math.max(0, candles.length - p.sparkBars);
  for (let k = start; k < candles.length; k++) {
    const ef = emaFast[k];
    const es = emaSlow[k];
    if (ef == null || es == null) continue;
    spark.push({
      date: candles[k].time.slice(0, 10),
      close: closes[k],
      emaFast: ef,
      emaSlow: es,
      rising: rising[k],
    });
  }

  return {
    setupKind,
    score: scoreHit(Math.max(0, distToBand), slopePct, pullbackPct, bandFlip),
    close: lastClose,
    bandLo,
    bandHi,
    invalidation: bandLo,
    distToBandPct: Math.round(distToBand * 1000) / 1000,
    pullbackPct: Math.round(pullbackPct * 1000) / 1000,
    advancePct: Math.round(advancePct * 1000) / 1000,
    bandSlopePct: Math.round(slopePct * 10000) / 10000,
    bandColor: rising[i] && f >= s ? "green" : "red",
    bandFlip,
    daysSinceFlip: bandFlip ? flipDays : null,
    spark,
    emaFast: p.emaFast,
    emaSlow: p.emaSlow,
  };
}