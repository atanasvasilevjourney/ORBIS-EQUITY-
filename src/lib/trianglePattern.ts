/**
 * Triangle pattern detection — mirrors pipeline/triangle_scanner/patterns/triangles.py
 * for live chart overlays when Supabase rows are missing.
 */

import type { Candle, ChartLevel, ChartSegment } from "@/components/chart/TradingChart";

export type TrianglePatternType = "ascending" | "descending";
export type TriangleStatus = "forming" | "breakout_up" | "breakout_down";

export type TriangleGeometry = {
  window?: { from: string; to: string };
  support?: {
    from: string;
    to: string;
    price: number;
    price_start?: number;
    price_end?: number;
  };
  resistance?: {
    from: { time: string; price: number };
    to: { time: string; price: number };
  };
};

export type TriangleHit = {
  patternType: TrianglePatternType;
  status: TriangleStatus;
  score: number;
  resistancePrice: number;
  supportPrice: number;
  geometry: TriangleGeometry;
  close: number;
};

export type TriangleConfig = {
  lookbackBars: number;
  swingOrder: number;
  minSwingPoints: number;
  flatTolerancePct: number;
  minSlopePctPerBar: number;
  maxSlopePctPerBar: number;
  breakoutBufferPct: number;
};

export const TRIANGLE_DEFAULTS: TriangleConfig = {
  lookbackBars: 80,
  swingOrder: 3,
  minSwingPoints: 2,
  flatTolerancePct: 1.8,
  minSlopePctPerBar: 0.02,
  maxSlopePctPerBar: 2.5,
  breakoutBufferPct: 0.15,
};

type Ohlc = { time: string; high: number; low: number; close: number };

function swingPoints(series: number[], order: number, kind: "high" | "low"): { i: number; v: number }[] {
  const out: { i: number; v: number }[] = [];
  if (series.length < order * 2 + 1) return out;
  for (let i = order; i < series.length - order; i++) {
    let winMin = Infinity;
    let winMax = -Infinity;
    for (let j = i - order; j <= i + order; j++) {
      winMin = Math.min(winMin, series[j]);
      winMax = Math.max(winMax, series[j]);
    }
    const v = series[i];
    if (kind === "high" && v === winMax && v > winMin) out.push({ i, v });
    if (kind === "low" && v === winMin && v < winMax) out.push({ i, v });
  }
  return out;
}

function flatEnough(values: number[], tolPct: number): boolean {
  if (values.length < 2) return false;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  if (avg <= 0) return false;
  const spread = ((Math.max(...values) - Math.min(...values)) / avg) * 100;
  return spread <= tolPct;
}

function slopePctPerBar(indices: number[], values: number[]): number | null {
  if (indices.length < 2) return null;
  const n = indices.length;
  const xMean = indices.reduce((a, b) => a + b, 0) / n;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let k = 0; k < n; k++) {
    num += (indices[k] - xMean) * (values[k] - yMean);
    den += (indices[k] - xMean) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  return (slope / yMean) * 100;
}

function lineValue(i0: number, p0: number, i1: number, p1: number, at: number): number {
  if (i1 === i0) return p0;
  const slope = (p1 - p0) / (i1 - i0);
  return p0 + slope * (at - i0);
}

function buildGeometry(
  dates: string[],
  supportPrice: number,
  resI0: number,
  resP0: number,
  resI1: number,
  resP1: number,
  supExtra?: { from: number; to: number; p0: number; p1: number }
): TriangleGeometry {
  const last = dates.length - 1;
  const geom: TriangleGeometry = {
    window: { from: dates[0], to: dates[last] },
    support: { from: dates[0], to: dates[last], price: supportPrice },
    resistance: {
      from: { time: dates[resI0], price: resP0 },
      to: { time: dates[resI1], price: resP1 },
    },
  };
  if (supExtra) {
    geom.support = {
      from: dates[supExtra.from],
      to: dates[supExtra.to],
      price: supportPrice,
      price_start: supExtra.p0,
      price_end: supExtra.p1,
    };
  }
  return geom;
}

export function detectTriangleFromOhlc(
  bars: Ohlc[],
  pattern: TrianglePatternType,
  cfg: TriangleConfig = TRIANGLE_DEFAULTS
): TriangleHit | null {
  if (bars.length < cfg.lookbackBars) return null;
  const window = bars.slice(-cfg.lookbackBars);
  const dates = window.map((b) => b.time.slice(0, 10));
  const high = window.map((b) => b.high);
  const low = window.map((b) => b.low);
  const close = window.map((b) => b.close);
  const n = window.length;
  const lastI = n - 1;
  const lastClose = close[lastI];
  const prevClose = close[lastI - 1] ?? lastClose;

  const sh = swingPoints(high, cfg.swingOrder, "high");
  const sl = swingPoints(low, cfg.swingOrder, "low");
  if (sh.length < cfg.minSwingPoints || sl.length < cfg.minSwingPoints) return null;

  if (pattern === "ascending") {
    const maxHi = Math.max(...sh.map((h) => h.v));
    const tolFrac = cfg.flatTolerancePct / 100;
    const highs = sh.filter((h) => h.v >= maxHi * (1 - tolFrac));
    if (highs.length < cfg.minSwingPoints) return null;
    const hiPts = highs.slice(-cfg.minSwingPoints);
    if (!flatEnough(hiPts.map((h) => h.v), cfg.flatTolerancePct)) return null;
    const loMin = Math.min(...low);
    const loMax = Math.max(...low);
    const loSpan = loMax - loMin;
    const loCut = loSpan > 0 ? loMin + loSpan * 0.35 : loMin;
    const sigLows = sl.filter((l) => l.v >= loCut);
    if (sigLows.length < cfg.minSwingPoints) return null;
    const slope = slopePctPerBar(sigLows.map((l) => l.i), sigLows.map((l) => l.v));
    if (slope == null || slope < cfg.minSlopePctPerBar || slope > cfg.maxSlopePctPerBar) return null;
    const resistance = hiPts.reduce((a, h) => a + h.v, 0) / hiPts.length;
    const lows = sigLows.slice(-cfg.minSwingPoints);
    const support = lows.reduce((a, l) => a + l.v, 0) / lows.length;
    const buffer = resistance * (cfg.breakoutBufferPct / 100);
    let status: TriangleStatus = "forming";
    if (lastClose > resistance + buffer && prevClose <= resistance + buffer) status = "breakout_up";
    else if (lastClose < support && prevClose >= support) status = "breakout_down";
    const score = Math.min(100, 40 + slope * 8 + hiPts.length * 5);
    const geom = buildGeometry(
      dates,
      support,
      hiPts[0].i,
      hiPts[0].v,
      hiPts[hiPts.length - 1].i,
      hiPts[hiPts.length - 1].v,
      {
        from: lows[0].i,
        to: lows[lows.length - 1].i,
        p0: lows[0].v,
        p1: lows[lows.length - 1].v,
      }
    );
    return {
      patternType: "ascending",
      status,
      score,
      resistancePrice: resistance,
      supportPrice: support,
      geometry: geom,
      close: lastClose,
    };
  }

  const minLo = Math.min(...sl.map((l) => l.v));
  const tolFrac = cfg.flatTolerancePct / 100;
  const lowsFiltered = sl.filter((l) => l.v <= minLo * (1 + tolFrac));
  if (lowsFiltered.length < cfg.minSwingPoints) return null;
  const lowsPts = lowsFiltered.slice(-cfg.minSwingPoints);
  if (!flatEnough(lowsPts.map((l) => l.v), cfg.flatTolerancePct)) return null;
  const hiMax = Math.max(...high);
  const hiMin = Math.min(...high);
  const hiSpan = hiMax - hiMin;
  const hiCut = hiSpan > 0 ? hiMax - hiSpan * 0.35 : hiMax;
  const sigHighs = sh.filter((h) => h.v >= hiCut);
  if (sigHighs.length < cfg.minSwingPoints) return null;
  const slopeHi = slopePctPerBar(sigHighs.map((h) => h.i), sigHighs.map((h) => h.v));
  const highsPts = sigHighs.slice(-cfg.minSwingPoints);
  if (
    slopeHi == null ||
    slopeHi > -cfg.minSlopePctPerBar ||
    slopeHi < -cfg.maxSlopePctPerBar
  )
    return null;
  const support = lowsPts.reduce((a, l) => a + l.v, 0) / lowsPts.length;
  const hi0 = highsPts[0];
  const hi1 = highsPts[highsPts.length - 1];
  const resistanceNow = lineValue(hi0.i, hi0.v, hi1.i, hi1.v, lastI);
  const resistancePrev = lineValue(hi0.i, hi0.v, hi1.i, hi1.v, lastI - 1);
  const buffer = resistanceNow * (cfg.breakoutBufferPct / 100);
  let status: TriangleStatus = "forming";
  if (lastClose > resistanceNow + buffer && prevClose <= resistancePrev + buffer) status = "breakout_up";
  else if (lastClose < support && prevClose >= support) status = "breakout_down";
  const score = Math.min(100, 40 + Math.abs(slopeHi) * 8 + highsPts.length * 5);
  const geom = buildGeometry(dates, support, hi0.i, hi0.v, hi1.i, hi1.v);
  return {
    patternType: "descending",
    status,
    score,
    resistancePrice: resistanceNow,
    supportPrice: support,
    geometry: geom,
    close: lastClose,
  };
}

export function detectTrianglesFromCandles(candles: Candle[], cfg?: TriangleConfig): TriangleHit[] {
  const bars: Ohlc[] = candles.map((c) => ({
    time: String(c.time),
    high: c.high,
    low: c.low,
    close: c.close,
  }));
  const out: TriangleHit[] = [];
  for (const p of ["ascending", "descending"] as TrianglePatternType[]) {
    const hit = detectTriangleFromOhlc(bars, p, cfg);
    if (hit) out.push(hit);
  }
  return out;
}

export function triangleGeometryToChart(
  geom: TriangleGeometry | null | undefined,
  patternType: TrianglePatternType
): { segments: ChartSegment[]; levels: ChartLevel[] } {
  if (!geom) return { segments: [], levels: [] };
  const segments: ChartSegment[] = [];
  const levels: ChartLevel[] = [];
  const res = geom.resistance;
  if (res?.from && res?.to) {
    segments.push({
      title: patternType === "ascending" ? "Resistance (flat)" : "Resistance (desc)",
      color: "var(--accent-warning)",
      dashed: false,
      points: [
        { time: res.from.time, price: res.from.price },
        { time: res.to.time, price: res.to.price },
      ],
    });
  }
  const sup = geom.support;
  if (sup) {
    if (
      patternType === "ascending" &&
      sup.price_start != null &&
      sup.price_end != null &&
      sup.from &&
      sup.to
    ) {
      segments.push({
        title: "Support (rising)",
        color: "var(--accent-bull)",
        dashed: true,
        points: [
          { time: sup.from, price: sup.price_start },
          { time: sup.to, price: sup.price_end },
        ],
      });
    } else if (sup.price != null && sup.from && sup.to) {
      segments.push({
        title: "Support (flat)",
        color: "var(--accent-bull)",
        dashed: true,
        points: [
          { time: sup.from, price: sup.price },
          { time: sup.to, price: sup.price },
        ],
      });
    }
    levels.push({
      price: sup.price,
      title: "triangle support",
      color: "var(--accent-bull)",
      dashed: true,
    });
  }
  return { segments, levels };
}
