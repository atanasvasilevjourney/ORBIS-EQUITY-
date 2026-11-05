import { describe, expect, it } from "vitest";
import { emaPineSeries, projectSwing, swingEmaOverlaysFromOhlc } from "@/lib/chartEma";

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

  it("warms EMA200 on bars before the visible window", () => {
    // A long base, then a step up. Seeding on only the step window forgets the base.
    const base = Array.from({ length: 1500 }, () => ({ close: 20, high: 21 }));
    const step = Array.from({ length: 220 }, () => ({ close: 200, high: 201 }));
    const view = projectSwing([...base, ...step], 220);
    expect(view.candles).toHaveLength(220);
    const short = swingEmaOverlaysFromOhlc(
      view.candles.map((c) => c.close),
      view.candles.map((c) => c.high)
    );
    const warmed = view.swing.ema200[219] as number;
    const reseeded = short.ema200[219] as number;
    expect(reseeded - warmed).toBeGreaterThan(10);
  });
});
