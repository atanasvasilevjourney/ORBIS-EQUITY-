import { describe, expect, it } from "vitest";
import {
  APPROACHING_MAX_ATR,
  daysSinceRibbonTouch,
  isApproachingPullback,
  ribbonDistPct,
  ribbonDistUsd,
} from "@/lib/ema200Distance";
import { classifyEma200Setup } from "@/lib/ema200Watchlist";

describe("ema200Distance", () => {
  it("computes USD distance above ribbon", () => {
    expect(ribbonDistUsd(550.64, 539.57, 544.57)).toBeCloseTo(6.07, 1);
    expect(ribbonDistUsd(542, 539.57, 544.57)).toBe(0);
  });

  it("tracks days since last ribbon touch", () => {
    const hist = [
      { bar_date: "2026-09-28", ribbon_dist_atr: 2.7, dist_atr: 3.3 },
      { bar_date: "2026-09-29", ribbon_dist_atr: 2.1, dist_atr: 2.7 },
      { bar_date: "2026-09-30", ribbon_dist_atr: 0.67, dist_atr: 1.23 },
      { bar_date: "2026-10-01", ribbon_dist_atr: 0.5, dist_atr: 1.0 },
      { bar_date: "2026-10-02", ribbon_dist_atr: 2.0, dist_atr: 2.5 },
    ];
    expect(daysSinceRibbonTouch(hist, "2026-10-02")).toBe(1);
    expect(daysSinceRibbonTouch(hist, "2026-10-01")).toBe(0);
    expect(daysSinceRibbonTouch(hist, "2026-09-30")).toBe(0);
  });

  it("flags approaching names between 1.5 and max ATR", () => {
    const row = {
      symbol: "MA",
      close: 562,
      ema200: 539,
      dist_atr: 2.5,
      ribbon_dist_atr: 2.1,
      days_above: 40,
      ema200_slope: 0.01,
    };
    const setup = classifyEma200Setup(row);
    expect(setup).toBeNull();
    expect(isApproachingPullback(row, setup)).toBe(true);
    expect(ribbonDistPct(562, 539, 544)).toBeGreaterThan(0);
    expect(APPROACHING_MAX_ATR).toBe(3);
  });
});
