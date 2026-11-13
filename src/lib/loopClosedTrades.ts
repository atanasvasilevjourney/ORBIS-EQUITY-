import { createHash } from "crypto";

export type LoopOrder = {
  id: string;
  ticker: string;
  action: string;
  shares: number;
  limitPrice: number | null;
  fillPrice?: number | null;
  costUsd?: number | null;
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

function positive(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function reasonPrice(order: LoopOrder): number | null {
  const reason = order.reason ?? "";
  const m = /last\s+([\d.]+)/i.exec(reason);
  return m ? positive(Number(m[1])) : null;
}

/** Modeled fill when the book stored one, otherwise the signal limit. */
export function executionPrice(order: LoopOrder): number | null {
  return positive(order.fillPrice) ?? positive(order.limitPrice) ?? reasonPrice(order);
}

function allocatedCost(cost: number | null | undefined, take: number, legShares: number): number {
  if (cost == null || !Number.isFinite(cost) || legShares <= 0 || take <= 0) return 0;
  return (cost * take) / legShares;
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
  const lots: Record<
    string,
    Array<{
      shares: number;
      lotShares: number;
      entry: number;
      entryCost: number;
      entryReason: string | null;
      enteredAt: string | null;
    }>
  > = {};
  const closed: ClosedLoopTrade[] = [];

  for (const o of sorted) {
    const ticker = o.ticker;
    const shares = o.shares;
    if (o.action === "BUY") {
      const entryPx = executionPrice(o);
      if (entryPx == null) continue;
      if (!lots[ticker]) lots[ticker] = [];
      lots[ticker].push({
        shares,
        lotShares: shares,
        entry: entryPx,
        entryCost: o.costUsd ?? 0,
        entryReason: o.reason,
        enteredAt: o.createdAt,
      });
      continue;
    }
    const exitPx = executionPrice(o);
    if (exitPx == null) continue;
    let remaining = shares;
    const queue = lots[ticker] ?? [];
    while (remaining > 0 && queue.length > 0) {
      const lot = queue[0];
      const take = Math.min(remaining, lot.shares);
      const pnl =
        (exitPx - lot.entry) * take -
        allocatedCost(lot.entryCost, take, lot.lotShares) -
        allocatedCost(o.costUsd, take, shares);
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
        returnPct: lot.entry ? (pnl / (lot.entry * take)) * 100 : 0,
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
