import { describe, it, expect } from "vitest";
import { orbisScore } from "../orbisScore";

describe("orbisScore", () => {
  it("blends quality rank and composite", () => {
    expect(orbisScore(80, 60)).toBe(Math.round(0.6 * 80 + 0.4 * 60));
  });

  it("defaults missing leg to 50", () => {
    expect(orbisScore(100, null)).toBe(Math.round(0.6 * 100 + 0.4 * 50));
  });

  it("clamps to 1–99", () => {
    expect(orbisScore(0, 0)).toBe(1);
    expect(orbisScore(100, 100)).toBe(99);
  });
});
