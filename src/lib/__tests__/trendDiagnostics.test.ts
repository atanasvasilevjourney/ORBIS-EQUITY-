import { describe, expect, it } from "vitest";
import {
  BENCHMARK_SYMBOL,
  agreementLabel,
  breakoutRaw,
  buildDiagnostics,
  diagnoseSeries,
  scaleForecast,
  stretchLookback,
  trendState,
  type PriceBar,
} from "@/lib/trendDiagnostics";

function path(n: number, drift: number, noise = 0.004): number[] {
  const out: number[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price *= 1 + drift + noise * Math.sin(i / 2.7);
    out.push(price);
  }
  return out;
}

function barsFrom(close: number[], symbol = "SPY"): PriceBar[] {
  return close.map((c, i) => {
    const date = new Date(Date.UTC(2010, 0, 1 + i)).toISOString().slice(0, 10);
    return { date, open: c, high: c * 1.01, low: c * 0.99, close: c };
  });
}

describe("trend diagnostics", () => {
  it("stretches crypto lookbacks onto the equity calendar", () => {
    expect(stretchLookback(8, true)).toBe(12);
    expect(stretchLookback(32, true)).toBe(46);
    expect(stretchLookback(64, false)).toBe(64);
  });

  it("puts a rising close at the top of its breakout range", () => {
    const close = Array.from({ length: 40 }, (_, i) => i + 1);
    const raw = breakoutRaw(close, 20);
    expect(raw[39]).toBeCloseTo(20, 8);
    expect(raw[18]).toBeNull();
  });

  it("scales an expanding history to average absolute value 10 and caps it", () => {
    const raw = Array.from({ length: 30 }, () => 4);
    raw[29] = 100;
    const scaled = scaleForecast(raw, 10);
    expect(scaled[8]).toBeNull();
    const warm = scaled.slice(9, 29).filter((v): v is number => v != null);
    const meanAbs = warm.reduce((s, v) => s + Math.abs(v), 0) / warm.length;
    expect(meanAbs).toBeGreaterThan(9);
    expect(meanAbs).toBeLessThan(11);
    expect(scaled[29]).toBe(20);
  });

  it("does not let a later bar change an earlier forecast", () => {
    const close = path(1100, 0.0012);
    const full = diagnoseSeries(close, { minObs: 40 });
    const cut = diagnoseSeries(close.slice(0, 800), { minObs: 40 });
    expect(cut.combined[799]).not.toBeNull();
    expect(cut.ewmac[799]).toBeCloseTo(full.ewmac[799] as number, 8);
    expect(cut.breakout[799]).toBeCloseTo(full.breakout[799] as number, 8);
    expect(cut.accel[799]).toBeCloseTo(full.accel[799] as number, 8);
    expect(cut.combined[799]).toBeCloseTo(full.combined[799] as number, 8);
  });

  it("reads a persistent uptrend as up and a persistent downtrend as down", () => {
    const up = diagnoseSeries(path(1400, 0.0016), { minObs: 80 });
    const upLast = up.combined.length - 1;
    expect(up.ewmac[upLast]).toBeGreaterThan(5);
    expect(up.breakout[upLast]).toBeGreaterThan(0);
    expect(up.combined[upLast]).toBeGreaterThan(0);
    expect(trendState(up.ewmac[upLast], up.accel[upLast], up.breakout[upLast])).toMatch(/^Up/);

    const down = diagnoseSeries(path(1400, -0.0016), { minObs: 80 });
    const downLast = down.combined.length - 1;
    expect(down.ewmac[downLast]).toBeLessThan(-5);
    expect(down.combined[downLast]).toBeLessThan(0);
    expect(trendState(down.ewmac[downLast], down.accel[downLast], down.breakout[downLast])).toMatch(/^Down/);
  });

  it("names each cell of the state grid and the range-edge tags", () => {
    expect(trendState(12, 4, 0)).toBe("Up, building");
    expect(trendState(12, 0, 0)).toBe("Up, steady");
    expect(trendState(12, -4, 0)).toBe("Up, fading");
    expect(trendState(0, 4, 0)).toBe("Turning up");
    expect(trendState(0, 0, 0)).toBe("No trend");
    expect(trendState(0, -4, 0)).toBe("Turning down");
    expect(trendState(-12, 4, 0)).toBe("Down, fading");
    expect(trendState(-12, 0, 0)).toBe("Down, steady");
    expect(trendState(-12, -4, 0)).toBe("Down, building");
    expect(trendState(5, 0, 0)).toBe("No trend");
    expect(trendState(-5, 0, 0)).toBe("No trend");
    expect(trendState(12, 2, 0)).toBe("Up, steady");
    expect(trendState(12, -2, 0)).toBe("Up, steady");
    expect(trendState(12, 0, 15)).toBe("Up, steady");
    expect(trendState(12, 0, 15.01)).toBe("Up, steady + breakout");
    expect(trendState(-12, -4, -15.01)).toBe("Down, building + breakdown");
    expect(trendState(null, 0, 0)).toBe("n/a");
    expect(trendState(12, null, 0)).toBe("warming");
  });

  it("counts how many rules point the same way as combined", () => {
    expect(agreementLabel(10, 4, 1, 5)).toBe("3/3");
    expect(agreementLabel(10, 4, -1, 5)).toBe("2/3");
    expect(agreementLabel(0, 4, 1, 5)).toBe("2/3");
    expect(agreementLabel(10, 4, 1, 0)).toBeNull();
    expect(agreementLabel(10, 4, 1, null)).toBeNull();
  });

  it("leaves the benchmark blank in relative mode and measures the other assets against it", () => {
    const spy = barsFrom(path(900, 0.0008, 0.002));
    const gold = barsFrom(path(900, 0.002, 0.003).map((p, i) => p * (1 + i / 900)));
    const flat = spy.map((b) => ({ ...b, close: b.close * 2, open: b.close * 2, high: b.close * 2, low: b.close * 2 }));
    const desk = buildDiagnostics({
      series: { SPY: spy, GLD: gold, IWM: flat },
      mode: "relative",
      focus: "GLD",
      minObs: 60,
    });
    const spyRow = desk.rows.find((r) => r.symbol === BENCHMARK_SYMBOL);
    const goldRow = desk.rows.find((r) => r.symbol === "GLD");
    const flatRow = desk.rows.find((r) => r.symbol === "IWM");
    expect(spyRow?.reason).toBe("benchmark");
    expect(spyRow?.state).toBe("n/a");
    expect(spyRow?.ewmac).toBeNull();
    expect(goldRow?.ewmac).not.toBeNull();
    expect(goldRow?.combined).toBeGreaterThan(0);
    expect(flatRow?.ewmac).toBeNull();
    expect(flatRow?.reason).toBe("warming");
    expect(desk.chart?.symbol).toBe("GLD");
    expect(desk.chart?.mode).toBe("relative");
    expect(desk.chart?.candles.length).toBeGreaterThan(10);
    expect(desk.chart?.candles.length).toBeLessThanOrEqual(320);
  });
});
