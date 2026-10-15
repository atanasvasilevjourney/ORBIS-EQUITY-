import { describe, expect, it } from "vitest";
import { parseSymbolsQueryParam } from "@/lib/symbolsQuery";

describe("parseSymbolsQueryParam", () => {
  it("parses comma list and caps length", () => {
    const raw = "nbis, aapl, NBIS, ,INVALID!,MSFT";
    expect(parseSymbolsQueryParam(raw)).toEqual(["NBIS", "AAPL", "MSFT"]);
  });

  it("returns empty for null", () => {
    expect(parseSymbolsQueryParam(null)).toEqual([]);
  });
});
