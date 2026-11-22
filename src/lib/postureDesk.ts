/** Live posture / breadth from trend_radar — mirrors pipeline.compute.aggregates. */

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
  trend: number;
  breadth: number;
  leadership: number;
  participation: number;
  vol: number;
  heat_cap_pct: number;
  guidance: string;
};

function dayPct(row: RadarRow): number {
  const z = row.z_mom;
  if (z == null || !Number.isFinite(z)) return 0;
  return z;
}

export function computePostureScore(advancersPct: number): number {
  return Math.min(100, Math.max(0, Math.round(advancersPct)));
}

export function computePostureLabel(score: number): string {
  if (score >= 75) return "Bullish";
  if (score >= 60) return "Slight Bullish";
  if (score >= 40) return "Neutral";
  if (score >= 25) return "Slight Bearish";
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

export function computePosturePillars(
  advancersPct: number,
  radar: RadarRow[],
  avgRank: number,
  breadthOnListPct: number
): PosturePillars {
  const total = radar.length || 1;
  const adv = advancersPct;
  const onListPct = breadthOnListPct;
  const leaders = radar.filter((r) => (r.quality_rank ?? 0) >= 70).length;
  const leadership = Math.round((leaders / total) * 1000) / 10;
  const trend = computePostureScore(avgRank);
  const breadth = computePostureScore(adv);
  const participation = computePostureScore(onListPct);
  const vol = 50;
  const heatCap = Math.min(100, Math.max(15, Math.round(adv - Math.max(0, trend - leadership) * 0.35)));

  let guidance: string;
  if (trend >= 55 && leadership < 45) {
    guidance = "Uptrend under pressure — trim size, add cautiously";
  } else if (adv >= 60 && participation >= 10) {
    guidance = "Participation firm with active watchlist — stay selective";
  } else if (adv >= 60 && participation < 10) {
    guidance = "Tape mixed — advancers strong but few hot names on list";
  } else if (adv <= 40) {
    guidance = "Defensive tape — reduce heat, wait for breadth repair";
  } else {
    guidance = "Mixed tape — size to posture and sector leaders";
  }

  return {
    trend,
    breadth,
    leadership: Math.round(leadership),
    participation,
    vol,
    heat_cap_pct: heatCap,
    guidance,
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