import { describe, expect, it } from "vitest";
import {
  buildDeskPostureBrief,
  computePostureLabel,
  computePostureScore,
  isPostureBriefStale,
  sectorLeaders,
} from "@/lib/postureDesk";

describe("postureDesk", () => {
  it("matches advancer share for posture score", () => {
    expect(computePostureScore(28.4)).toBe(28);
    expect(computePostureLabel(68)).toBe("Slight Bullish");
    expect(computePostureLabel(28)).toBe("Slight Bearish");
  });

  it("flags brief older than prices", () => {
    expect(isPostureBriefStale("2026-11-19", "2026-11-20")).toBe(true);
    expect(isPostureBriefStale("2026-11-20", "2026-11-20")).toBe(false);
    expect(isPostureBriefStale(null, "2026-11-20")).toBe(true);
  });

  it("derives sector leaders from live radar", () => {
    const radar = [
      { symbol: "A", state: 0, quality_rank: 50, z_mom: 2 },
      { symbol: "B", state: 0, quality_rank: 50, z_mom: -1 },
    ];
    const uni = [
      { symbol: "A", sector: "Tech" },
      { symbol: "B", sector: "Energy" },
    ];
    expect(sectorLeaders(radar, uni)).toEqual({
      bestSector: "Tech",
      worstSector: "Energy",
    });
  });

  it("builds desk brief from live fields", () => {
    const text = buildDeskPostureBrief("Slight Bearish", 28, 38, "Utilities");
    expect(text).toContain("28%");
    expect(text).toContain("Utilities");
  });
});