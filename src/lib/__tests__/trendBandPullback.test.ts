import { describe, expect, it } from "vitest";
import { buildBandSeries, scanTrendBandFromCandles } from "@/lib/trendBandPullback";

function synthCandles(n: number) {
  const out: { time: string; high: number; low: number; close: number }[] = [];
  const closes: number[] = [];
  for (let i = 0; i < n; i++) {
    let close = 80 + i * 0.15 + Math.sin(i / 8) * 0.5;
    if (i >= n - 12) close -= 8.5 - ((i - (n - 12)) / 11) * 5.5;
    closes.push(close);
  }
  for (let i = 0; i < n; i++) {
    const close = closes[i];
    let high = close + 0.6 + (i === n - 14 ? 4 : 0);
    let low = close - 0.8;
    if (i >= n - 3) low -= 1.5;
    out.push({
      time: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
      high,
      low,
      close,
    });
  }
  return out;
}

describe("trendBandPullback", () => {
  it("builds band series with finite EMAs", () => {
    const closes = synthCandles(80).map((c) => c.close);
    const { emaFast, emaSlow } = buildBandSeries(closes);
    expect(emaFast[emaFast.length - 1]).not.toBeNull();
    expect(emaSlow[emaSlow.length - 1]).not.toBeNull();
  });

  it("detects pullback on synthetic uptrend", () => {
    const hit = scanTrendBandFromCandles(synthCandles(130));
    expect(hit).not.toBeNull();
    expect(hit!.score).toBeGreaterThan(0);
    expect(hit!.spark.length).toBeGreaterThan(10);
  });
});