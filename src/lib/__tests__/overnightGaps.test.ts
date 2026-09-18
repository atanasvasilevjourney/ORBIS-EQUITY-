import { describe, expect, it } from "vitest";
import { overnightFromQuotes, overnightFromSpark, rankOvernightUps } from "@/lib/overnightGaps";

describe("overnightFromSpark", () => {
  it("ranks an overnight gap-up vs previous close", () => {
    const rows = overnightFromSpark(
      [
        {
          symbol: "MRNA",
          response: [
            {
              meta: { symbol: "MRNA", chartPreviousClose: 145.62, regularMarketPrice: 159.18 },
              timestamp: [1, 2],
              indicators: {
                quote: [
                  {
                    open: [146, 158],
                    high: [147, 160],
                    low: [145, 157],
                    close: [146.5, 159.18],
                    volume: [1000, 2000],
                  },
                ],
              },
            },
          ],
        },
        {
          symbol: "FLAT",
          response: [
            {
              meta: { chartPreviousClose: 10, regularMarketPrice: 10 },
              timestamp: [1],
              indicators: { quote: [{ open: [10], high: [10], low: [10], close: [10], volume: [1] }] },
            },
          ],
        },
      ],
      { MRNA: "Moderna" }
    );
    expect(rows).toHaveLength(2);
    const ups = rankOvernightUps(rows);
    expect(ups[0].ticker).toBe("MRNA");
    expect(ups[0].companyName).toBe("Moderna");
    expect(ups[0].gapPct).toBeCloseTo(159.18 / 145.62 - 1, 6);
    expect(ups[0].orbEligible).toBe(true);
    expect(rankOvernightUps(rows, 0.04)).toHaveLength(1);
  });

  it("drops names without a previous close", () => {
    expect(
      overnightFromSpark([
        { symbol: "X", response: [{ meta: {}, indicators: { quote: [{ close: [1] }] } }] },
      ])
    ).toEqual([]);
  });
});

describe("overnightFromQuotes", () => {
  it("gaps LSE last vs the last closed session close", () => {
    const rows = overnightFromQuotes(
      [
        { symbol: "AAPL", last: 337, bid: 336.9, ask: 337.1, volume: 100, ts: "2026-09-18T12:45:00Z", source: "lse_ws" },
        { symbol: "FLAT", last: 10, ts: "2026-09-18T12:45:00Z" },
      ],
      { AAPL: 300, FLAT: 10 },
      { AAPL: "Apple" },
      { tape: "pre" }
    );
    expect(rows).toHaveLength(2);
    const ups = rankOvernightUps(rows);
    expect(ups[0].ticker).toBe("AAPL");
    expect(ups[0].companyName).toBe("Apple");
    expect(ups[0].gapPct).toBeCloseTo(337 / 300 - 1, 6);
    expect(ups[0].orbEligible).toBe(true);
    expect(ups[0].tape).toBe("pre");
    expect(ups[0].bid).toBeCloseTo(336.9);
    expect(rankOvernightUps(rows, 0.04)).toHaveLength(1);
  });

  it("drops prints without a prior close", () => {
    expect(overnightFromQuotes([{ symbol: "X", last: 10 }], {})).toEqual([]);
  });
});
