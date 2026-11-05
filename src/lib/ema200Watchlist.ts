/** Discretionary EMA200 watchlist filters — keep aligned with ema200_scanner.yaml watchlist + touch.shortlist_atr */

import { finiteNumber } from "@/lib/adjustOhlc";

export type Ema200WatchlistOpts = {
  shortlistAtr: number;
  minDaysAbove: number;
  minSlope: number;
  requireCloseAboveEma: boolean;
  requireUptrend: boolean;
};

export const EMA200_DEFAULTS: Ema200WatchlistOpts = {
  shortlistAtr: 1.5,
  minDaysAbove: 20,
  minSlope: 0,
  requireCloseAboveEma: true,
  requireUptrend: true,
};

export type Ema200Setup = "RETRACE_HELD" | "AT_EMA_HELD" | "NEAR_EMA";

/** Feature numbers may arrive as Postgres numeric strings. */
export type Ema200Num = number | string | null;

export type Ema200FeatureRow = {
  symbol: string;
  bar_date?: string;
  close: Ema200Num;
  ema200: Ema200Num;
  ema200_high?: Ema200Num;
  dist_atr: Ema200Num;
  ribbon_dist_atr?: Ema200Num;
  days_above?: Ema200Num;
  ema200_slope?: Ema200Num;
  rvol?: Ema200Num;
  regime?: string | null;
};

function watchlistDistAtr(row: Ema200FeatureRow): number | null {
  const raw = finiteNumber(row.ribbon_dist_atr) ?? finiteNumber(row.dist_atr);
  if (raw == null) return null;
  return Math.abs(raw);
}

export function tradingViewUrl(symbol: string): string {
  const tv = symbol.replace(/-/g, "");
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}`;
}

export function classifyEma200Setup(
  row: Ema200FeatureRow,
  opts: Partial<Ema200WatchlistOpts> = {}
): Ema200Setup | null {
  const th = { ...EMA200_DEFAULTS, ...opts };
  const dist = watchlistDistAtr(row);
  if (dist == null) return null;
  if (dist > th.shortlistAtr) return null;
  const close = finiteNumber(row.close);
  const ema = finiteNumber(row.ema200);
  if (close == null || ema == null) return null;

  const held = close >= ema;
  const daysAbove = finiteNumber(row.days_above) ?? 0;
  const slope = finiteNumber(row.ema200_slope) ?? 0;
  const uptrend = daysAbove >= th.minDaysAbove && slope > th.minSlope;

  if (th.requireUptrend && !uptrend) return null;
  if (th.requireCloseAboveEma && !held) return null;

  if (held && uptrend) return "RETRACE_HELD";
  if (held) return "AT_EMA_HELD";
  return "NEAR_EMA";
}
