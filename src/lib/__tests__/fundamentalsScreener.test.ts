import { describe, it, expect } from "vitest";
import {
  parseScreenerQuery,
  matchesScreener,
  mergePreset,
  inRange,
} from "../fundamentalsScreener";

describe("fundamentalsScreener", () => {
  it("parses range query params", () => {
    const q = parseScreenerQuery(
      new URLSearchParams("min_composite_factor_score=60&max_pe_ratio=20&preset=custom")
    );
    expect("error" in q).toBe(false);
    if ("error" in q) return;
    expect(q.ranges.composite_factor_score?.min).toBe(60);
    expect(q.ranges.pe_ratio?.max).toBe(20);
  });

  it("merges conviction preset with watchlist and composite floor", () => {
    const base = parseScreenerQuery(new URLSearchParams("preset=conviction"));
    expect("error" in base).toBe(false);
    if ("error" in base) return;
    expect(base.watchlistOnly).toBe(true);
    expect(base.minRank).toBe(50);
    expect(base.ranges.composite_factor_score?.min).toBe(60);
  });

  it("matches range and watchlist filters", () => {
    const q = mergePreset(
      {
        preset: "custom",
        watchlistOnly: true,
        minRank: 40,
        ranges: { pe_ratio: { max: 20 } },
        sort: "composite_factor_score",
        sortAsc: false,
        limit: 100,
      },
      "conviction"
    );
    const row = { pe_ratio: 15, composite_factor_score: 70, fundamental_verdict: "STRONG" };
    const meta = { sector: "Technology", industry: null, country: "US" };
    const radar = { state: 1, quality_rank: 55 };
    expect(matchesScreener(row, meta, radar, q)).toBe(true);
    expect(matchesScreener(row, meta, { state: 0, quality_rank: 55 }, q)).toBe(false);
    expect(matchesScreener({ ...row, pe_ratio: 25 }, meta, radar, q)).toBe(false);
  });

  it("inRange handles open bounds", () => {
    expect(inRange(10, { min: 5 })).toBe(true);
    expect(inRange(3, { min: 5 })).toBe(false);
    expect(inRange(null, { min: 1 })).toBe(false);
  });
});
