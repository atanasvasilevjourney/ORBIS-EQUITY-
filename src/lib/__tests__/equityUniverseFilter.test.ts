import { describe, expect, it } from "vitest";
import { isResearchDeskEligible, isStructuredProductSymbol } from "@/lib/equityUniverseFilter";

describe("equityUniverseFilter", () => {
  it("drops structured units and SPAC shells", () => {
    expect(isStructuredProductSymbol("ABCDU")).toBe(true);
    expect(
      isResearchDeskEligible({
        symbol: "REAL",
        tier: "us_large",
        company_name: "Blank Check Acquisition Corp",
        is_active: true,
      })
    ).toBe(false);
    expect(
      isResearchDeskEligible({
        symbol: "AAPL",
        tier: "us_large",
        company_name: "Apple Inc.",
        is_active: true,
      })
    ).toBe(true);
  });
});