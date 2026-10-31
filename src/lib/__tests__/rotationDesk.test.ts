import { describe, expect, it } from "vitest";
import {
  barShare,
  holdingOrder,
  indexSpread,
  scoreboardName,
  sectorRank,
  sectorTag,
  sessionMove,
  spreadCall,
  spreadMeter,
} from "@/lib/rotationDesk";

describe("rotation desk layout", () => {
  it("measures a session from the last two closes", () => {
    const move = sessionMove([
      { date: "2026-10-29", close: 100 },
      { date: "2026-10-30", close: 96.41 },
    ]);
    expect(move.last).toBe(96.41);
    expect(move.asOf).toBe("2026-10-30");
    expect(move.dayPct).toBeCloseTo(-3.59, 2);
  });

  it("puts small-cap leadership on the right half of the meter", () => {
    const pp = indexSpread(-1.94, -3.59);
    expect(pp).toBeCloseTo(1.65, 2);
    expect(spreadCall(pp)).toBe("Small caps leading");
    const meter = spreadMeter(pp, 4);
    expect(meter.left).toBe(50);
    expect(meter.width).toBeCloseTo((1.65 / 4) * 50, 5);
  });

  it("maps sector names onto the SPDR tickers used in the rank rows", () => {
    expect(sectorTag("Energy")).toEqual({ tag: "XLE", label: "Energy" });
    expect(sectorTag("Information Technology").tag).toBe("XLK");
    expect(sectorTag("Health Care").tag).toBe("XLV");
    expect(sectorTag("Consumer Discretionary").tag).toBe("XLY");
    expect(sectorTag("Weird Sleeve").tag).toBe("WS");
  });

  it("ranks strongest relative strength first and scales bars to the tape", () => {
    const ranked = sectorRank([
      { name: "Energy", rs4w: 0.017 },
      { name: "Technology", rs4w: -0.0526 },
      { name: "Financials", rs4w: -0.0054 },
    ]);
    expect(ranked.map((row) => row.name)).toEqual(["Energy", "Financials", "Technology"]);
    const shares = ranked.map((row) => barShare((row.rs4w ?? 0) * 100, ranked.map((peer) => (peer.rs4w ?? 0) * 100)));
    expect(shares[2]).toBe(100);
    expect(shares[0]).toBeLessThan(shares[2]);
  });

  it("orders the holding strip by who is down the least", () => {
    const order = holdingOrder([
      { symbol: "AMZN", dayPct: -2.22 },
      { symbol: "META", dayPct: -0.44 },
      { symbol: "MSFT", dayPct: -1.7 },
    ]);
    expect(order.map((row) => row.symbol)).toEqual(["META", "MSFT", "AMZN"]);
    expect(scoreboardName("GOOGL", "  ")).toBe("Alphabet");
    expect(scoreboardName("GOOGL", "Alphabet Inc. - Class A Common Stock")).toBe("Alphabet");
    expect(scoreboardName("AMZN", "Amazon.com, Inc. - Common Stock")).toBe("Amazon.com");
    expect(scoreboardName("MSFT", "Microsoft Corporation - Common Stock")).toBe("Microsoft");
  });
});
