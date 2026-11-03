import { describe, expect, it } from "vitest";
import { barsToPoints, mergePricePoints, symbolsBehind, symbolsMissingFromTape } from "@/lib/marketTapeFill";

describe("market tape fill", () => {
  it("asks only for symbols the desk tape does not already hold", () => {
    const missing = symbolsMissingFromTape(
      [{ symbol: "SPY", date: "2026-10-30", close: 500 }],
      ["SPY", "QQQ", "IWM", "QQQ"]
    );
    expect(missing).toEqual(["QQQ", "IWM"]);
  });

  it("keeps the desk close when a fill repeats the same session", () => {
    const merged = mergePricePoints(
      [{ symbol: "SPY", date: "2026-10-30", close: 500 }],
      [
        { symbol: "SPY", date: "2026-10-30", close: 1 },
        { symbol: "QQQ", date: "2026-10-30", close: 400 },
      ]
    );
    expect(merged).toEqual([
      { symbol: "SPY", date: "2026-10-30", close: 500 },
      { symbol: "QQQ", date: "2026-10-30", close: 400 },
    ]);
  });

  it("refreshes a name whose last desk bar is behind the session", () => {
    expect(
      symbolsBehind(
        [
          { symbol: "AMZN", date: "2026-10-14", close: 250 },
          { symbol: "SPY", date: "2026-11-02", close: 752 },
        ],
        ["AMZN", "SPY", "QQQ"],
        "2026-11-02"
      )
    ).toEqual(["AMZN", "QQQ"]);
  });

  it("drops bars that have no close", () => {
    expect(
      barsToPoints("IWM", [
        { date: "2026-10-29", open: 1, high: 1, low: 1, close: Number.NaN, volume: 0 },
        { date: "2026-10-30", open: 1, high: 1, low: 1, close: 210.5, volume: 1 },
      ])
    ).toEqual([{ symbol: "IWM", date: "2026-10-30", close: 210.5 }]);
  });
});
