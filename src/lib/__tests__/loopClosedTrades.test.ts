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

  it("debits both legs of cost and prefers the fill over the signal limit", () => {
    const trades = closedTradesFromOrders([
      {
        id: "e1",
        ticker: "MSFT",
        action: "BUY",
        shares: 10,
        limitPrice: 100,
        fillPrice: 101,
        costUsd: 5,
        reason: "enter",
        sector: "Tech",
        createdAt: "2026-02-01T00:00:00Z",
      },
      {
        id: "x1",
        ticker: "MSFT",
        action: "SELL",
        shares: 4,
        limitPrice: 110,
        fillPrice: 109,
        costUsd: 4,
        reason: "trail",
        sector: "Tech",
        createdAt: "2026-02-10T00:00:00Z",
      },
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0].entry).toBe(101);
    expect(trades[0].exit).toBe(109);
    expect(trades[0].pnlUsd).toBe(26);
  });
});
