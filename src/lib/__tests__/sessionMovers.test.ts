import { describe, expect, it } from "vitest";
import { rankGainers, rankGappers, rankLiquid, rankLosers, sessionMovers } from "@/lib/sessionMovers";

describe("sessionMovers", () => {
  it("ranks a gainer from two daily prints", () => {
    const rows = sessionMovers(
      [{ symbol: "RXT", date: "2026-02-18", open: 0.42, high: 1.14, low: 0.42, close: 0.9956, volume: 32_000_000 }],
      [{ symbol: "RXT", date: "2026-02-17", open: 0.4, high: 0.45, low: 0.39, close: 0.42, volume: 1_000_000 }],
      { RXT: "Rackspace Technology" }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].companyName).toBe("Rackspace Technology");
    expect(rows[0].chgPct).toBeCloseTo(0.9956 / 0.42 - 1, 6);
    expect(rows[0].gapPct).toBeCloseTo(0, 6);
    expect(rankGainers(rows)[0].ticker).toBe("RXT");
  });

  it("flags a 4% open gap", () => {
    const rows = sessionMovers(
      [{ symbol: "AAA", date: "2026-01-02", open: 10.5, high: 11, low: 10.4, close: 10.6, volume: 100 }],
      [{ symbol: "AAA", date: "2026-01-01", open: 10, high: 10.2, low: 9.9, close: 10, volume: 100 }]
    );
    expect(rankGappers(rows, 0.04)).toHaveLength(1);
    expect(rankLosers(rows)).toEqual([]);
    expect(rankLiquid(rows)[0].dollarVol).toBeCloseTo(10.6 * 100, 6);
  });

  it("drops names without a prior close", () => {
    expect(
      sessionMovers(
        [{ symbol: "NEW", date: "2026-01-02", open: 1, high: 1, low: 1, close: 1 }],
        []
      )
    ).toEqual([]);
  });
});
