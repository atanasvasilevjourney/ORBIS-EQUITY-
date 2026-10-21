import { describe, expect, it } from "vitest";
import { combineCapital, legsFromBooks } from "@/lib/capitalBook";

describe("combineCapital", () => {
  it("nets shorts, sums gross, and lists names held in more than one sleeve", () => {
    const book = combineCapital([
      { sleeve: "LOOP", symbol: "AAPL", signedNotional: 12_000, asOf: "2026-10-16" },
      { sleeve: "CASH", symbol: "AAPL", signedNotional: -4_000, asOf: "2026-10-16" },
      { sleeve: "ORB", symbol: "NVDA", signedNotional: 5_000, asOf: "2026-10-17" },
      { sleeve: "ROTATE", symbol: "XOM", signedNotional: 0, asOf: "2026-10-16" },
    ]);
    expect(book.gross).toBe(21_000);
    expect(book.net).toBe(13_000);
    expect(book.overlap).toEqual(["AAPL"]);
    expect(book.sleeves.find((s) => s.sleeve === "CASH")?.net).toBe(-4_000);
    expect(book.sleeves.find((s) => s.sleeve === "ROTATE")?.names).toBe(0);
  });

  it("maps open books and skips flat or unpriced rows", () => {
    const legs = legsFromBooks({
      loopAsOf: "2026-10-16",
      loop: [
        { symbol: "AAPL", side: "LONG", shares: 10, last: 100 },
        { symbol: "MSFT", side: "LONG", shares: 5, last: null },
      ],
      orbAsOf: "2026-10-17",
      orb: [
        { symbol: "NVDA", status: "BREAKOUT", shares: 2, last: 50, entry: 48 },
        { symbol: "AMD", status: "NO_BREAK", shares: 8, last: 40, entry: 40 },
      ],
      cashAsOf: "2026-10-16",
      cash: [
        {
          symbol: "AAPL",
          inTema: true,
          temaSide: "SHORT",
          temaNotional: 300,
          inCarver: false,
          carverSide: "FLAT",
          carverNotional: 0,
        },
      ],
      rotateAsOf: "2026-10-15",
      rotate: [{ symbol: "XOM", side: "FLAT", notional: 1000 }],
    });
    const book = combineCapital(legs);
    expect(book.gross).toBe(10 * 100 + 2 * 50 + 300);
    expect(book.net).toBe(1000 + 100 - 300);
    expect(book.overlap).toEqual(["AAPL"]);
    expect(book.sleeves.find((s) => s.sleeve === "ORB")?.asOf).toBe("2026-10-17");
  });
});
