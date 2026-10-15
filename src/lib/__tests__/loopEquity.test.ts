import { describe, expect, it } from "vitest";
import { loopPortfolioEquity, loopRealizedPnlUsd } from "@/lib/loopEquity";

describe("loopEquity", () => {
  it("reflects realized P&L after a round trip", () => {
    const orders = [
      {
        ticker: "A",
        action: "BUY",
        shares: 100,
        limit_price: 100,
        created_at: "2026-09-01T00:00:00Z",
      },
      {
        ticker: "A",
        action: "SELL",
        shares: 100,
        limit_price: 110,
        created_at: "2026-10-01T00:00:00Z",
      },
    ];
    expect(loopRealizedPnlUsd(orders)).toBe(1000);
    const snap = loopPortfolioEquity(orders, []);
    expect(snap.mtmEquityUsd).toBe(101_000);
    expect(snap.cashUsd).toBe(101_000);
    expect(snap.totalPnlUsd).toBe(1000);
  });

  it("marks open book to last price", () => {
    const orders = [
      {
        ticker: "A",
        action: "BUY",
        shares: 193,
        limit_price: 171.98,
        created_at: "2026-09-28T00:00:00Z",
      },
    ];
    const snap = loopPortfolioEquity(orders, [{ shares: 193, entry: 171.98, last: 174 }]);
    expect(snap.deployedNotionalUsd).toBeCloseTo(193 * 174, 0);
    expect(snap.mtmEquityUsd).toBeCloseTo(100_000 + 193 * (174 - 171.98), 0);
  });
});
