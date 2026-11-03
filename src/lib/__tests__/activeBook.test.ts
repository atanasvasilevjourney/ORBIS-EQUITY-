import { describe, expect, it } from "vitest";
import { legsFromBooks } from "@/lib/capitalBook";
import { buildActiveBook } from "@/lib/portfolio/activeBook";

describe("buildActiveBook", () => {
  const legs = legsFromBooks({
    loopAsOf: "2026-10-16",
    loop: [
      { symbol: "AAPL", side: "LONG", shares: 10, last: 100, unrealizedPnlUsd: 40, daysHeld: 6 },
      { symbol: "MSFT", side: "SHORT", shares: 4, last: 50, unrealizedPnlUsd: -10, daysHeld: 2 },
    ],
    orbAsOf: "2026-10-17",
    orb: [
      { symbol: "NVDA", status: "BREAKOUT", shares: 2, last: 50, entry: 40 },
      { symbol: "AMD", status: "WATCH", shares: 8, last: 40, entry: 40 },
    ],
    cashAsOf: "2026-10-16",
    cash: [
      {
        symbol: "AAPL",
        inTema: true,
        temaSide: "SELL",
        temaNotional: 300,
        inCarver: true,
        carverSide: "BUY",
        carverNotional: 200,
      },
    ],
    rotateAsOf: "2026-10-15",
    rotate: [
      { symbol: "XOM", side: "LONG", notional: 500 },
      { symbol: "ZZZZ", side: "SHORT", notional: 250 },
    ],
  });

  const book = buildActiveBook(legs);

  it("turns open desk legs into gross weights that sum to 100", () => {
    const gross = 10 * 100 + 4 * 50 + 2 * 50 + 300 + 200 + 500 + 250;
    expect(book.gross).toBe(gross);
    expect(book.net).toBe(1000 - 200 + 100 - 300 + 200 + 500 - 250);
    expect(book.lines.reduce((sum, line) => sum + line.weight, 0)).toBeCloseTo(100, 8);
    expect(book.sleeves.reduce((sum, sleeve) => sum + sleeve.weight, 0)).toBeCloseTo(100, 8);
    expect(book.lines.find((line) => line.symbol === "AMD")).toBeUndefined();
  });

  it("keeps cash TEMA and Carver as separate lines and flags overlap", () => {
    const aapl = book.lines.filter((line) => line.symbol === "AAPL");
    expect(aapl.map((line) => line.book).sort()).toEqual(["carver", "loop", "tema"]);
    expect(aapl.find((line) => line.book === "tema")?.side).toBe("SHORT");
    expect(book.lines.find((line) => line.book === "carver")?.side).toBe("LONG");
    expect(book.overlap).toEqual(["AAPL"]);
    expect(book.names.find((name) => name.symbol === "AAPL")?.sleeves).toEqual(["LOOP", "CASH"]);
  });

  it("prices a 1Y studio path only for names inside the long-term universe", () => {
    expect(book.lines.find((line) => line.symbol === "ZZZZ")?.inStudio).toBe(false);
    expect(book.lines.find((line) => line.symbol === "AAPL")?.inStudio).toBe(true);
    expect(book.risk).not.toBeNull();
    expect(book.risk?.window).toBe("1Y");
    expect(book.risk?.outside).toEqual(["ZZZZ"]);
    expect(book.risk?.coveredWeight).toBeCloseTo((book.gross - 250) / book.gross, 8);
    expect(book.risk?.vol).toBeGreaterThan(0);
    expect(book.risk?.maxDd).toBeLessThan(0);
    expect(Number.isFinite(book.risk?.cagr)).toBe(true);
    expect(book.pnl).toBe(40 - 10 + (50 - 40) * 2);
    expect(book.lines.find((line) => line.symbol === "AAPL" && line.book === "loop")?.daysHeld).toBe(6);
  });

  it("returns an empty book when every desk is flat", () => {
    const empty = buildActiveBook([]);
    expect(empty.gross).toBe(0);
    expect(empty.net).toBe(0);
    expect(empty.lines).toEqual([]);
    expect(empty.risk).toBeNull();
    expect(empty.pnl).toBeNull();
    expect(empty.sleeves.every((sleeve) => sleeve.weight === 0)).toBe(true);
  });
});
