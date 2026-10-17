import { createHash } from "crypto";

export type LoopOrder = {
  id: string;
  ticker: string;
  action: string;
  shares: number;
  limitPrice: number | null;
  reason: string | null;
  sector: string | null;
  createdAt: string | null;
};

export type ClosedLoopTrade = {
  id: string;
  ticker: string;
  shares: number;
  entry: number;
  exit: number;
  pnlUsd: number;
  returnPct: number;
  entryReason: string | null;
  exitReason: string | null;
  enteredAt: string | null;
  exitedAt: string | null;
  sector: string | null;
  exitOrderId: string | null;
};

function parseExitPrice(order: LoopOrder): number | null {
  if (order.limitPrice != null) return order.limitPrice;
  const reason = order.reason ?? "";
  const m = /last\s+([\d.]+)/i.exec(reason);
  return m ? Number(m[1]) : null;
}

function journalId(row: {
  exitOrderId: string | null;
  ticker: string;
  enteredAt: string | null;
  shares: number;
  entry: number;
}): string {
  const key = `${row.exitOrderId}|${row.ticker}|${row.enteredAt}|${row.shares}|${row.entry}`;
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 24);
  return `loop-${digest}`;
}

/** FIFO match of BUY lots to SELL fills — mirrors pipeline.research.loop_log_report.closed_trades */
export function closedTradesFromOrders(orders: LoopOrder[]): ClosedLoopTrade[] {
  const sorted = [...orders].sort((a, b) =>
    String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))
  );
  const lots: Record<string, Array<{ shares: number; entry: number; entryReason: string | null; enteredAt: string | null }>> = {};
  const closed: ClosedLoopTrade[] = [];

  for (const o of sorted) {
    const ticker = o.ticker;
    const shares = o.shares;
    if (o.action === "BUY") {
      if (o.limitPrice == null) continue;
      if (!lots[ticker]) lots[ticker] = [];
      lots[ticker].push({
        shares,
        entry: o.limitPrice,
        entryReason: o.reason,
        enteredAt: o.createdAt,
      });
      continue;
    }
    const exitPx = parseExitPrice(o);
    if (exitPx == null) continue;
    let remaining = shares;
    const queue = lots[ticker] ?? [];
    while (remaining > 0 && queue.length > 0) {
      const lot = queue[0];
      const take = Math.min(remaining, lot.shares);
      const pnl = (exitPx - lot.entry) * take;
      const row = {
        exitOrderId: o.id,
        ticker,
        enteredAt: lot.enteredAt,
        shares: take,
        entry: lot.entry,
      };
      closed.push({
        id: journalId(row),
        ticker,
        shares: take,
        entry: lot.entry,
        exit: exitPx,
        pnlUsd: pnl,
        returnPct: (exitPx / lot.entry - 1) * 100,
        entryReason: lot.entryReason,
        exitReason: o.reason,
        enteredAt: lot.enteredAt,
        exitedAt: o.createdAt,
        sector: o.sector,
        exitOrderId: o.id,
      });
      lot.shares -= take;
      remaining -= take;
      if (lot.shares === 0) queue.shift();
    }
    lots[ticker] = queue;
  }

  return closed.sort((a, b) => String(b.exitedAt ?? "").localeCompare(String(a.exitedAt ?? "")));
}
