/** Pine-style EMA for daily chart overlays (matches pipeline ema200_scanner.indicators.ema). */

export function emaPineSeries(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const out: (number | null)[] = Array.from({ length: n }, () => null);
  if (period <= 0 || n < period) return out;
  const alpha = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < n; i++) {
    out[i] = alpha * values[i] + (1 - alpha) * (out[i - 1] as number);
  }
  return out;
}

export type SwingEmaOverlays = {
  ema49: (number | null)[];
  ema50: (number | null)[];
  ema200: (number | null)[];
  ema200High: (number | null)[];
};

/** EMA lines for a visible window, computed on the full series so the 200 is warmed up. */
export function projectSwing<T extends { close: number; high: number }>(
  candles: T[],
  keep: number
): { candles: T[]; swing: SwingEmaOverlays } {
  const swingAll = swingEmaOverlaysFromOhlc(
    candles.map((c) => c.close),
    candles.map((c) => c.high)
  );
  const start = Math.max(0, candles.length - Math.max(1, keep));
  const slice = <U>(arr: U[]) => arr.slice(start);
  return {
    candles: candles.slice(start),
    swing: {
      ema49: slice(swingAll.ema49),
      ema50: slice(swingAll.ema50),
      ema200: slice(swingAll.ema200),
      ema200High: slice(swingAll.ema200High),
    },
  };
}

export function swingEmaOverlaysFromOhlc(closes: number[], highs: number[]): SwingEmaOverlays {
  const hi = highs.length === closes.length ? highs : closes;
  return {
    ema49: emaPineSeries(closes, 49),
    ema50: emaPineSeries(closes, 50),
    ema200: emaPineSeries(closes, 200),
    ema200High: emaPineSeries(hi, 200),
  };
}
