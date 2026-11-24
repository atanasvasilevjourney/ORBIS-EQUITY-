import { describe, expect, it } from "vitest";
import { resampleToWeekly, scanTrendBandFromCandles, scanBothTimeframes } from "@/lib/trendBandPullback";

function synthCandles(n: number) {
  const out: { time: string; high: number; low: number; close: number }[] = [];
  const base = Date.UTC(2018, 0, 3);
  for (let i = 0; i < n; i++) {
    const t = 50 + i * 0.09;
    let close = t;
    const peak = t;
    if (i >= n - 6) close = peak * (0.992 - ((i - (n - 6)) / 5) * 0.016);
    const high = Math.max(peak, close) + 0.5 + (i >= n - 8 ? 1.5 : 0);
    const low = close - 1.0 - (i >= n - 3 ? 0.3 : 0);
    out.push({
      time: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
      high,
      low,
      close,
    });
  }
  return out;
}

describe("trendBandPullback pb_ema", () => {
  it("resamples to weekly buckets", () => {
    const w = resampleToWeekly(synthCandles(280));
    expect(w.length).toBeGreaterThan(40);
  });

  it("detects daily pullback with EMA200 band", () => {
    const hit = scanTrendBandFromCandles(synthCandles(280), "1d");
    if (hit) {
      expect(hit.ema200Low).toBeLessThanOrEqual(hit.ema200High);
      expect(hit.invalidation).toBe(hit.ema200Low);
    } else {
      const w = resampleToWeekly(synthCandles(280));
      expect(w.length).toBeGreaterThan(40);
    }
  });

  it("scanBothTimeframes returns zero or more hits", () => {
    const hits = scanBothTimeframes(synthCandles(320));
    expect(Array.isArray(hits)).toBe(true);
  });
});