import { describe, expect, it } from "vitest";
import { deskEma200Href, parseBulkFocusSymbols, splitDeskChipPreview } from "@/lib/focusUniverse";

describe("splitDeskChipPreview", () => {
  it("shows first five and counts the rest", () => {
    const syms = ["A", "B", "C", "D", "E", "F", "G"];
    expect(splitDeskChipPreview(syms)).toEqual({
      visible: ["A", "B", "C", "D", "E"],
      hiddenCount: 2,
    });
  });

  it("returns zero hidden when list fits", () => {
    expect(splitDeskChipPreview(["NBIS", "AAPL"])).toEqual({
      visible: ["NBIS", "AAPL"],
      hiddenCount: 0,
    });
  });
});

describe("parseBulkFocusSymbols", () => {
  it("parses mixed separators and caps at limit", () => {
    const raw = "aapl\nMSFT, GOOG ; $NBIS";
    expect(parseBulkFocusSymbols(raw)).toEqual(["AAPL", "MSFT", "GOOG", "NBIS"]);
  });
});

describe("deskEma200Href", () => {
  it("builds desk scan deep link", () => {
    expect(deskEma200Href(["NBIS", "AAPL"])).toBe("/ema200?symbols=NBIS%2CAAPL&desk=1");
  });

  it("returns plain path when empty", () => {
    expect(deskEma200Href([])).toBe("/ema200");
  });
});
