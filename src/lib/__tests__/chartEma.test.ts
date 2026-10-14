import { describe, expect, it } from "vitest";
import { emaPineSeries, swingEmaOverlaysFromOhlc } from "@/lib/chartEma";

describe("chartEma", () => {
  it("seeds EMA with SMA over first period", () => {
    const vals = Array.from({ length: 10 }, (_, i) => i + 1);
    const e = emaPineSeries(vals, 3);
    expect(e[0]).toBeNull();
    expect(e[1]).toBeNull();
    expect(e[2]).toBe(2);
  });

  it("returns aligned overlay arrays", () => {
    const closes = Array.from({ length: 250 }, (_, i) => 100 + i * 0.1);
    const highs = closes.map((c) => c + 1);
    const o = swingEmaOverlaysFromOhlc(closes, highs);
    expect(o.ema200.length).toBe(250);
    expect(o.ema200High.length).toBe(250);
    expect(o.ema200[249]).not.toBeNull();
    expect(o.ema200High![249]!).toBeGreaterThan(o.ema200[249]!);
  });
});
