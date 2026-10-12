/** Discretionary EMA200 watchlist filters — keep aligned with ema200_scanner.yaml watchlist + touch.shortlist_atr */

export const EMA200_DEFAULTS = {
  shortlistAtr: 1.5,
  minDaysAbove: 20,
  minSlope: 0,
  requireCloseAboveEma: true,
  requireUptrend: true,
} as const;

export type Ema200Setup = "RETRACE_HELD" | "AT_EMA_HELD" | "NEAR_EMA";

export type Ema200FeatureRow = {
  symbol: string;
  bar_date?: string;
  close: number | null;
  ema200: number | null;
  dist_atr: number | null;
  days_above?: number | null;
  ema200_slope?: number | null;
  rvol?: number | null;
  regime?: string | null;
};

export function tradingViewUrl(symbol: string): string {
  const tv = symbol.replace(/-/g, "");
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}`;
}

export function classifyEma200Setup(
  row: Ema200FeatureRow,
  opts: Partial<typeof EMA200_DEFAULTS> = {}
): Ema200Setup | null {
  const th = { ...EMA200_DEFAULTS, ...opts };
  if (row.dist_atr == null || !Number.isFinite(row.dist_atr)) return null;
  if (Math.abs(row.dist_atr) > th.shortlistAtr) return null;
  if (row.close == null || row.ema200 == null) return null;

  const held = row.close >= row.ema200;
  const daysAbove = row.days_above ?? 0;
  const slope = row.ema200_slope ?? 0;
  const uptrend = daysAbove >= th.minDaysAbove && slope > th.minSlope;

  if (th.requireUptrend && !uptrend) return null;
  if (th.requireCloseAboveEma && !held) return null;

  if (held && uptrend) return "RETRACE_HELD";
  if (held) return "AT_EMA_HELD";
  return "NEAR_EMA";
}
