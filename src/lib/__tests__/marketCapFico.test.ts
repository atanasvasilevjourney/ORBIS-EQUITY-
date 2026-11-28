import { describe, expect, it } from "vitest";
import { formatMarketCap, resolveMarketCapUsd } from "@/lib/marketCap";

describe("FICO-scale market cap", () => {
  it("does not inflate vendor millions into trillions", () => {
    const r = resolveMarketCapUsd(16311000000, 1800);
    expect(r.usd).not.toBeNull();
    expect(r.usd!).toBeLessThan(5e12);
  });

  it("formats screener millions", () => {
    expect(formatMarketCap(16311)).toMatch(/\$16\.\dB/);
  });
});