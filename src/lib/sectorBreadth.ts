/** Same net-score as pipeline.compute.aggregates.compute_breadth. */

export type SectorScore = {
  sector: string;
  n: number;
  green: number;
  red: number;
  grey: number;
  net: number;
};

export function sectorBreadth(
  radar: { symbol?: string; state: number }[],
  universe: { symbol: string; sector: string | null }[]
): SectorScore[] {
  const sectorOf = new Map(universe.map((u) => [u.symbol, u.sector || "Unknown"]));
  const acc = new Map<string, { n: number; green: number; red: number }>();

  for (const r of radar) {
    const sector = (r.symbol ? sectorOf.get(r.symbol) : undefined) || "Unknown";
    const cur = acc.get(sector) ?? { n: 0, green: 0, red: 0 };
    cur.n += 1;
    if (r.state === 1) cur.green += 1;
    else if (r.state === -1) cur.red += 1;
    acc.set(sector, cur);
  }

  return Array.from(acc.entries())
    .map(([sector, c]) => ({
      sector,
      n: c.n,
      green: c.green,
      red: c.red,
      grey: c.n - c.green - c.red,
      net: c.n > 0 ? Math.round(((c.green - c.red) / c.n) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.net - a.net || b.n - a.n);
}
