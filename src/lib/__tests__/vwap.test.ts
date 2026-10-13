import { describe, expect, it } from "vitest";
import {
  etSessionKey,
  etWeekAnchorKey,
  rangeAnchoredVwapSeries,
  sessionVwapSeries,
  weekAnchoredVwapSeries,
} from "@/lib/vwap";
import type { Candle } from "@/components/chart/TradingChart";

function bar(unixSec: number, close: number, vol: number): Candle {
  return { time: unixSec, open: close, high: close + 1, low: close - 1, close, volume: vol };
}

describe("vwap", () => {
  it("resets session VWAP on a new ET day", () => {
    // 2024-06-03 10:00 ET and 2024-06-04 10:00 ET (approx; DST-safe via formatter)
    const d1 = Math.floor(Date.parse("2024-06-03T14:00:00Z") / 1000);
    const d2 = Math.floor(Date.parse("2024-06-04T14:00:00Z") / 1000);
    const candles = [bar(d1, 100, 1000), bar(d1 + 300, 102, 1000), bar(d2, 90, 500)];
    const v = sessionVwapSeries(candles);
    expect(v[0]).toBeCloseTo(100, 4);
    expect(v[1]).toBeCloseTo(101, 4);
    expect(v[2]).toBeCloseTo(90, 4);
    expect(etSessionKey(d1)).not.toBe(etSessionKey(d2));
  });

  it("week AVWAP carries within the same ET week", () => {
    const tue = Math.floor(Date.parse("2024-06-04T14:00:00Z") / 1000);
    const wed = Math.floor(Date.parse("2024-06-05T14:00:00Z") / 1000);
    expect(etWeekAnchorKey(tue)).toBe(etWeekAnchorKey(wed));
    const candles = [bar(tue, 100, 100), bar(wed, 110, 100)];
    const w = weekAnchoredVwapSeries(candles);
    expect(w[1]).toBeCloseTo(105, 4);
  });

  it("range AVWAP does not reset across days", () => {
    const d1 = Math.floor(Date.parse("2024-06-03T14:00:00Z") / 1000);
    const d2 = Math.floor(Date.parse("2024-06-04T14:00:00Z") / 1000);
    const candles = [bar(d1, 100, 100), bar(d2, 120, 100)];
    const r = rangeAnchoredVwapSeries(candles);
    expect(r[1]).toBeCloseTo(110, 4);
  });
});
