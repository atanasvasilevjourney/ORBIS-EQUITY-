import { describe, expect, it } from "vitest";
import { formatMarketCap } from "@/lib/marketCap";

describe("formatMarketCap", () => {
  it("treats screener values in millions", () => {
    expect(formatMarketCap(47108)).toBe("$47.1B");
  });

  it("formats billions passed through", () => {
    expect(formatMarketCap(2.8e12)).toBe("$2.80T");
  });
});