import { describe, expect, it } from "vitest";
import { overnightFromSpark, rankOvernightUps } from "@/lib/overnightGaps";

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
