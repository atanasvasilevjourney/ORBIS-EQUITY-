import { describe, it, expect } from "vitest";
import {
  avgFinite,
  breadthAtLeast,
  buildSectorFactorRows,
  buildStyleSummaries,
  styleScreenerHref,
  FACTOR_STYLES,
} from "../factorInvesting";

describe("factorInvesting", () => {
  it("averages finite values and ignores nulls", () => {
    expect(avgFinite([80, null, 60])).toBe(70);
    expect(avgFinite([null])).toBeNull();
  });

  it("computes breadth at floor", () => {
    expect(breadthAtLeast([80, 40, 55], 50)).toBeCloseTo(2 / 3);
    expect(breadthAtLeast([], 50)).toBeNull();
  });

  it("builds style summaries with leaders sorted by score", () => {
    const rows = [
      {
        symbol: "AAA",
        companyName: "A Co",
        sector: "Tech",
        valueScore: 90,
        qualityScore: 50,
        growthScore: 40,
        earningsQualityScore: 60,
        leverageScore: 55,
        compositeScore: 70,
      },
      {
        symbol: "BBB",
        companyName: "B Co",
        sector: "Tech",
        valueScore: 70,
        qualityScore: 85,
        growthScore: 80,
        earningsQualityScore: null,
        leverageScore: null,
        compositeScore: 75,
      },
    ];
    const styles = buildStyleSummaries(rows, 5);
    const value = styles.find((s) => s.id === "value");
    expect(value?.leaders[0].symbol).toBe("AAA");
    expect(value?.avgScore).toBe(80);
    expect(styles).toHaveLength(FACTOR_STYLES.length);
  });

  it("builds sector rows with minimum peer count", () => {
    const tiny = buildSectorFactorRows([
      {
        symbol: "X",
        sector: "Solo",
        valueScore: 50,
        qualityScore: 50,
        growthScore: 50,
        earningsQualityScore: 50,
        leverageScore: 50,
        compositeScore: 50,
      },
    ]);
    expect(tiny).toHaveLength(0);

    const rows = ["A", "B", "C"].map((sym, i) => ({
      symbol: sym,
      sector: "Tech",
      valueScore: 60 + i,
      qualityScore: 55,
      growthScore: 50,
      earningsQualityScore: 50,
      leverageScore: 50,
      compositeScore: 65 + i,
    }));
    const sectors = buildSectorFactorRows(rows);
    expect(sectors).toHaveLength(1);
    expect(sectors[0].nNames).toBe(3);
  });

  it("links screener with style sort and min filter", () => {
    const href = styleScreenerHref(FACTOR_STYLES[0], 72);
    expect(href).toContain("sort=value_score");
    expect(href).toContain("min_value_score=72");
  });
});
