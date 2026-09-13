/** Same net-score and posture as pipeline.compute.aggregates. */

export type SectorMember = {
  symbol: string;
  state: number;
  rank: number;
};

export type SectorScore = {
  sector: string;
  n: number;
  green: number;
  red: number;
  grey: number;
  net: number;
  names: SectorMember[];
};

export type LiveTape = {
  sectors: SectorScore[];
  total: number;
  greens: number;
  reds: number;
  greys: number;
  pctGreen: number;
  pctRed: number;
  pctGrey: number;
  posture: number;
  postureLabel: string;
  bestSector: string | null;
  worstSector: string | null;
  bestSectorScore: number | null;
  worstSectorScore: number | null;
  briefText: string;
};

export function oneDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

export function normalizeSector(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function sectorsMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = normalizeSector(a);
  return left.length > 0 && left === normalizeSector(b);
}

export function sectorBreadth(
  radar: { symbol?: string; state: number; quality_rank?: number; rank?: number }[],
  universe: { symbol: string; sector: string | null }[]
): SectorScore[] {
  const sectorOf = new Map(universe.map((u) => [u.symbol, u.sector || "Unknown"]));
  const acc = new Map<string, { n: number; green: number; red: number; names: SectorMember[] }>();

  for (const r of radar) {
    const sector = (r.symbol ? sectorOf.get(r.symbol) : undefined) || "Unknown";
    const cur = acc.get(sector) ?? { n: 0, green: 0, red: 0, names: [] };
    cur.n += 1;
    if (r.state === 1) cur.green += 1;
    else if (r.state === -1) cur.red += 1;
    if (r.symbol) {
      cur.names.push({
        symbol: r.symbol,
        state: r.state,
        rank: r.quality_rank ?? r.rank ?? 0,
      });
    }
    acc.set(sector, cur);
  }

  return Array.from(acc.entries())
    .map(([sector, c]) => ({
      sector,
      n: c.n,
      green: c.green,
      red: c.red,
      grey: c.n - c.green - c.red,
      net: c.n > 0 ? oneDecimal(((c.green - c.red) / c.n) * 100) : 0,
      names: c.names.sort((a, b) => b.rank - a.rank || a.symbol.localeCompare(b.symbol)),
    }))
    .sort((a, b) => b.net - a.net || b.n - a.n || a.sector.localeCompare(b.sector));
}

export function computePosture(sectors: SectorScore[], pctGreen: number, pctRed: number): number {
  const netBreadth = pctGreen - pctRed;
  const netScore = ((netBreadth + 100) / 200) * 50;
  const totalDirectional = pctGreen + pctRed;
  const directionRatio = totalDirectional > 0 ? (pctGreen - pctRed) / totalDirectional : 0;
  const greenScore = ((directionRatio + 1) / 2) * 30;
  const uniformity = sectors.length
    ? (sectors.filter((s) => s.net > 0).length / sectors.length) * 20
    : 10;
  const raw = netScore + greenScore + uniformity;
  return Math.min(Math.max(Math.round(raw), 0), 100);
}

export function computePostureLabel(score: number): string {
  if (score >= 75) return "Bullish";
  if (score >= 60) return "Slight Bullish";
  if (score >= 40) return "Neutral";
  if (score >= 25) return "Slight Bearish";
  return "Bearish";
}

export function liveBrief(label: string, pctGreen: number, bestSector: string | null): string {
  return `${label} - ${pctGreen}% GREEN, led by ${bestSector ?? "—"}`;
}

export function liveTape(
  radar: { symbol?: string; state: number; quality_rank?: number; rank?: number }[],
  universe: { symbol: string; sector: string | null }[]
): LiveTape {
  const sectors = sectorBreadth(radar, universe);
  const total = radar.length;
  const greens = radar.filter((r) => r.state === 1).length;
  const reds = radar.filter((r) => r.state === -1).length;
  const greys = total - greens - reds;
  const pctGreen = total > 0 ? oneDecimal((greens / total) * 100) : 0;
  const pctRed = total > 0 ? oneDecimal((reds / total) * 100) : 0;
  const pctGrey = total > 0 ? oneDecimal((greys / total) * 100) : 0;
  const posture = computePosture(sectors, pctGreen, pctRed);
  const postureLabel = computePostureLabel(posture);
  const best = sectors[0] ?? null;
  const worst = sectors.length ? sectors[sectors.length - 1] : null;
  return {
    sectors,
    total,
    greens,
    reds,
    greys,
    pctGreen,
    pctRed,
    pctGrey,
    posture,
    postureLabel,
    bestSector: best?.sector ?? null,
    worstSector: worst?.sector ?? null,
    bestSectorScore: best?.net ?? null,
    worstSectorScore: worst?.net ?? null,
    briefText: liveBrief(postureLabel, pctGreen, best?.sector ?? null),
  };
}
