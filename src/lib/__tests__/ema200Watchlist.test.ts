import { describe, expect, it } from "vitest";
import { classifyEma200Setup } from "@/lib/ema200Watchlist";

describe("classifyEma200Setup", () => {
  it("accepts retrace held", () => {
    expect(
      classifyEma200Setup({
        symbol: "AMZN",
        close: 250,
        ema200: 248,
        dist_atr: 0.4,
        days_above: 22,
        ema200_slope: 0.002,
      })
    ).toBe("RETRACE_HELD");
  });

  it("accepts MA 2026-09-30 ribbon retrace (reference bar)", () => {
    expect(
      classifyEma200Setup({
        symbol: "MA",
        close: 550.64,
        ema200: 539.57,
        ema200_high: 544.57,
        dist_atr: 1.231,
        ribbon_dist_atr: 0.67,
        days_above: 58,
        ema200_slope: 0.011556,
      })
    ).toBe("RETRACE_HELD");
  });

  it("rejects MA 2026-09-29 extended above ribbon", () => {
    expect(
      classifyEma200Setup({
        symbol: "MA",
        close: 562.73,
        ema200: 539.46,
        dist_atr: 2.733,
        ribbon_dist_atr: 2.15,
        days_above: 57,
        ema200_slope: 0.01224,
      })
    ).toBeNull();
  });

  it("rejects far from EMA", () => {
    expect(
      classifyEma200Setup({
        symbol: "X",
        close: 100,
        ema200: 80,
        dist_atr: 2.5,
        days_above: 30,
        ema200_slope: 0.01,
      })
    ).toBeNull();
  });
});
