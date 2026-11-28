/** Live posture helpers — breadth / brief; composite score from pipeline or `postureComposite`. */

export type RadarRow = {
  symbol: string;
  state: number;
  quality_rank: number;
  z_mom: number | null;
};

export type UniverseSectorRow = {
  symbol: string;
  sector?: string | null;
  country?: string | null;
};

export type PosturePillars = {
  breadth: number;
  trend: number;
  index_trend: number;
  highs_lows: number;
  risk: number;
  leadership?: number;
  participation?: number;
  vol?: number;
  heat_cap_pct?: number;
  guidance?: string;
};

function dayPct(row: RadarRow): number {
  const z = row.z_mom;
  if (z == null || !Number.isFinite(z)) return 0;
  return z;
}

/** @deprecated Use composite posture from daily_brief; kept for legacy fallbacks. */
export function computePostureScore(advancersPct: number): number {
  return Math.min(100, Math.max(0, Math.round(advancersPct)));
}

export function computePostureLabel(score: number): string {
  if (score >= 70) return "Bullish";
  if (score >= 55) return "Slight Bullish";
  if (score >= 45) return "Neutral";
  if (score >= 30) return "Slight Bearish";
  return "Bearish";
}

export function sectorLeaders(
  radar: RadarRow[],
  universe: UniverseSectorRow[]
): { bestSector: string | null; worstSector: string | null } {
  const sectorMap = new Map(universe.map((u) => [u.symbol, u.sector?.trim() || "Unknown"]));
  const changes = new Map<string, number[]>();
  for (const row of radar) {
    const sector = sectorMap.get(row.symbol) ?? "Unknown";
    const list = changes.get(sector) ?? [];
    list.push(dayPct(row));
    changes.set(sector, list);
  }
  const scores = Array.from(changes.entries())
    .filter(([, vals]) => vals.length > 0)
    .map(([sector, vals]) => ({
      sector,
      avg: vals.reduce((s: number, v: number) => s + v, 0) / vals.length,
    }))
    .sort((a, b) => b.avg - a.avg);
  if (!scores.length) return { bestSector: null, worstSector: null };
  return { bestSector: scores[0].sector, worstSector: scores.at(-1)!.sector };
}

export function radarParticipationPillars(
  advancersPct: number,
  radar: RadarRow[],
  onListPct: number
): Pick<PosturePillars, "leadership" | "participation" | "heat_cap_pct"> {
  const total = radar.length || 1;
  const leaders = radar.filter((r) => (r.quality_rank ?? 0) >= 70).length;
  const leadership = Math.round((leaders / total) * 1000) / 10;
  const participation = Math.min(100, Math.max(0, Math.round(onListPct)));
  const avgRank = total > 0 ? radar.reduce((s, r) => s + r.quality_rank, 0) / total : 0;
  const heatCap = Math.min(
    100,
    Math.max(15, Math.round(advancersPct - Math.max(0, avgRank - leadership) * 0.35))
  );
  return { leadership: Math.round(leadership), participation, heat_cap_pct: heatCap };
}

/** @deprecated replaced by pipeline composite pillars */
export function computePosturePillars(
  advancersPct: number,
  radar: RadarRow[],
  avgRank: number,
  breadthOnListPct: number
): PosturePillars {
  const aux = radarParticipationPillars(advancersPct, radar, breadthOnListPct);
  return {
    breadth: computePostureScore(advancersPct),
    trend: computePostureScore(avgRank),
    index_trend: 50,
    highs_lows: 50,
    risk: 50,
    vol: 50,
    guidance: "Legacy live fallback",
    ...aux,
  };
}

export function buildDeskPostureBrief(
  label: string,
  advancersPct: number,
  onList: number,
  bestSector: string | null
): string {
  const led = bestSector ? `, led by ${bestSector}` : "";
  return `${label} — ${advancersPct}% of names up, ${onList} on the watchlist${led}`;
}

/** True when stored daily_brief is behind the latest price session. */
export function isPostureBriefStale(briefAsOf: string | null, pricesAsOf: string | null): boolean {
  if (!pricesAsOf) return false;
  if (!briefAsOf) return true;
  return briefAsOf.slice(0, 10) < pricesAsOf.slice(0, 10);
}

/** Trend radar row is stale when ``computed_at`` is before the latest price session. */
export function isTrendRadarRowStale(
  computedAt: string | null | undefined,
  pricesAsOf: string | null
): boolean {
  if (!pricesAsOf) return false;
  if (!computedAt) return true;
  const day = computedAt.slice(0, 10);
  return day < pricesAsOf.slice(0, 10);
}