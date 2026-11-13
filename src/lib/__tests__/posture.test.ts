import { describe, expect, it } from "vitest";
import { postureLabelFromScore } from "@/lib/posture";

describe("postureLabelFromScore", () => {
  it("matches the pipeline bands", () => {
    expect(postureLabelFromScore(80)).toBe("Bullish");
    expect(postureLabelFromScore(60)).toBe("Slight Bullish");
    expect(postureLabelFromScore(50)).toBe("Neutral");
    expect(postureLabelFromScore(25)).toBe("Slight Bearish");
    expect(postureLabelFromScore(10)).toBe("Bearish");
  });
});
