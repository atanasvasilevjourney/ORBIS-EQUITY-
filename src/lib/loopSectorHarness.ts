/** Derive sector harness rows from open book when run harness is empty (e.g. manual restore). */

export type LoopBookSectorRow = {
  sector: string;
  shares: number;
  last: number | null;
};

export type SectorExposureRow = {
  sector: string;
  exposurePct: number;
  capPct: number;
  utilizationPct: number;
  names: number;
};

export function sectorExposureFromBook(
  rows: LoopBookSectorRow[],
  equity: number,
  maxNames = 8,
  maxPerSector = 2
): SectorExposureRow[] {
  if (!rows.length || equity <= 0) return [];
  const capPct = maxPerSector / maxNames;
  const bySector = new Map<string, { names: number; mv: number }>();
  for (const r of rows) {
    const sector = r.sector?.trim() || "Unknown";
    const last = r.last ?? 0;
    const cur = bySector.get(sector) ?? { names: 0, mv: 0 };
    cur.names += 1;
    cur.mv += last * r.shares;
    bySector.set(sector, cur);
  }
  return Array.from(bySector.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([sector, { names, mv }]) => ({
      sector,
      exposurePct: Math.round((mv / equity) * 10000) / 10000,
      capPct: Math.round(capPct * 10000) / 10000,
      utilizationPct: Math.round((names / maxPerSector) * 10000) / 10000,
      names,
    }));
}
