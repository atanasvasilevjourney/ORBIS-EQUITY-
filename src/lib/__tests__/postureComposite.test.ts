import { describe, expect, it } from "vitest";
import { compositeLabel, compositeScoreFromPillars, resolveStoredPosture } from "@/lib/postureComposite";

describe("postureComposite", () => {
  it("maps labels with updated thresholds", () => {
    expect(compositeLabel(70)).toBe("Bullish");
    expect(compositeLabel(68)).toBe("Slight Bullish");
    expect(compositeLabel(72, true)).toBe("Neutral");
  });

  it("weights pillars into a score", () => {
    const score = compositeScoreFromPillars({
      breadth: 80,
      trend: 60,
      index_trend: 70,
      highs_lows: 50,
      risk: 40,
    });
    expect(score).toBeGreaterThan(50);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("reads stored composite from daily_brief inputs", () => {
    const resolved = resolveStoredPosture({
      posture_score: 62,
      posture_label: "Slight Bullish",
      posture_pillars: { breadth: 60, trend: 55 },
      posture_composite: { risk_off: false },
    });
    expect(resolved.score).toBe(62);
    expect(resolved.label).toBe("Slight Bullish");
  });
});