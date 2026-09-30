/** Server-only: fill QUANT/ROTATE from prices_daily when compute snapshots are empty. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/supabase/paginate";
import { liteQuantFromPrices, liteRotateFromPrices, type PricePoint } from "@/lib/liteDesks";
import { parseCorr, type CorrMatrix } from "@/lib/corr";

export const LIQUID_NAMES = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "JPM", "XOM",
  "JNJ", "PG", "UNH", "V", "HD", "CVX", "LLY", "AVGO",
  "COST", "WMT", "BAC", "ORCL", "AMD", "NFLX", "KO", "DIS",
] as const;

export const EMPTY_PERPS = {
  summary: null,
  names: [],
  temaBook: [],
  macdClosed: [],
  carverBook: [],
  headline: null,
  config: null,
  stale: true,
};

export const EMPTY_QUANT = {
  summary: null,
  names: [],
  allocations: null,
  frontier: [] as { annReturn: number; annVol: number; sharpe: number }[],
  headline: null,
  corr: null as CorrMatrix | null,
  stale: true,
  lite: false,
};

export const EMPTY_ROTATE = {
  summary: null,
  sectors: [] as unknown[],
  industries: [] as unknown[],
  canaries: [] as unknown[],
  triggers: [] as unknown[],
  carver: [] as unknown[],
  headline: null,
  config: null as Record<string, unknown> | null,
  corr: null as CorrMatrix | null,
  stale: true,
  lite: false,
};

type UniRow = { symbol: string; sector?: string | null; company_name?: string | null };
type PxRow = { symbol: string; date: string; close: number | string | null };

function uniq(xs: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (!x || seen[x]) continue;
    seen[x] = true;
    out.push(x);
  }
  return out;
}

function cutoffIso(days = 400): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export { parseCorr };

export function canaryTapesFromConfig(config: unknown): Record<string, number[]> {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const tapes = (config as { canaryTapes?: unknown }).canaryTapes;
  if (!tapes || typeof tapes !== "object" || Array.isArray(tapes)) return {};
  const out: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(tapes as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      out[k] = v.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    }
  }
  return out;
}

export function tapePoints(smooth: number[]): { ratio: null; z: null; smooth: number }[] {
  return smooth.map((s) => ({ ratio: null, z: null, smooth: s }));
}

export async function fetchUniverse(sb: SupabaseClient): Promise<UniRow[]> {
  return fetchAll<UniRow>(
    sb,
    "universe_members",
    "symbol, sector, company_name",
    (q) => q.eq("is_active", true)
  ).catch(() => []);
}

export async function fetchLitePrices(sb: SupabaseClient, symbols: string[]): Promise<PricePoint[]> {
  const uniqSyms = uniq(symbols.map((s) => s.toUpperCase()).filter((s) => /^[A-Z0-9.\-]{1,20}$/.test(s)));
  if (!uniqSyms.length) return [];
  const since = cutoffIso(400);
  const rows = await fetchAll<PxRow>(
    sb,
    "prices_daily",
    "symbol, date, close",
    (q) => q.in("symbol", uniqSyms).gte("date", since).order("date", { ascending: true })
  ).catch(() => []);
  return rows
    .filter((r) => r.symbol && r.close != null && Number.isFinite(Number(r.close)))
    .map((r) => ({
      symbol: r.symbol,
      date: String(r.date).slice(0, 10),
      close: Number(r.close),
    }));
}

export async function liteQuantPayload(sb: SupabaseClient) {
  const uni = await fetchUniverse(sb);
  const wanted = uniq([...LIQUID_NAMES, ...uni.map((u) => u.symbol)]).slice(0, 40);
  const prices = await fetchLitePrices(sb, wanted);
  const lite = liteQuantFromPrices(prices);
  const w = 1 / Math.max(lite.names.length, 1);
  const asOf = prices.reduce((mx, r) => (r.date > mx ? r.date : mx), "");
  return {
    summary: {
      names: lite.names.length,
      asOfDate: asOf || null,
      runId: null,
      lastRunAt: null,
      distressed: 0,
      maxSharpe: lite.allocations.maxSharpe.sharpe,
      minVol: lite.allocations.minVar.annVol,
    },
    names: lite.names.map((n) => ({
      ...n,
      sortino: null,
      maxDrawdown: null,
      var95: null,
      cvar95: null,
      beta: null,
      alpha: null,
      infoRatio: null,
      altmanZ: null,
      wEqual: n.wEqual ?? w,
    })),
    allocations: lite.allocations,
    frontier: [],
    headline: lite.headline,
    corr: lite.corr,
    stale: true,
    lite: true,
  };
}

export async function liteRotatePayload(sb: SupabaseClient) {
  const uni = await fetchUniverse(sb);
  const meta = uni
    .filter((u) => u.symbol)
    .map((u) => ({ symbol: u.symbol, sector: u.sector || "Other" }));
  const wanted = uniq([...LIQUID_NAMES, ...meta.map((m) => m.symbol)]).slice(0, 48);
  const prices = await fetchLitePrices(sb, wanted);
  const lite = liteRotateFromPrices(prices, meta.length ? meta : wanted.map((s) => ({ symbol: s, sector: "Other" })));
  const asOf = prices.reduce((mx, r) => (r.date > mx ? r.date : mx), "");
  return {
    summary: {
      names: wanted.length,
      nSectors: lite.corr.labels.length,
      nIndustries: 0,
      regime: lite.regime,
      canaryScore: lite.canaryScore,
      canaryOn: lite.canaryOn,
      canaryOff: lite.canaryOff,
      nTriggers: 0,
      nCarver: 0,
      carverRungs: 0,
      asOfDate: asOf || null,
      leading: 0,
      fading: 0,
      lastRunAt: null,
    },
    sectors: [],
    industries: [],
    canaries: lite.canaries,
    triggers: [],
    carver: [],
    headline: lite.headline,
    config: { lite: true, regime: lite.regime },
    corr: lite.corr,
    stale: true,
    lite: true,
  };
}
