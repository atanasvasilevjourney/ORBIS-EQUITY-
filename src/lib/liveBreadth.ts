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

export type SectorSessionBreadth = {
  sector: string;
  nNames: number;
  advancersPct: number;
  avgDayPct: number;
};

export function sectorSessionBreadth(
  radar: RadarDayRow[],
  quotes: Map<string, SessionQuote>,
  sectorBySymbol: Map<string, string>
): SectorSessionBreadth[] {
  const buckets = new Map<string, number[]>();
  for (const row of radar) {
    const sector = (sectorBySymbol.get(row.symbol) ?? "Unclassified").trim() || "Unclassified";
    const day = sessionDayPct(row.symbol, quotes, row);
    if (day == null || !Number.isFinite(day)) continue;
    const list = buckets.get(sector) ?? [];
    list.push(day);
    buckets.set(sector, list);
  }
  return Array.from(buckets.entries())
    .filter(([, vals]) => vals.length > 0)
    .map(([sector, vals]) => {
      const up = vals.filter((v) => v > 0).length;
      return {
        sector,
        nNames: vals.length,
        advancersPct: Math.round((up / vals.length) * 1000) / 10,
        avgDayPct: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100,
      };
    })
    .sort((a, b) => b.avgDayPct - a.avgDayPct);
}

export function sectorLeadersFromSession(
  radar: RadarDayRow[],
  quotes: Map<string, SessionQuote>,
  sectorBySymbol: Map<string, string>
): { bestSector: string | null; worstSector: string | null; sectors: SectorSessionBreadth[] } {
  const sectors = sectorSessionBreadth(radar, quotes, sectorBySymbol);
  if (!sectors.length) {
    return { bestSector: null, worstSector: null, sectors: [] };
  }
  return {
    bestSector: sectors[0].sector,
    worstSector: sectors.at(-1)!.sector,
    sectors,
  };
}

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