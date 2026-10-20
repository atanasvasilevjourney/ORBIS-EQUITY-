import { describe, expect, it } from "vitest";
import {
  detectTriangleFromOhlc,
  triangleGeometryToChart,
  type TriangleGeometry,
} from "@/lib/trianglePattern";

function craftedAscendingBars(n = 65) {
  const high = Array(n).fill(55);
  const low = Array(n).fill(50);
  const close = Array(n).fill(52);
  for (const peakI of [15, 27, 39, 51]) {
    for (const d of [-1, 0, 1]) high[peakI + d] = 100;
  }
  [10, 22, 34, 46].forEach((li, j) => {
    const val = 80 + j * 2;
    for (const d of [-2, -1, 0, 1, 2]) low[li + d] = val + Math.abs(d) * 1.5;
    close[li] = val + 0.5;
  });
  close[n - 1] = 101.5;
  high[n - 1] = 102;
  low[n - 1] = 94;
  return Array.from({ length: n }, (_, i) => ({
    time: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
    high: high[i],
    low: low[i],
    close: close[i],
  }));
}

const CFG = {
  lookbackBars: 60,
  swingOrder: 2,
  minSwingPoints: 2,
  flatTolerancePct: 3,
  minSlopePctPerBar: 0.01,
  maxSlopePctPerBar: 10,
  breakoutBufferPct: 0.05,
};

describe("trianglePattern", () => {
  it("detects ascending pattern on crafted bars", () => {
    const hit = detectTriangleFromOhlc(craftedAscendingBars(), "ascending", CFG);
    expect(hit).not.toBeNull();
    if (hit) expect(["forming", "breakout_up"]).toContain(hit.status);
  });

  it("renders geometry segments", () => {
    const geom: TriangleGeometry = {
      support: { from: "2024-01-01", to: "2024-03-01", price: 90, price_start: 88, price_end: 92 },
      resistance: {
        from: { time: "2024-01-01", price: 100 },
        to: { time: "2024-03-01", price: 100 },
      },
    };
    const { segments } = triangleGeometryToChart(geom, "ascending");
    expect(segments).toHaveLength(2);
  });
});
