/** Replay LOOP paper orders + open book for mark-to-market equity (matches pipeline). */

export const LOOP_START_EQUITY = 100_000;

export type LoopOrderLike = {
  ticker: string;
  action: string;
  shares: number;
  limitPrice?: number | null;
  limit_price?: number | null;
  reason?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
};

export type LoopBookLike = {
  shares: number;
  entry: number;
  last?: number | null;
};

export type LoopEquitySnapshot = {
  startEquityUsd: number;
  cashUsd: number;
  deployedNotionalUsd: number;
  mtmEquityUsd: number;
  totalPnlUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  deployedPct: number;
};

function exitPrice(order: LoopOrderLike): number | null {
  const lp = order.limitPrice ?? order.limit_price;
  if (lp != null && Number.isFinite(Number(lp))) return Number(lp);
  const reason = order.reason ?? "";
  const m = /last\s+([\d.]+)/i.exec(reason);
  return m ? Number(m[1]) : null;
}

function orderTime(o: LoopOrderLike): string {
  return String(o.createdAt ?? o.created_at ?? "");
}

export function loopRealizedPnlUsd(orders: LoopOrderLike[]): number {
  const lots = new Map<string, { shares: number; entry: number }[]>();
  let realized = 0;
  const sorted = [...orders].sort((a, b) => orderTime(a).localeCompare(orderTime(b)));
  for (const o of sorted) {
    const ticker = o.ticker;
    const shares = Math.trunc(o.shares);
    const action = o.action.toUpperCase();
    if (action === "BUY") {
      const entry = o.limitPrice ?? o.limit_price;
      if (entry == null) continue;
      const arr = lots.get(ticker) ?? [];
      arr.push({ shares, entry: Number(entry) });
      lots.set(ticker, arr);
      continue;
    }
    if (action !== "SELL") continue;
    const px = exitPrice(o);
    if (px == null) continue;
    let remaining = shares;
    const arr = lots.get(ticker) ?? [];
    while (remaining > 0 && arr.length > 0) {
      const lot = arr[0];
      const take = Math.min(remaining, lot.shares);
      realized += (px - lot.entry) * take;
      lot.shares -= take;
      remaining -= take;
      if (lot.shares === 0) arr.shift();
    }
    lots.set(ticker, arr);
  }
  return Math.round(realized * 100) / 100;
}

export function loopPortfolioEquity(
  orders: LoopOrderLike[],
  book: LoopBookLike[],
  startEquityUsd = LOOP_START_EQUITY
): LoopEquitySnapshot {
  let deployed = 0;
  for (const p of book) {
    const sh = Math.trunc(p.shares);
    const last = Number(p.last ?? p.entry);
    deployed += sh * last;
  }

  let cash = startEquityUsd;
  const sorted = [...orders].sort((a, b) => orderTime(a).localeCompare(orderTime(b)));
  for (const o of sorted) {
    const shares = Math.trunc(o.shares);
    if (shares <= 0) continue;
    const action = o.action.toUpperCase();
    if (action === "BUY") {
      const lp = o.limitPrice ?? o.limit_price;
      if (lp != null) cash -= shares * Number(lp);
    } else if (action === "SELL") {
      const px = exitPrice(o);
      if (px != null) cash += shares * px;
    }
  }

  const mtmEquityUsd = cash + deployed;
  const totalPnlUsd = mtmEquityUsd - startEquityUsd;
  const realizedPnlUsd = loopRealizedPnlUsd(orders);
  const unrealizedPnlUsd = Math.round((totalPnlUsd - realizedPnlUsd) * 100) / 100;
  const denom = mtmEquityUsd > 0 ? mtmEquityUsd : startEquityUsd;

  return {
    startEquityUsd,
    cashUsd: Math.round(cash * 100) / 100,
    deployedNotionalUsd: Math.round(deployed * 100) / 100,
    mtmEquityUsd: Math.round(mtmEquityUsd * 100) / 100,
    totalPnlUsd: Math.round(totalPnlUsd * 100) / 100,
    realizedPnlUsd,
    unrealizedPnlUsd,
    deployedPct: denom ? Math.round((deployed / denom) * 10000) / 10000 : 0,
  };
}
