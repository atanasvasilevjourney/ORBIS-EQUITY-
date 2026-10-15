import { describe, expect, it } from "vitest";
import { filterSymbolsForIndexDesk } from "@/lib/universeDesk";

const members = [
  { symbol: "AAPL", tier: "us_large", exchange: "NASDAQ", country: "US" },
  { symbol: "JPM", tier: "us_large", exchange: "NYSE", country: "US" },
  { symbol: "DDOG", tier: "us_nasdaq100", exchange: "NASDAQ", country: "US" },
  { symbol: "TINY", tier: "us_micro", exchange: "NASDAQ", country: "US" },
];

const caps = [
  { symbol: "AAPL", market_cap: 3_000_000_000_000 },
  { symbol: "JPM", market_cap: 500_000_000_000 },
  { symbol: "DDOG", market_cap: 50_000_000_000 },
];

describe("filterSymbolsForIndexDesk", () => {
  it("returns merged sp500 + ndx tiers", () => {
    const syms = filterSymbolsForIndexDesk("sp500_ndx100", members);
    expect(syms.sort()).toEqual(["AAPL", "DDOG", "JPM"].sort());
  });

  it("returns sp500 only", () => {
    expect(filterSymbolsForIndexDesk("sp500", members).sort()).toEqual(["AAPL", "JPM"]);
  });

  it("returns nasdaq-100 style set", () => {
    const syms = filterSymbolsForIndexDesk("ndx100", members);
    expect(syms).toContain("DDOG");
    expect(syms).toContain("AAPL");
    expect(syms).not.toContain("JPM");
  });

  it("returns top 100 sp500 by market cap", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      symbol: `S${i}`,
      tier: "us_large",
      exchange: "NYSE",
      country: "US",
    }));
    const manyCaps = many.map((m, i) => ({ symbol: m.symbol, market_cap: i * 1000 }));
    const top = filterSymbolsForIndexDesk("sp500_top100", many, manyCaps);
    expect(top).toHaveLength(100);
    expect(top[0]).toBe("S119");
  });

  it("includes nasdaq exchange names for nasdaq_all", () => {
    const syms = filterSymbolsForIndexDesk("nasdaq_all", members);
    expect(syms).toContain("TINY");
    expect(syms).not.toContain("JPM");
  });

  it("includes us_nasdaq_listed tier for nasdaq_all", () => {
    const listed = [
      ...members,
      { symbol: "NBIS", tier: "us_nasdaq_listed", exchange: "NASDAQ", country: "US" },
    ];
    expect(filterSymbolsForIndexDesk("nasdaq_all", listed)).toContain("NBIS");
  });
});
