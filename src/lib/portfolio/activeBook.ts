/** Pro Active Trading book: open short-term paper legs, kept off the long-term sliders. */

import {
  annVol,
  cagr,
  maxDrawdown,
  seriesFor,
  sharpe,
  wealth,
  type Holding,
} from "@/lib/portfolio/engine";
import { assetBySymbol } from "@/lib/portfolio/universe";
import {
  combineCapital,
  type CapitalBookTag,
  type CapitalLeg,
  type SleeveCapital,
  type SleeveName,
} from "@/lib/capitalBook";

const SLEEVES: SleeveName[] = ["LOOP", "ORB", "CASH", "ROTATE"];

export type ActiveDesk = {
  sleeve: SleeveName;
  asOf: string | null;
  ran: boolean;
  stale: boolean;
  /** Desk hid new signals. LOOP keeps its open book, so this stays false there. */
  suppressed: boolean;
  open: number;
};

export type ActivePayload = {
  unavailable: boolean;
  desks: ActiveDesk[];
  legs: CapitalLeg[];
};

export type ActiveLine = {
  id: string;
  sleeve: SleeveName;
  book: CapitalBookTag;
  symbol: string;
  side: "LONG" | "SHORT";
  notional: number;
  weight: number;
  asOf: string | null;
  unrealizedPnlUsd: number | null;
  daysHeld: number | null;
  inStudio: boolean;
};

export type ActiveName = {
  symbol: string;
  net: number;
  gross: number;
  weight: number;
  sleeves: SleeveName[];
  inStudio: boolean;
};

export type ActiveRisk = {
  window: "1Y";
  coveredWeight: number;
  outside: string[];
  cagr: number;
  vol: number;
  sharpe: number;
  maxDd: number;
  value: number;
  spark: number[];
};

export type ActiveSleeve = SleeveCapital & { weight: number };

export type ActiveBook = {
  gross: number;
  net: number;
  longGross: number;
  shortGross: number;
  overlap: string[];
  sleeves: ActiveSleeve[];
  lines: ActiveLine[];
  names: ActiveName[];
  pnl: number | null;
  risk: ActiveRisk | null;
};

function tagOf(leg: CapitalLeg): CapitalBookTag {
  if (leg.book) return leg.book;
  if (leg.sleeve === "LOOP") return "loop";
  if (leg.sleeve === "ORB") return "orb";
  if (leg.sleeve === "ROTATE") return "rotate";
  return "tema";
}

function sparkOf(values: number[], n = 36): number[] {
  if (values.length <= n) return values;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (values.length - 1)) / (n - 1));
    out.push(values[idx]);
  }
  return out;
}

export function buildActiveBook(legs: CapitalLeg[]): ActiveBook {
  const live = legs.filter((leg) => leg.symbol && leg.signedNotional !== 0);
  const capital = combineCapital(live);
  const gross = capital.gross;

  const lines: ActiveLine[] = live.map((leg, index) => {
    const notional = leg.signedNotional;
    return {
      id: `${leg.sleeve}-${tagOf(leg)}-${leg.symbol}-${index}`,
      sleeve: leg.sleeve,
      book: tagOf(leg),
      symbol: leg.symbol,
      side: notional < 0 ? "SHORT" : "LONG",
      notional,
      weight: gross > 0 ? (Math.abs(notional) / gross) * 100 : 0,
      asOf: leg.asOf,
      unrealizedPnlUsd: leg.unrealizedPnlUsd ?? null,
      daysHeld: leg.daysHeld ?? null,
      inStudio: !!assetBySymbol(leg.symbol),
    };
  });
  lines.sort(
    (a, b) =>
      Math.abs(b.notional) - Math.abs(a.notional) ||
      a.symbol.localeCompare(b.symbol) ||
      a.book.localeCompare(b.book),
  );

  const bySymbol = new Map<string, ActiveName>();
  for (const line of lines) {
    const row = bySymbol.get(line.symbol) ?? {
      symbol: line.symbol,
      net: 0,
      gross: 0,
      weight: 0,
      sleeves: [],
      inStudio: line.inStudio,
    };
    row.net += line.notional;
    row.gross += Math.abs(line.notional);
    if (!row.sleeves.includes(line.sleeve)) row.sleeves.push(line.sleeve);
    bySymbol.set(line.symbol, row);
  }
  const names = Array.from(bySymbol.values())
    .map((row) => ({
      ...row,
      weight: gross > 0 ? (row.gross / gross) * 100 : 0,
      sleeves: SLEEVES.filter((sleeve) => row.sleeves.includes(sleeve)),
    }))
    .sort((a, b) => b.gross - a.gross || a.symbol.localeCompare(b.symbol));

  const pnlRows = lines.filter((line) => line.unrealizedPnlUsd != null);
  const pnl = pnlRows.length
    ? pnlRows.reduce((sum, line) => sum + (line.unrealizedPnlUsd ?? 0), 0)
    : null;

  const covered = new Map<string, number>();
  const outside = new Set<string>();
  for (const line of lines) {
    if (line.inStudio) covered.set(line.symbol, (covered.get(line.symbol) ?? 0) + Math.abs(line.notional));
    else outside.add(line.symbol);
  }
  const coveredGross = Array.from(covered.values()).reduce((sum, value) => sum + value, 0);
  let risk: ActiveRisk | null = null;
  if (coveredGross > 0) {
    const holdings: Holding[] = Array.from(covered.entries()).map(([symbol, amount]) => ({
      symbol,
      weight: (amount / coveredGross) * 100,
    }));
    const series = seriesFor(holdings, "1Y");
    const path = wealth(series.daily);
    risk = {
      window: "1Y",
      coveredWeight: gross > 0 ? coveredGross / gross : 0,
      outside: Array.from(outside).sort(),
      cagr: cagr(series.daily),
      vol: annVol(series.daily),
      sharpe: sharpe(series.daily),
      maxDd: maxDrawdown(series.daily),
      value: path.length ? path[path.length - 1] : 10_000,
      spark: sparkOf(path),
    };
  }

  return {
    gross,
    net: capital.net,
    longGross: live.reduce((sum, leg) => sum + Math.max(0, leg.signedNotional), 0),
    shortGross: live.reduce((sum, leg) => sum + Math.max(0, -leg.signedNotional), 0),
    overlap: capital.overlap,
    sleeves: capital.sleeves.map((sleeve) => ({
      ...sleeve,
      weight: gross > 0 ? (sleeve.gross / gross) * 100 : 0,
    })),
    lines,
    names,
    pnl,
    risk,
  };
}
