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
