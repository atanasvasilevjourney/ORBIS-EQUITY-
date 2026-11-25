import { describe, expect, it } from "vitest";
import {
  impliedSharesFromSnapshot,
  refreshFundamentalQuotes,
  sanitizeMargins,
} from "@/lib/fundamentalsSanity";

describe("sanitizeMargins", () => {
  it("nulls operating margin when above gross", () => {
    const out = sanitizeMargins(0.73, 0.8, 0.5);
    expect(out.operatingMargin).toBeNull();
    expect(out.marginSanityOk).toBe(false);
    expect(out.grossMargin).toBe(0.73);
  });

  it("normalizes percent-form margins", () => {
    const out = sanitizeMargins(73, 45, 30);
    expect(out.grossMargin).toBeCloseTo(0.73, 4);
    expect(out.operatingMargin).toBeCloseTo(0.45, 4);
  });
});

describe("refreshFundamentalQuotes", () => {
  it("recomputes market cap from live price and implied shares", () => {
    const shares = impliedSharesFromSnapshot(802, 906_000_000_000);
    expect(shares).not.toBeNull();
    const refreshed = refreshFundamentalQuotes({
      snapshotPrice: 802,
      snapshotMarketCap: 906_000_000_000,
      livePrice: 629.79,
      quoteAsOf: "2026-11-24",
      quoteStale: false,
    });
    expect(refreshed.price).toBe(629.79);
    expect(refreshed.marketCapImpliedFromPrice).toBe(true);
    expect(refreshed.marketCap).toBeCloseTo(629.79 * (shares as number), -5);
  });
});