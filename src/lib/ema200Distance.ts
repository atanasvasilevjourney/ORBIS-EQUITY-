/** Distance to the double EMA200 ribbon (close + high lines). */

import { EMA200_DEFAULTS, type Ema200FeatureRow } from "@/lib/ema200Watchlist";

export const APPROACHING_MAX_ATR = 3.0;

export function ribbonBounds(emaClose: number, emaHigh: number | null | undefined): { lo: number; hi: number } {
  const hiVal = emaHigh ?? emaClose;
  return { lo: Math.min(emaClose, hiVal), hi: Math.max(emaClose, hiVal) };
}

/** Dollars from close to nearest point on the ribbon band. */
export function ribbonDistUsd(
  close: number | null | undefined,
  emaClose: number | null | undefined,
  emaHigh: number | null | undefined
): number | null {
  if (close == null || emaClose == null || !Number.isFinite(close) || !Number.isFinite(emaClose)) return null;
  const { lo, hi } = ribbonBounds(emaClose, emaHigh);
  if (close < lo) return lo - close;
  if (close > hi) return close - hi;
  return 0;
}

/** % of close above the upper ribbon edge (0 if inside the band). */
export function ribbonDistPct(
  close: number | null | undefined,
  emaClose: number | null | undefined,
  emaHigh: number | null | undefined
): number | null {
  const usd = ribbonDistUsd(close, emaClose, emaHigh);
  if (usd == null || close == null || close === 0) return null;
  if (usd === 0) return 0;
  return (usd / close) * 100;
}

export function ribbonDistAtr(row: Ema200FeatureRow): number | null {
  const raw = row.ribbon_dist_atr ?? row.dist_atr;
  if (raw == null || !Number.isFinite(raw)) return null;
  return Math.abs(raw);
}

export type HistoryBar = {
  bar_date: string;
  ribbon_dist_atr: number | null;
  dist_atr: number | null;
};

export function daysSinceRibbonTouch(
  history: HistoryBar[],
  asOfDate: string,
  shortlistAtr = EMA200_DEFAULTS.shortlistAtr
): number | null {
  const sorted = [...history].sort((a, b) => a.bar_date.localeCompare(b.bar_date));
  const idx = sorted.findIndex((b) => b.bar_date === asOfDate);
  if (idx < 0) return null;
  const todayDist = ribbonDistAtrFromBar(sorted[idx]);
  if (todayDist != null && todayDist <= shortlistAtr) return 0;
  for (let i = idx - 1; i >= 0; i--) {
    const d = ribbonDistAtrFromBar(sorted[i]);
    if (d != null && d <= shortlistAtr) {
      return idx - i;
    }
  }
  return null;
}

function ribbonDistAtrFromBar(b: HistoryBar): number | null {
  const raw = b.ribbon_dist_atr ?? b.dist_atr;
  if (raw == null || !Number.isFinite(raw)) return null;
  return Math.abs(raw);
}

export function isApproachingPullback(row: Ema200FeatureRow, setup: string | null): boolean {
  if (setup) return false;
  const dist = ribbonDistAtr(row);
  if (dist == null) return false;
  if (dist <= EMA200_DEFAULTS.shortlistAtr) return false;
  if (dist > APPROACHING_MAX_ATR) return false;
  if (row.close == null || row.ema200 == null) return false;
  if (row.close < row.ema200) return false;
  const daysAbove = row.days_above ?? 0;
  const slope = row.ema200_slope ?? 0;
  return daysAbove >= EMA200_DEFAULTS.minDaysAbove && slope > EMA200_DEFAULTS.minSlope;
}
