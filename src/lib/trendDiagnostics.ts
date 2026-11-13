/**
 * Quant Rick Trend Diagnostics.
 *
 * One reading of where nine asset classes stand on trend, using Rob Carver's
 * rules from Advanced Futures Trading Strategies: EWMAC, breakout, and
 * acceleration. Every forecast is rescaled on that asset's own history so
 * its average absolute value is 10, then capped at ±20. This describes
 * state. It does not emit orders.
 *
 * Published spec: https://www.tradingview.com/script/OUgjD1sH-Quant-Rick-Trend-Diagnostics/
 */

import { emaPineSeries } from "@/lib/chartEma";

export const EWMAC_PAIRS = [
  [8, 32],
  [16, 64],
  [32, 128],
  [64, 256],
] as const;

export const BREAKOUT_LOOKBACKS = [20, 40, 80, 160] as const;
export const ACCEL_HORIZONS = [16, 32, 64] as const;

export const VOL_WINDOW = 35;
export const CHART_FAST = 32;
export const CHART_SLOW = 128;

export const FORECAST_TARGET = 10;
export const FORECAST_CAP = 20;
/** Raw prints required before a rule is scaled. Slow EWMAC plus this window is the warmup. */
export const MIN_SCALAR_OBS = 252;

export const EWMAC_FLAT = 5;
export const ACCEL_FLAT = 2;
export const BREAKOUT_EXTREME = 15;

export const COMBINED_WEIGHTS = { ewmac: 0.4, breakout: 0.4, accel: 0.2 } as const;

/** Crypto trades ~365 days; listed markets ~252. Stretch lookbacks so both cover the same calendar time. */
export const CALENDAR_STRETCH = 365 / 252;

export const CHART_BARS = 320;

export type TrendAsset = {
  key: string;
  label: string;
  symbol: string;
  crypto: boolean;
};

export const TREND_ASSETS: readonly TrendAsset[] = [
  { key: "large", label: "Large caps", symbol: "SPY", crypto: false },
  { key: "mid", label: "Mid caps", symbol: "MDY", crypto: false },
  { key: "eq", label: "Equal weight", symbol: "RSP", crypto: false },
  { key: "small", label: "Small caps", symbol: "IWM", crypto: false },
  { key: "bonds", label: "Bonds", symbol: "TLT", crypto: false },
  { key: "gold", label: "Gold", symbol: "GLD", crypto: false },
  { key: "cmdty", label: "Commodities", symbol: "DBC", crypto: false },
  { key: "usd", label: "US dollar", symbol: "UUP", crypto: false },
  { key: "crypto", label: "Crypto", symbol: "BTC-USD", crypto: true },
] as const;

export const BENCHMARK_SYMBOL = "SPY";

export type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type ForecastPoint = number | null;

export type DiagnoseOptions = {
  /** Stretch every lookback by 365/252. Forced off in relative mode. */
  crypto?: boolean;
  minObs?: number;
};

export type ForecastBundle = {
  ewmac: ForecastPoint[];
  breakout: ForecastPoint[];
  accel: ForecastPoint[];
  combined: ForecastPoint[];
};

export type TrendReading = {
  ewmac: number | null;
  breakout: number | null;
  accel: number | null;
  combined: number | null;
  agree: string | null;
  state: string;
  reason: "benchmark" | "missing" | "warming" | null;
};

export function stretchLookback(length: number, crypto: boolean): number {
  if (!crypto || length <= 0) return length;
  return Math.max(1, Math.round(length * CALENDAR_STRETCH));
}

export function assetBySymbol(symbol: string | null | undefined): TrendAsset {
  const key = (symbol ?? "").toUpperCase();
  return TREND_ASSETS.find((a) => a.symbol === key) ?? TREND_ASSETS[0];
}

/** Population standard deviation of daily price changes. Null until `window` changes exist. */
export function priceChangeVol(close: number[], window: number): ForecastPoint[] {
  const n = close.length;
  const out: ForecastPoint[] = Array.from({ length: n }, () => null);
  if (window < 2 || n < window + 1) return out;
  const changes: number[] = [Number.NaN];
  for (let i = 1; i < n; i++) changes.push(close[i] - close[i - 1]);
  for (let i = window; i < n; i++) {
    let sum = 0;
    let sumsq = 0;
    for (let k = i - window + 1; k <= i; k++) {
      const c = changes[k];
      sum += c;
      sumsq += c * c;
    }
    const mean = sum / window;
    const variance = sumsq / window - mean * mean;
    const sigma = Math.sqrt(Math.max(0, variance));
    out[i] = sigma > 0 ? sigma : null;
  }
  return out;
}

/** Carver breakout on the close: +20 at the top of the range, −20 at the bottom, before scaling. */
export function breakoutRaw(close: number[], lookback: number): ForecastPoint[] {
  const n = close.length;
  const out: ForecastPoint[] = Array.from({ length: n }, () => null);
  if (lookback < 2) return out;
  for (let i = lookback - 1; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - lookback + 1; k <= i; k++) {
      const p = close[k];
      if (p > hi) hi = p;
      if (p < lo) lo = p;
    }
    const span = hi - lo;
    if (!(span > 0)) {
      out[i] = 0;
      continue;
    }
    const mid = (hi + lo) / 2;
    out[i] = 40 * ((close[i] - mid) / span);
  }
  return out;
}

function emaOnValidRun(values: ForecastPoint[], period: number): ForecastPoint[] {
  const n = values.length;
  const out: ForecastPoint[] = Array.from({ length: n }, () => null);
  const start = values.findIndex((v) => v != null && Number.isFinite(v));
  if (start < 0 || period <= 0) return out;
  const dense: number[] = [];
  for (let i = start; i < n; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) return out;
    dense.push(v);
  }
  const ema = emaPineSeries(dense, period);
  for (let i = 0; i < ema.length; i++) out[start + i] = ema[i];
  return out;
}

/**
 * Rescale a raw forecast so the expanding mean absolute value, using only
 * data up to each bar, equals 10. Capped at ±20. No lookahead.
 */
export function scaleForecast(raw: ForecastPoint[], minObs = MIN_SCALAR_OBS): ForecastPoint[] {
  const out: ForecastPoint[] = Array.from({ length: raw.length }, () => null);
  let sumAbs = 0;
  let count = 0;
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (v == null || !Number.isFinite(v)) continue;
    sumAbs += Math.abs(v);
    count += 1;
    if (count >= minObs && sumAbs > 0) {
      const scaled = v * ((FORECAST_TARGET * count) / sumAbs);
      out[i] = Math.max(-FORECAST_CAP, Math.min(FORECAST_CAP, scaled));
    }
  }
  return out;
}

function averageAll(rows: ForecastPoint[][]): ForecastPoint[] {
  const n = rows[0]?.length ?? 0;
  const out: ForecastPoint[] = Array.from({ length: n }, () => null);
  if (!rows.length) return out;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (const row of rows) {
      const v = row[i];
      if (v == null || !Number.isFinite(v)) continue;
      sum += v;
      count += 1;
    }
    if (count === rows.length) out[i] = sum / count;
  }
  return out;
}

function lagChange(series: ForecastPoint[], horizon: number): ForecastPoint[] {
  const out: ForecastPoint[] = Array.from({ length: series.length }, () => null);
  if (horizon <= 0) return out;
  for (let i = horizon; i < series.length; i++) {
    const now = series[i];
    const prev = series[i - horizon];
    if (now == null || prev == null || !Number.isFinite(now) || !Number.isFinite(prev)) continue;
    out[i] = now - prev;
  }
  return out;
}

function rawEwmac(close: number[], fast: number, slow: number, vol: ForecastPoint[]): ForecastPoint[] {
  const emaFast = emaPineSeries(close, fast);
  const emaSlow = emaPineSeries(close, slow);
  return close.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    const sigma = vol[i];
    if (f == null || s == null || sigma == null || !(sigma > 0)) return null;
    return (f - s) / sigma;
  });
}

export function diagnoseSeries(close: number[], opts: DiagnoseOptions = {}): ForecastBundle {
  const crypto = Boolean(opts.crypto);
  const minObs = opts.minObs ?? MIN_SCALAR_OBS;
  const vol = priceChangeVol(close, stretchLookback(VOL_WINDOW, crypto));

  const ewmacSpeeds = EWMAC_PAIRS.map(([fast, slow]) => {
    const raw = rawEwmac(
      close,
      stretchLookback(fast, crypto),
      stretchLookback(slow, crypto),
      vol
    );
    return scaleForecast(raw, minObs);
  });
  const ewmac = averageAll(ewmacSpeeds);

  const breakouts = BREAKOUT_LOOKBACKS.map((lookback) => {
    const length = stretchLookback(lookback, crypto);
    const raw = breakoutRaw(close, length);
    const smooth = Math.max(1, Math.floor(length / 4));
    return scaleForecast(emaOnValidRun(raw, smooth), minObs);
  });
  const breakout = averageAll(breakouts);

  const accelRaw = averageAll(
    ACCEL_HORIZONS.map((horizon) => lagChange(ewmac, stretchLookback(horizon, crypto)))
  );
  const accel = scaleForecast(accelRaw, minObs);

  const combined: ForecastPoint[] = ewmac.map((e, i) => {
    const b = breakout[i];
    const a = accel[i];
    if (e == null || b == null || a == null) return null;
    const blended =
      COMBINED_WEIGHTS.ewmac * e + COMBINED_WEIGHTS.breakout * b + COMBINED_WEIGHTS.accel * a;
    return Math.max(-FORECAST_CAP, Math.min(FORECAST_CAP, blended));
  });

  return { ewmac, breakout, accel, combined };
}

export function chartEmas(close: number[], crypto: boolean): {
  fast: ForecastPoint[];
  slow: ForecastPoint[];
  fastPeriod: number;
  slowPeriod: number;
} {
  const fastPeriod = stretchLookback(CHART_FAST, crypto);
  const slowPeriod = stretchLookback(CHART_SLOW, crypto);
  return {
    fast: emaPineSeries(close, fastPeriod),
    slow: emaPineSeries(close, slowPeriod),
    fastPeriod,
    slowPeriod,
  };
}

function lastFinite(series: ForecastPoint[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

export function agreementLabel(
  ewmac: number | null,
  breakout: number | null,
  accel: number | null,
  combined: number | null
): string | null {
  if (combined == null || combined === 0 || !Number.isFinite(combined)) return null;
  const sign = combined > 0 ? 1 : -1;
  let n = 0;
  for (const v of [ewmac, breakout, accel]) {
    if (v == null || v === 0 || !Number.isFinite(v)) continue;
    if ((v > 0 ? 1 : -1) === sign) n += 1;
  }
  return `${n}/3`;
}

/**
 * Trend level comes from EWMAC (±5 is no trend). Acceleration comes from
 * Accel (±2 is flat). A breakout past ±15 is appended.
 */
export function trendState(
  ewmac: number | null,
  accel: number | null,
  breakout: number | null
): string {
  if (ewmac == null || !Number.isFinite(ewmac)) return "n/a";
  if (accel == null || !Number.isFinite(accel)) return "warming";
  const level = ewmac > EWMAC_FLAT ? "up" : ewmac < -EWMAC_FLAT ? "down" : "flat";
  const thrust = Math.abs(accel) <= ACCEL_FLAT ? "flat" : accel > 0 ? "up" : "down";
  const label =
    level === "up"
      ? thrust === "up"
        ? "Up, building"
        : thrust === "down"
          ? "Up, fading"
          : "Up, steady"
      : level === "down"
        ? thrust === "up"
          ? "Down, fading"
          : thrust === "down"
            ? "Down, building"
            : "Down, steady"
        : thrust === "up"
          ? "Turning up"
          : thrust === "down"
            ? "Turning down"
            : "No trend";
  if (breakout != null && Number.isFinite(breakout)) {
    if (breakout > BREAKOUT_EXTREME) return `${label} + breakout`;
    if (breakout < -BREAKOUT_EXTREME) return `${label} + breakdown`;
  }
  return label;
}

export function dayPercent(close: number[]): number | null {
  if (close.length < 2) return null;
  const prev = close[close.length - 2];
  const last = close[close.length - 1];
  if (!(prev > 0) || !Number.isFinite(last)) return null;
  return (last / prev - 1) * 100;
}

function readingFromBundle(bundle: ForecastBundle, bars: number): TrendReading {
  const ewmac = lastFinite(bundle.ewmac);
  const breakout = lastFinite(bundle.breakout);
  const accel = lastFinite(bundle.accel);
  const combined = lastFinite(bundle.combined);
  const any = ewmac != null || breakout != null || accel != null || combined != null;
  return {
    ewmac,
    breakout,
    accel,
    combined,
    agree: agreementLabel(ewmac, breakout, accel, combined),
    state: trendState(ewmac, accel, breakout),
    reason: any ? null : bars > 0 ? "warming" : "missing",
  };
}

export function closeRatio(asset: PriceBar[], bench: PriceBar[]): PriceBar[] {
  const benchClose = new Map(bench.map((b) => [b.date.slice(0, 10), b.close]));
  const out: PriceBar[] = [];
  for (const bar of asset) {
    const other = benchClose.get(bar.date.slice(0, 10));
    if (other == null || !(other > 0) || !(bar.close > 0)) continue;
    const ratio = bar.close / other;
    out.push({
      date: bar.date.slice(0, 10),
      open: ratio,
      high: ratio,
      low: ratio,
      close: ratio,
    });
  }
  return out;
}

export type DiagnosticRow = TrendReading & {
  key: string;
  label: string;
  symbol: string;
  crypto: boolean;
  last: number | null;
  dayPct: number | null;
  historyBars: number;
  asOf: string | null;
  ribbon: "up" | "down" | null;
};

export type DiagnosticChart = {
  symbol: string;
  label: string;
  mode: "absolute" | "relative";
  fastPeriod: number;
  slowPeriod: number;
  candles: PriceBar[];
  emaFast: ForecastPoint[];
  emaSlow: ForecastPoint[];
};

export type DiagnosticDesk = {
  mode: "absolute" | "relative";
  benchmark: string;
  asOf: string | null;
  focus: string;
  rows: DiagnosticRow[];
  chart: DiagnosticChart | null;
};

function measuredBars(
  asset: TrendAsset,
  bars: PriceBar[] | undefined,
  bench: PriceBar[] | undefined,
  relative: boolean
): PriceBar[] {
  if (!bars?.length) return [];
  if (!relative) return bars;
  if (asset.symbol === BENCHMARK_SYMBOL) return [];
  if (!bench?.length) return [];
  return closeRatio(bars, bench);
}

function ribbonSide(fast: ForecastPoint[], slow: ForecastPoint[]): "up" | "down" | null {
  const f = lastFinite(fast);
  const s = lastFinite(slow);
  if (f == null || s == null) return null;
  return f >= s ? "up" : "down";
}

export function buildDiagnostics(input: {
  series: Record<string, PriceBar[] | undefined>;
  mode?: "absolute" | "relative";
  focus?: string | null;
  minObs?: number;
}): DiagnosticDesk {
  const mode = input.mode === "relative" ? "relative" : "absolute";
  const relative = mode === "relative";
  const focusAsset = assetBySymbol(input.focus);
  const bench = input.series[BENCHMARK_SYMBOL] ?? [];
  let asOf: string | null = null;

  const rows: DiagnosticRow[] = TREND_ASSETS.map((asset) => {
    const own = input.series[asset.symbol] ?? [];
    const lastBar = own[own.length - 1];
    if (lastBar && (!asOf || lastBar.date > asOf)) asOf = lastBar.date.slice(0, 10);
    const last = lastBar && Number.isFinite(lastBar.close) ? lastBar.close : null;
    const dayPct = dayPercent(own.map((b) => b.close));

    if (relative && asset.symbol === BENCHMARK_SYMBOL) {
      return {
        key: asset.key,
        label: asset.label,
        symbol: asset.symbol,
        crypto: asset.crypto,
        last,
        dayPct,
        historyBars: own.length,
        asOf: lastBar ? lastBar.date.slice(0, 10) : null,
        ribbon: null,
        ewmac: null,
        breakout: null,
        accel: null,
        combined: null,
        agree: null,
        state: "n/a",
        reason: "benchmark",
      };
    }

    const measured = measuredBars(asset, own, bench, relative);
    const crypto = asset.crypto && !relative;
    const close = measured.map((b) => b.close);
    const bundle = close.length ? diagnoseSeries(close, { crypto, minObs: input.minObs }) : null;
    const reading = bundle
      ? readingFromBundle(bundle, close.length)
      : {
          ewmac: null,
          breakout: null,
          accel: null,
          combined: null,
          agree: null,
          state: "n/a",
          reason: "missing" as const,
        };
    const emas = close.length ? chartEmas(close, crypto) : null;
    return {
      key: asset.key,
      label: asset.label,
      symbol: asset.symbol,
      crypto: asset.crypto,
      last,
      dayPct,
      historyBars: close.length,
      asOf: measured.length ? measured[measured.length - 1].date.slice(0, 10) : null,
      ribbon: emas ? ribbonSide(emas.fast, emas.slow) : null,
      ...reading,
    };
  });

  const focusBars = measuredBars(
    focusAsset,
    input.series[focusAsset.symbol],
    bench,
    relative && focusAsset.symbol !== BENCHMARK_SYMBOL
  );
  let chart: DiagnosticChart | null = null;
  if (focusBars.length && !(relative && focusAsset.symbol === BENCHMARK_SYMBOL)) {
    const crypto = focusAsset.crypto && !relative;
    const emas = chartEmas(
      focusBars.map((b) => b.close),
      crypto
    );
    const start = Math.max(0, focusBars.length - CHART_BARS);
    chart = {
      symbol: focusAsset.symbol,
      label: focusAsset.label,
      mode,
      fastPeriod: emas.fastPeriod,
      slowPeriod: emas.slowPeriod,
      candles: focusBars.slice(start),
      emaFast: emas.fast.slice(start),
      emaSlow: emas.slow.slice(start),
    };
  }

  return {
    mode,
    benchmark: BENCHMARK_SYMBOL,
    asOf,
    focus: focusAsset.symbol,
    rows,
    chart,
  };
}
