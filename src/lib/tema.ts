/** TEMA 9/99/199 + MACD(12,26,9) — same seeding as pipeline.compute.perps_math. */

export const TEMA_FAST = 9;
export const TEMA_MID = 99;
export const TEMA_SLOW = 199;
export const MACD_FAST = 12;
export const MACD_SLOW = 26;
export const MACD_SIGNAL = 9;
export const TEMA_MIN_BARS = 220;
export const TEMA_SL_ATR = 2.5;
export const TEMA_TP_ATR = 4.0;

export function ema(series: number[], span: number): number[] {
  const n = series.length;
  const out = new Array<number>(n);
  if (n === 0) return out;
  const alpha = 2 / (span + 1);
  out[0] = series[0];
  for (let i = 1; i < n; i++) {
    out[i] = alpha * series[i] + (1 - alpha) * out[i - 1];
  }
  return out;
}

/** Triple EMA: 3·EMA − 3·EMA(EMA) + EMA(EMA(EMA)). */
export function tema(series: number[], span: number): number[] {
  const e1 = ema(series, span);
  const e2 = ema(e1, span);
  const e3 = ema(e2, span);
  return e1.map((v, i) => 3 * v - 3 * e2[i] + e3[i]);
}

export function macd(
  closes: number[],
  fast = MACD_FAST,
  slow = MACD_SLOW,
  signal = MACD_SIGNAL
): { line: number[]; signal: number[]; hist: number[] } {
  if (closes.length === 0) return { line: [], signal: [], hist: [] };
  const line = ema(closes, fast).map((v, i) => v - ema(closes, slow)[i]);
  const sig = ema(line, signal);
  return { line, signal: sig, hist: line.map((v, i) => v - sig[i]) };
}

export function wilderAtr(high: number[], low: number[], close: number[], period = 14): number {
  if (close.length < 2) return 0;
  const tr: number[] = [];
  for (let i = 1; i < close.length; i++) {
    tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  if (tr.length < period) {
    return tr.reduce((a, b) => a + b, 0) / (tr.length || 1);
  }
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}

export type TemaSide = "BUY" | "SELL" | "FLAT";
export type MacdAction = "HOLD" | "CLOSE";

export type TemaReadout = {
  side: TemaSide;
  grade: string;
  score: number;
  tFast: number;
  tMid: number;
  tSlow: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  macdAction: MacdAction;
  stop: number;
  takeProfit: number;
  last: number;
};

export function macdCloseAction(side: TemaSide, macdLine: number, macdSignal: number): MacdAction {
  if (side !== "BUY" && side !== "SELL") return "HOLD";
  if (!Number.isFinite(macdLine) || !Number.isFinite(macdSignal)) return "HOLD";
  if (side === "BUY") return macdLine > macdSignal ? "HOLD" : "CLOSE";
  return macdLine < macdSignal ? "HOLD" : "CLOSE";
}

function gradeFor(score: number, side: TemaSide): string {
  if (side === "FLAT") return "REJECT";
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "REJECT";
}

export type TemaBar = {
  time: string;
  close: number;
  tema9: number;
  tema99: number;
  tema199: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  regimeUp: boolean;
};

export function temaTape(
  candles: { time: string | number; open?: number; high: number; low: number; close: number }[]
): { bars: TemaBar[]; readout: TemaReadout | null } {
  if (candles.length < TEMA_MIN_BARS) return { bars: [], readout: null };
  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const t9 = tema(close, TEMA_FAST);
  const t99 = tema(close, TEMA_MID);
  const t199 = tema(close, TEMA_SLOW);
  const m = macd(close);
  const bars: TemaBar[] = candles.map((c, i) => ({
    time: String(c.time).slice(0, 10),
    close: c.close,
    tema9: t9[i],
    tema99: t99[i],
    tema199: t199[i],
    macd: m.line[i],
    macdSignal: m.signal[i],
    macdHist: m.hist[i],
    regimeUp: c.close > t199[i],
  }));

  const i = close.length - 1;
  const atr = wilderAtr(high, low, close);
  if (atr <= 0) return { bars, readout: null };
  const last = close[i];
  const regimeUp = last > t199[i];
  const regimeDn = last < t199[i];
  const triggerUp = t9[i] > t99[i];
  const triggerDn = t9[i] < t99[i];
  let side: TemaSide = "FLAT";
  let strength = 0;
  if (regimeUp && triggerUp) {
    side = "BUY";
    strength = Math.abs(t9[i] - t99[i]) / atr;
  } else if (regimeDn && triggerDn) {
    side = "SELL";
    strength = Math.abs(t9[i] - t99[i]) / atr;
  }
  const atrPct = (atr / last) * 100;
  const volBonus = atrPct >= 0.1 && atrPct <= 8 ? 5 : 0;
  const score = side === "FLAT" ? 0 : Math.min(100, 60 + Math.min(35, strength * 8) + volBonus);
  const action = macdCloseAction(side, m.line[i], m.signal[i]);
  const stop = side === "BUY" ? last - TEMA_SL_ATR * atr : side === "SELL" ? last + TEMA_SL_ATR * atr : last;
  const tp = side === "BUY" ? last + TEMA_TP_ATR * atr : side === "SELL" ? last - TEMA_TP_ATR * atr : last;
  return {
    bars,
    readout: {
      side,
      grade: gradeFor(score, side),
      score: Math.round(score * 10) / 10,
      tFast: t9[i],
      tMid: t99[i],
      tSlow: t199[i],
      macd: m.line[i],
      macdSignal: m.signal[i],
      macdHist: m.hist[i],
      macdAction: action,
      stop,
      takeProfit: tp,
      last,
    },
  };
}
