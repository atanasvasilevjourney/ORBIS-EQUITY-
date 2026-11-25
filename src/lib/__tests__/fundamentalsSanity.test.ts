import { describe, expect, it } from "vitest";
import {
  impliedSharesFromSnapshot,
  refreshFundamentalQuotes,
  sanitizeMargins,
  sanitizePeRatio,
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
    const refreshed = refreshFundamentalQuotes({
      snapshotPrice: 802,
      snapshotMarketCap: 906_000_000_000,
      livePrice: 629.79,
      quoteAsOf: "2026-11-24",
      quoteStale: false,
    });
    expect(refreshed.price).toBe(629.79);
    expect(refreshed.priceVendorMismatch).toBe(true);
    expect(refreshed.marketCapImpliedFromPrice).toBe(true);
    const ratio = 629.79 / 802;
    const baseline = (impliedSharesFromSnapshot(802, 906_000_000_000) ?? 0) * 802;
    expect(refreshed.marketCap).toBeCloseTo(baseline * ratio, -6);
  });

  it("nulls absurd P/E", () => {
    expect(sanitizePeRatio(1240)).toBeNull();
    expect(sanitizePeRatio(18)).toBe(18);
  });
});