/** Last-session movers from two daily prints — not live pre-market. */

export type SessionBar = {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

export type SessionMover = {
  ticker: string;
  companyName: string;
  last: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number | null;
  chgPct: number;
  chgAbs: number;
  gapPct: number;
  dollarVol: number;
};

export function sessionMovers(
  today: SessionBar[],
  prev: SessionBar[],
  names: Record<string, string> = {}
): SessionMover[] {
  const prior = new Map<string, SessionBar>();
  for (let i = 0; i < prev.length; i++) {
    const row = prev[i];
    if (row?.symbol && Number.isFinite(row.close) && row.close > 0) prior.set(row.symbol, row);
  }
  const out: SessionMover[] = [];
  for (let i = 0; i < today.length; i++) {
    const row = today[i];
    if (!row?.symbol) continue;
    const last = row.close;
    const open = row.open;
    const high = row.high;
    const low = row.low;
    if (![last, open, high, low].every((v) => Number.isFinite(v) && v > 0)) continue;
    const y = prior.get(row.symbol);
    if (!y) continue;
    const prevClose = y.close;
    if (!(prevClose > 0)) continue;
    const vol = row.volume != null && Number.isFinite(row.volume) ? Number(row.volume) : null;
    out.push({
      ticker: row.symbol,
      companyName: names[row.symbol] ?? "",
      last,
      prevClose,
      open,
      high,
      low,
      volume: vol,
      chgPct: last / prevClose - 1,
      chgAbs: last - prevClose,
      gapPct: open / prevClose - 1,
      dollarVol: vol == null ? 0 : last * vol,
    });
  }
  return out;
}

export function rankGainers(rows: SessionMover[], n = 80): SessionMover[] {
  return rows.filter((r) => r.chgPct > 0).sort((a, b) => b.chgPct - a.chgPct).slice(0, n);
}

export function rankLosers(rows: SessionMover[], n = 80): SessionMover[] {
  return rows.filter((r) => r.chgPct < 0).sort((a, b) => a.chgPct - b.chgPct).slice(0, n);
}

export function rankGappers(rows: SessionMover[], minAbs = 0.04, n = 80): SessionMover[] {
  return rows
    .filter((r) => Math.abs(r.gapPct) >= minAbs)
    .sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct))
    .slice(0, n);
}

export function rankLiquid(rows: SessionMover[], n = 80): SessionMover[] {
  return [...rows].sort((a, b) => b.dollarVol - a.dollarVol).slice(0, n);
}
