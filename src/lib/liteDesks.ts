import { buildCanaries, equityFromCloses } from "@/lib/canary";
import { corrMatrix, dailyReturns } from "@/lib/corr";
import type { CorrMatrix } from "@/lib/corr";
import {
  finiteMean,
  finiteVol,
  lastFinite,
  listwiseReturns,
  maxSharpeWeights,
  minVarWeights,
  portfolioStats,
  sampleCov,
  sampleMu,
} from "@/lib/markowitz";

export type PricePoint = { symbol: string; date: string; close: number; sector?: string };

function bySymbol(rows: PricePoint[]): Map<string, { dates: string[]; close: number[]; sector: string }> {
  const map = new Map<string, { dates: string[]; close: number[]; sector: string }>();
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
  for (const r of sorted) {
    if (!r.symbol || !Number.isFinite(r.close)) continue;
    const cur = map.get(r.symbol) ?? { dates: [], close: [], sector: r.sector || "Other" };
    cur.dates.push(r.date.slice(0, 10));
    cur.close.push(r.close);
    if (r.sector) cur.sector = r.sector;
    map.set(r.symbol, cur);
  }
  return map;
}

function pickPerSector(meta: Map<string, { sector: string }>, maxPer = 4): string[] {
  const buckets = new Map<string, string[]>();
  meta.forEach((m, sym) => {
    const list = buckets.get(m.sector) ?? [];
    if (list.length < maxPer) list.push(sym);
    buckets.set(m.sector, list);
  });
  const out: string[] = [];
  buckets.forEach((list) => {
    out.push(...list);
  });
  return out;
}

export function alignCloses(book: Map<string, { dates: string[]; close: number[] }>, symbols: string[]): {
  labels: string[];
  closes: number[][];
} {
  const eligible = symbols
    .map((s) => ({ sym: s, row: book.get(s) }))
    .filter((x): x is { sym: string; row: { dates: string[]; close: number[] } } => !!x.row && x.row.dates.length >= 60);
  if (eligible.length < 2) return { labels: [], closes: [] };
  const freq = new Map<string, number>();
  for (let i = 0; i < eligible.length; i++) {
    const seen = new Set(eligible[i].row.dates);
    seen.forEach((d) => freq.set(d, (freq.get(d) ?? 0) + 1));
  }
  const popular: string[] = [];
  freq.forEach((n, d) => {
    if (n >= 2) popular.push(d);
  });
  popular.sort();
  const window = popular.slice(-252);
  if (window.length < 60) return { labels: [], closes: [] };
  const labels: string[] = [];
  const closes: number[][] = [];
  for (let i = 0; i < eligible.length; i++) {
    const { sym, row } = eligible[i];
    const lookup = new Map(row.dates.map((d, j) => [d, row.close[j]]));
    const series = window.map((d) => lookup.get(d) ?? Number.NaN);
    const finite = series.filter((v) => Number.isFinite(v)).length;
    if (finite >= 60) {
      labels.push(sym);
      closes.push(series);
    }
  }
  return { labels, closes };
}

export function liteQuantFromPrices(rows: PricePoint[]): {
  names: {
    ticker: string;
    companyName: string;
    last: number | null;
    annReturn: number | null;
    annVol: number | null;
    sharpe: number | null;
    wEqual: number | null;
    wInvVol: number | null;
    wMinVar: number | null;
    wMaxSharpe: number | null;
    altmanZone: string | null;
  }[];
  corr: CorrMatrix;
  headline: string;
  lite: true;
  allocations: Record<string, { label: string; annReturn: number | null; annVol: number | null; sharpe: number | null }>;
} {
  const book = bySymbol(rows);
  const symbols: string[] = [];
  book.forEach((_row, sym) => symbols.push(sym));
  symbols.sort();
  const { labels, closes } = alignCloses(book, symbols.slice(0, 40));
  const rets = closes.map(dailyReturns);
  const corr = corrMatrix(labels, rets);
  const n = labels.length || 1;
  type LiteName = {
    ticker: string;
    companyName: string;
    last: number | null;
    annReturn: number | null;
    annVol: number | null;
    sharpe: number | null;
    wEqual: number | null;
    wInvVol: number | null;
    wMinVar: number | null;
    wMaxSharpe: number | null;
    altmanZone: string | null;
  };
  const names: LiteName[] = labels.map((ticker, i) => {
    const r = rets[i];
    const mu = finiteMean(r);
    const vol = finiteVol(r, mu);
    const ann = mu == null ? null : mu * 252;
    const last = lastFinite(closes[i]);
    return {
      ticker,
      companyName: "",
      last,
      annReturn: ann,
      annVol: vol,
      sharpe: vol != null && vol > 1e-8 && ann != null ? (ann - 0.04) / vol : null,
      wEqual: 1 / n,
      wInvVol: null,
      wMinVar: null,
      wMaxSharpe: null,
      altmanZone: null,
    };
  });
  const invRaw = names.map((row) => 1 / Math.max(row.annVol ?? 1, 1e-8));
  const invSum = invRaw.reduce((a, b) => a + b, 0) || 1;
  names.forEach((row, i) => {
    row.wInvVol = invRaw[i] / invSum;
  });
  const panel = listwiseReturns(rets);
  const canOpt = panel.length >= 2 && (panel[0]?.length ?? 0) >= 40;
  let wMin: number[] = names.map((row) => row.wInvVol ?? 1 / n);
  let wMax: number[] = names.map((row) => row.wEqual ?? 1 / n);
  let minStats = { annReturn: null as number | null, annVol: null as number | null, sharpe: null as number | null };
  let maxStats = { ...minStats };
  let eqStats = { ...minStats };
  let invStats = { ...minStats };
  if (canOpt) {
    const mu = sampleMu(panel);
    const cov = sampleCov(panel);
    wMin = minVarWeights(cov);
    wMax = maxSharpeWeights(mu, cov);
    minStats = portfolioStats(wMin, mu, cov);
    maxStats = portfolioStats(wMax, mu, cov);
    eqStats = portfolioStats(names.map(() => 1 / n), mu, cov);
    invStats = portfolioStats(names.map((row) => row.wInvVol ?? 1 / n), mu, cov);
  }
  names.forEach((row, i) => {
    row.wMinVar = wMin[i] ?? null;
    row.wMaxSharpe = wMax[i] ?? null;
  });
  names.sort((a, b) => (b.sharpe ?? -999) - (a.sharpe ?? -999));
  return {
    names,
    corr,
    headline: canOpt
      ? `lite tape · ${labels.length} names from prices_daily · long-only simplex min-var / max-Sharpe`
      : `lite tape · ${labels.length} names from prices_daily · correlation + 1/N (book too short for Markowitz)`,
    lite: true,
    allocations: {
      equal: { label: "Equally weighted (lite)", ...eqStats },
      invVol: { label: "Inverse volatility (lite)", ...invStats },
      minVar: { label: canOpt ? "Min variance (lite simplex)" : "Min variance — need ≥40 listwise days", ...minStats },
      maxSharpe: { label: canOpt ? "Max Sharpe (lite simplex)" : "Max Sharpe — need ≥40 listwise days", ...maxStats },
    },
  };
}

export function liteRotateFromPrices(
  rows: PricePoint[],
  meta: { symbol: string; sector: string }[]
): {
  canaries: ReturnType<typeof buildCanaries>["votes"];
  corr: CorrMatrix;
  regime: string;
  canaryOn: number;
  canaryOff: number;
  canaryScore: number;
  headline: string;
  lite: true;
} {
  const metaMap = new Map(meta.map((m) => [m.symbol, { sector: m.sector || "Other" }]));
  const book = bySymbol(rows.map((r) => ({ ...r, sector: metaMap.get(r.symbol)?.sector })));
  const picked = pickPerSector(metaMap, 4).filter((s) => (book.get(s)?.close.length ?? 0) >= 80);
  const baskets: Record<string, number[]> = {};
  const sectorCloses = new Map<string, number[][]>();
  for (const sym of picked) {
    const row = book.get(sym);
    if (!row) continue;
    const list = sectorCloses.get(row.sector) ?? [];
    list.push(row.close);
    sectorCloses.set(row.sector, list);
  }
  const all: number[][] = [];
  book.forEach((r) => all.push(r.close));
  baskets.univ = equityFromCloses(all);
  const mapSector = (name: string, keys: string[]) => {
    const mem: number[][] = [];
    for (const k of keys) mem.push(...(sectorCloses.get(k) ?? []));
    if (mem.length) baskets[name] = equityFromCloses(mem);
  };
  mapSector("tech", ["Technology"]);
  mapSector("disc", ["Consumer Discretionary"]);
  mapSector("staples", ["Consumer Staples"]);
  mapSector("energy", ["Energy"]);
  mapSector("defensive", ["Health Care", "Consumer Staples", "Utilities", "Real Estate"]);
  mapSector("financials", ["Financials"]);
  const canaries = buildCanaries(baskets);
  const sectorLabels: string[] = [];
  const sectorRets: number[][] = [];
  sectorCloses.forEach((mem, sec) => {
    const eq = equityFromCloses(mem);
    if (eq.length < 60) return;
    sectorLabels.push(sec);
    sectorRets.push(dailyReturns(eq));
  });
  const corr = corrMatrix(sectorLabels, sectorRets);
  return {
    canaries: canaries.votes,
    corr,
    regime: canaries.regime,
    canaryOn: canaries.nOn,
    canaryOff: canaries.nOff,
    canaryScore: canaries.score,
    headline: `lite canaries · ${canaries.regime} (${canaries.nOn}↑/${canaries.nOff}↓) · sector corr from prices_daily`,
    lite: true,
  };
}
