import { describe, expect, it } from "vitest";
import { resolveMarketCapUsd } from "@/lib/marketCap";

describe("resolveMarketCapUsd", () => {
  it("prefers millions-scale vendor cap for large-cap price", () => {
    const r = resolveMarketCapUsd(285_000, 227.38);
    expect(r.unit).toBe("millions");
    expect(r.usd).toBeCloseTo(285_000 * 1_000_000, -6);
    expect(r.sharesImplied).toBeGreaterThan(1e8);
    expect(r.sharesImplied).toBeLessThan(2e10);
  });

  it("scales cap when tape price diverges from snapshot", () => {
    const snap = resolveMarketCapUsd(50_000, 53.62);
    const ratio = 227.38 / 53.62;
    const scaled = (snap.usd ?? 0) * ratio;
    expect(scaled / 227.38).toBeCloseTo(snap.sharesImplied ?? 0, 1);
  });
});