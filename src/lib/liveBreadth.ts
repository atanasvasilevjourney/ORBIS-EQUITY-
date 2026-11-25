import type { SessionQuote } from "@/lib/sessionQuotes";

export type RadarDayRow = { symbol: string; z_mom: number | null };

export function sessionDayPct(
  symbol: string,
  quotes: Map<string, SessionQuote>,
  radar: RadarDayRow
): number | null {
  const quote = quotes.get(symbol);
  if (quote?.dayPct != null && Number.isFinite(quote.dayPct)) return quote.dayPct;
  if (radar.z_mom != null && Number.isFinite(radar.z_mom)) return radar.z_mom;
  return null;
}

export function countAdvancersDecliners(
  radar: RadarDayRow[],
  quotes: Map<string, SessionQuote>
): { advancers: number; decliners: number; unchanged: number } {
  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  for (const row of radar) {
    const d = sessionDayPct(row.symbol, quotes, row);
    if (d == null || d === 0) unchanged += 1;
    else if (d > 0) advancers += 1;
    else decliners += 1;
  }
  return { advancers, decliners, unchanged };
}

export type SessionMover = {
  symbol: string;
  dayPct: number;
  asOf: string | null;
  quoteStale: boolean;
};

export function sessionLeadersLaggards(
  radar: RadarDayRow[],
  quotes: Map<string, SessionQuote>,
  limit = 10
): { leaders: SessionMover[]; laggards: SessionMover[]; pricesAsOf: string | null } {
  const rows: SessionMover[] = [];
  for (const row of radar) {
    const quote = quotes.get(row.symbol);
    const dayPct = sessionDayPct(row.symbol, quotes, row);
    if (dayPct == null || !Number.isFinite(dayPct)) continue;
    rows.push({
      symbol: row.symbol,
      dayPct,
      asOf: quote?.asOf ?? null,
      quoteStale: quote?.stale ?? true,
    });
  }
  const leaders = [...rows].sort((a, b) => b.dayPct - a.dayPct).slice(0, limit);
  const laggards = [...rows].sort((a, b) => a.dayPct - b.dayPct).slice(0, limit);
  const pricesAsOf =
    rows
      .map((r) => r.asOf)
      .filter((d): d is string => !!d)
      .sort()
      .at(-1) ?? null;
  return { leaders, laggards, pricesAsOf };
}