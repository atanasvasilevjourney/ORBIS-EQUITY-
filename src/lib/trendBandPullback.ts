/**
 * pb_ema trend-band pullback — EMA200(high) upper, EMA200(low) lower.
 * Mirrors pipeline/trend_band_scanner; reuses ema200_scanner Pine seeding via chartEma.
 */

import { emaPineSeries } from "@/lib/chartEma";

export const PB_EMA_DEFAULTS = {
  emaPeriod: 200,
  historyMinBars: 200,
  weeklyHistoryMinBars: 220,
  slopeLookbackDaily: 20,
  slopeLookbackWeekly: 8,
  minBandSlopePct: 0,
  swingHighLookbackDaily: 40,
  swingHighLookbackWeekly: 16,
  minAdvancePct: 6,
  minPullbackPct: 2.5,
  maxPullbackPct: 28,
  proximityPct: 3,
  lowTouchExtraPct: 1.5,
  flipLookbackDaily: 12,
  flipLookbackWeekly: 6,
  sparkBarsDaily: 90,
  sparkBarsWeekly: 52,
  dualTimeframeBonus: 12,
} as const;

export type PbTimeframe = "1d" | "1wk";

export type PbEmaSparkBar = {
  date: string;
  close: number;
  ema200High: number;
  ema200Low: number;
  rising: boolean;
};

export type TrendBandHit = {
  timeframe: PbTimeframe;
  setupKind: "pullback" | "band_flip";
  score: number;
  close: number;
  bandLo: number;
  bandHi: number;
  ema200High: number;
  ema200Low: number;
  invalidation: number;
  distToBandPct: number;
  pullbackPct: number;
  advancePct: number;
  bandSlopePct: number;
  bandColor: string;
  bandFlip: boolean;
  daysSinceFlip: number | null;
  spark: PbEmaSparkBar[];
  emaPeriod: number;
  assetClass?: string;
};

type Ohlc = { time: string; high: number; low: number; close: number };

function tfParams(tf: PbTimeframe) {
  const p = PB_EMA_DEFAULTS;
  const weekly = tf === "1wk";
  return {
    historyMin: weekly ? p.weeklyHistoryMinBars : p.historyMinBars,
    slopeLb: weekly ? p.slopeLookbackWeekly : p.slopeLookbackDaily,
    swingLb: weekly ? p.swingHighLookbackWeekly : p.swingHighLookbackDaily,
    flipLb: weekly ? p.flipLookbackWeekly : p.flipLookbackDaily,
    spark: weekly ? p.sparkBarsWeekly : p.sparkBarsDaily,
  };
}

function bandFrame(highs: number[], lows: number[], closes: number[], tf: PbTimeframe) {
  const p = PB_EMA_DEFAULTS;
  const { slopeLb, historyMin } = tfParams(tf);
  const emaHi = emaPineSeries(highs, p.emaPeriod);
  const emaLo = emaPineSeries(lows, p.emaPeriod);
  const rising: boolean[] = [];
  const slope: (number | null)[] = [];
  const flipAge: (number | null)[] = [];
  let lastFlip: number | null = null;

  for (let i = 0; i < closes.length; i++) {
    if (i < historyMin - 1 || emaHi[i] == null || emaLo[i] == null) {
      rising.push(false);
      slope.push(null);
      flipAge.push(null);
      continue;
    }
    const mid = (emaHi[i]! + emaLo[i]!) / 2;
    const midLag =
      i >= slopeLb && emaHi[i - slopeLb] != null && emaLo[i - slopeLb] != null
        ? (emaHi[i - slopeLb]! + emaLo[i - slopeLb]!) / 2
        : null;
    const slopePct = midLag && midLag > 0 ? ((mid - midLag) / midLag) * 100 : 0;
    const isRising = slopePct >= p.minBandSlopePct;
    rising.push(isRising);
    slope.push(slopePct);
    if (i > 0 && isRising && !rising[i - 1]) lastFlip = i;
    flipAge.push(isRising && lastFlip != null ? i - lastFlip : null);
  }
  return { emaHi, emaLo, rising, slope, flipAge };
}

export function resampleToWeekly(candles: Ohlc[]): Ohlc[] {
  if (!candles.length) return [];
  const buckets = new Map<string, Ohlc[]>();
  for (const c of candles) {
    const d = new Date(`${c.time.slice(0, 10)}T12:00:00Z`);
    const day = d.getUTCDay();
    const diff = (5 - day + 7) % 7;
    d.setUTCDate(d.getUTCDate() + diff);
    const key = d.toISOString().slice(0, 10);
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, bars]) => ({
      time,
      high: Math.max(...bars.map((bar) => bar.high)),
      low: Math.min(...bars.map((bar) => bar.low)),
      close: bars[bars.length - 1].close,
    }));
}

function scoreHit(distPct: number, slopePct: number, pullbackPct: number, bandFlip: boolean): number {
  const prox = Math.max(0, 100 - distPct * (100 / (PB_EMA_DEFAULTS.proximityPct * 2)));
  const proxPts = Math.min(40, Math.max(0, prox * 0.4));
  const trend = Math.min(25, Math.max(0, Math.abs(slopePct) * 4));
  const pull = Math.min(20, Math.max(0, 20 - Math.abs(pullbackPct - 10) * 1.5));
  const flipBonus = bandFlip ? 15 : 0;
  return Math.round((proxPts + trend + pull + flipBonus) * 100) / 100;
}

export function scanTrendBandFromCandles(candles: Ohlc[], timeframe: PbTimeframe = "1d"): TrendBandHit | null {
  const p = PB_EMA_DEFAULTS;
  const tf = tfParams(timeframe);
  if (candles.length < tf.historyMin + tf.swingLb + 5) return null;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const { emaHi, emaLo, rising, slope, flipAge } = bandFrame(highs, lows, closes, timeframe);
  const i = candles.length - 1;
  const hi = emaHi[i];
  const lo = emaLo[i];
  if (hi == null || lo == null) return null;

  const bandLo = lo;
  const bandHi = hi;
  const lastClose = closes[i];
  const lastLow = lows[i];

  if (!rising[i]) {
    const flipDays = flipAge[i];
    if (flipDays == null || flipDays > tf.flipLb) return null;
  }

  if (lastClose < bandLo) return null;

  const look = tf.swingLb;
  const recentHigh = Math.max(...highs.slice(-look));
  const pullbackPct = ((recentHigh - lastClose) / recentHigh) * 100;
  if (pullbackPct < p.minPullbackPct || pullbackPct > p.maxPullbackPct) return null;
  const anchorLow = Math.min(...lows.slice(-look));
  const advancePct = anchorLow > 0 ? ((recentHigh - anchorLow) / anchorLow) * 100 : 0;
  if (advancePct < p.minAdvancePct) return null;

  const distToBand = ((lastClose - bandHi) / bandHi) * 100;
  const touched = lastLow <= bandHi * (1 + p.lowTouchExtraPct / 100);
  const near = distToBand <= p.proximityPct;
  if (!touched && !near) return null;

  const slopePct = slope[i] ?? 0;
  const flipDays = flipAge[i];
  const bandFlip = rising[i] && flipDays != null && flipDays <= tf.flipLb;

  const spark: PbEmaSparkBar[] = [];
  const start = Math.max(0, candles.length - tf.spark);
  for (let k = start; k < candles.length; k++) {
    if (emaHi[k] == null || emaLo[k] == null) continue;
    spark.push({
      date: candles[k].time.slice(0, 10),
      close: closes[k],
      ema200High: emaHi[k]!,
      ema200Low: emaLo[k]!,
      rising: rising[k],
    });
  }

  return {
    timeframe,
    setupKind: bandFlip ? "band_flip" : "pullback",
    score: scoreHit(Math.max(0, distToBand), slopePct, pullbackPct, bandFlip),
    close: lastClose,
    bandLo,
    bandHi,
    ema200High: bandHi,
    ema200Low: bandLo,
    invalidation: bandLo,
    distToBandPct: Math.round(distToBand * 1000) / 1000,
    pullbackPct: Math.round(pullbackPct * 1000) / 1000,
    advancePct: Math.round(advancePct * 1000) / 1000,
    bandSlopePct: Math.round(slopePct * 10000) / 10000,
    bandColor: rising[i] ? "green" : "red",
    bandFlip,
    daysSinceFlip: bandFlip ? flipDays : null,
    spark,
    emaPeriod: p.emaPeriod,
  };
}

export function scanBothTimeframes(dailyCandles: Ohlc[]): TrendBandHit[] {
  const out: TrendBandHit[] = [];
  const d = scanTrendBandFromCandles(dailyCandles, "1d");
  if (d) out.push(d);
  const weekly = resampleToWeekly(dailyCandles);
  if (weekly.length >= PB_EMA_DEFAULTS.weeklyHistoryMinBars) {
    const w = scanTrendBandFromCandles(weekly, "1wk");
    if (w) out.push(w);
  }
  if (out.length >= 2) {
    for (const h of out) h.score += PB_EMA_DEFAULTS.dualTimeframeBonus;
  }
  return out;
}