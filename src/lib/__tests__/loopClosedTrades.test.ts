import { describe, expect, it } from "vitest";
import { closedTradesFromOrders } from "@/lib/loopClosedTrades";

describe("closedTradesFromOrders", () => {
  it("matches FIFO lots on partial exit", () => {
    const trades = closedTradesFromOrders([
      {
        id: "e1",
        ticker: "AAPL",
        action: "BUY",
        shares: 10,
        limitPrice: 100,
        reason: "enter",
        sector: "Tech",
        createdAt: "2026-01-02T00:00:00Z",
      },
      {
        id: "x1",
        ticker: "AAPL",
        action: "SELL",
        shares: 10,
        limitPrice: 110,
        reason: "trail",
        sector: "Tech",
        createdAt: "2026-01-10T00:00:00Z",
      },
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0].pnlUsd).toBe(100);
    expect(trades[0].returnPct).toBeCloseTo(10, 5);
    expect(trades[0].exitOrderId).toBe("x1");
  });
});
