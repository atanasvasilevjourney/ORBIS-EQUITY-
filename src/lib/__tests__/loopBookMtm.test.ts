import { describe, expect, it } from "vitest";
import { enrichLoopBookWithPrices, latestCloseBySymbol, tradingStaleDays } from "@/lib/loopBookMtm";

describe("loopBookMtm", () => {
  it("picks the newest bar per symbol", () => {
    const map = latestCloseBySymbol([
      { symbol: "AAPL", date: "2026-10-01", close: 100 },
      { symbol: "AAPL", date: "2026-10-10", close: 110 },
    ]);
    expect(map.get("AAPL")).toEqual({ close: 110, date: "2026-10-10" });
  });

  it("marks book to market and recomputes P&L", () => {
    const { rows } = enrichLoopBookWithPrices(
      [
        {
          ticker: "CRWD",
          shares: 100,
          entry: 248.08,
          last: 248.08,
          openedAt: "2026-09-28",
          unrealizedPnlUsd: 0,
          daysHeld: 0,
        },
      ],
      [{ symbol: "CRWD", date: "2026-10-10", close: 260 }],
      "2026-10-12"
    );
    expect(rows[0].last).toBe(260);
    expect(rows[0].unrealizedPnlUsd).toBeCloseTo(1192, 0);
    expect(rows[0].daysHeld).toBe(12);
    expect(rows[0].priceAsOfDate).toBe("2026-10-10");
  });

  it("computes stale calendar gap", () => {
    expect(tradingStaleDays("2026-10-10", "2026-10-12")).toBe(2);
  });
});
