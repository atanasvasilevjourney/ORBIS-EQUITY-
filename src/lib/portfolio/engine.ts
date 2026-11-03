/**
 * Portfolio Studio engine.
 * One seeded factor path (Jan 2020–Oct 2026) feeds every module so weights,
 * risk, and scenarios stay internally consistent without a live broker feed.
 */

import {
  CASH,
  CASH_YIELD,
  DEFAULT_HOLDINGS,
  UNIVERSE,
  type Asset,
} from "@/lib/portfolio/universe";

export type WindowId = "6M" | "1Y" | "3Y" | "5Y" | "MAX";
export type SleeveId = "hold" | "equal" | "invvol" | "momentum" | "quality" | "lowbeta" | "barbell";
export type Holding = { symbol: string; weight: number };

export const WINDOWS: { id: WindowId; label: string; days: number }[] = [
  { id: "6M", label: "6M", days: 126 },
  { id: "1Y", label: "1Y", days: 252 },
  { id: "3Y", label: "3Y", days: 756 },
  { id: "5Y", label: "5Y", days: 1260 },
  { id: "MAX", label: "MAX", days: 100_000 },
];

export const SLEEVES: { id: SleeveId; label: string; blurb: string }[] = [
  { id: "hold", label: "Manual", blurb: "Keep the sliders. History is this mix, rebalanced daily." },
  { id: "equal", label: "Equal", blurb: "Same capital in every selected name. Cash stays put." },
  { id: "invvol", label: "Inverse-vol", blurb: "More capital in the quieter names, using a 6-month vol." },
  { id: "momentum", label: "Momentum 12-1", blurb: "Own the top half by the classic 12-month return, skipping the last month." },
  { id: "quality", label: "Quality", blurb: "Tilt toward the higher static quality ranks. Monthly rebalance stops drift." },
  { id: "lowbeta", label: "Low beta", blurb: "Tilt toward names that have moved less than the world proxy." },
  { id: "barbell", label: "Barbell", blurb: "Half inverse-vol, half the four strongest 12-1 names." },
];

const RF = 0.02;
const SAMPLE_START = "2020-01-02";
const SAMPLE_END = "2026-10-30";

export type Market = {
  dates: string[];
  returns: Record<string, number[]>;
  market: number[];
  factors: Record<"smb" | "hml" | "rmw" | "cma" | "wml", number[]>;
};

let cached: Market | null = null;

export function getMarket(): Market {
  if (!cached) cached = buildMarket();
  return cached;
}

export function tradingDays(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d.getTime() <= last.getTime()) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normal(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function regimeShock(date: string): number {
  if (date >= "2020-02-20" && date <= "2020-03-23") return -0.016;
  if (date >= "2020-03-24" && date <= "2020-08-31") return 0.0036;
  if (date >= "2020-09-01" && date <= "2021-12-31") return 0.00055;
  if (date >= "2022-01-03" && date <= "2022-10-14") return -0.00088;
  if (date >= "2023-01-03" && date <= "2024-12-31") return 0.00055;
  if (date >= "2025-02-19" && date <= "2025-04-08") return -0.0028;
  if (date >= "2025-04-09" && date <= "2026-10-30") return 0.00095;
  return 0;
}

function buildMarket(): Market {
  const dates = tradingDays(SAMPLE_START, SAMPLE_END);
  const mktRng = mulberry32(0x0b15);
  const factorRng = {
    smb: mulberry32(0x51b1),
    hml: mulberry32(0x1111),
    rmw: mulberry32(0x2222),
    cma: mulberry32(0x3333),
    wml: mulberry32(0x4444),
  };
  const assetRng = Object.fromEntries(UNIVERSE.map((a) => [a.symbol, mulberry32(hashString(a.symbol) ^ 0xa5a5)]));
  const market: number[] = [];
  const factors = {
    smb: [] as number[],
    hml: [] as number[],
    rmw: [] as number[],
    cma: [] as number[],
    wml: [] as number[],
  };
  const returns: Record<string, number[]> = Object.fromEntries(UNIVERSE.map((a) => [a.symbol, []]));
  const rfDaily = RF / 252;
  const shockScale = 0.08 / Math.sqrt(252);

  for (const date of dates) {
    const mkt =
      rfDaily +
      0.05 / 252 +
      (0.16 / Math.sqrt(252)) * normal(mktRng) +
      regimeShock(date);
    market.push(mkt);
    const f = {
      smb: shockScale * normal(factorRng.smb),
      hml: shockScale * normal(factorRng.hml) + (date >= "2022-01-03" && date <= "2022-10-14" ? 0.0007 : 0),
      rmw: shockScale * normal(factorRng.rmw),
      cma: shockScale * normal(factorRng.cma),
      wml: shockScale * normal(factorRng.wml),
    };
    (Object.keys(factors) as (keyof typeof factors)[]).forEach((k) => factors[k].push(f[k]));
    for (const a of UNIVERSE) {
      const idio = (a.idioVol / Math.sqrt(252)) * normal(assetRng[a.symbol]);
      const r =
        rfDaily +
        a.alpha / 252 +
        a.beta * (mkt - rfDaily) +
        a.smb * f.smb +
        a.hml * f.hml +
        a.rmw * f.rmw +
        a.cma * f.cma +
        a.wml * f.wml +
        idio;
      returns[a.symbol].push(r);
    }
  }
  return { dates, returns, market, factors };
}

const CASH_DAILY = (1 + CASH_YIELD) ** (1 / 252) - 1;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function fixSum(rows: Holding[]): Holding[] {
  if (!rows.length) return rows;
  const rounded = rows.map((r) => ({ ...r, weight: round1(Math.max(0, r.weight)) }));
  let drift = round1(100 - rounded.reduce((s, r) => s + r.weight, 0));
  const order = rounded
    .map((r, i) => ({ i, w: r.weight }))
    .sort((a, b) => b.w - a.w);
  let guard = 0;
  while (Math.abs(drift) >= 0.1 && guard < 20) {
    const target = order[guard % order.length];
    const next = round1(rounded[target.i].weight + (drift > 0 ? 0.1 : -0.1));
    if (next >= 0) {
      rounded[target.i].weight = next;
      drift = round1(drift - (drift > 0 ? 0.1 : -0.1));
    }
    guard += 1;
  }
  return rounded;
}

export function rebalanceHolding(holdings: Holding[], symbol: string, next: number): Holding[] {
  const clamped = round1(clamp(next, 0, 100));
  const others = holdings.filter((h) => h.symbol !== symbol);
  const rest = 100 - clamped;
  const prev = others.reduce((s, h) => s + h.weight, 0);
  const scaled =
    prev <= 0.05
      ? others.map((h) => ({ ...h, weight: others.length ? rest / others.length : 0 }))
      : others.map((h) => ({ ...h, weight: (h.weight / prev) * rest }));
  return fixSum([...scaled, { symbol, weight: clamped }]);
}

export function equalize(holdings: Holding[]): Holding[] {
  if (!holdings.length) return holdings;
  const each = 100 / holdings.length;
  return fixSum(holdings.map((h) => ({ ...h, weight: each })));
}

export function addHolding(holdings: Holding[], symbol: string, take = 5): Holding[] {
  if (holdings.some((h) => h.symbol === symbol)) return holdings;
  const equityCount = holdings.filter((h) => h.symbol !== CASH).length;
  if (symbol !== CASH && equityCount >= 12) return holdings;
  const scale = (100 - take) / 100;
  return fixSum([...holdings.map((h) => ({ ...h, weight: h.weight * scale })), { symbol, weight: take }]);
}

export function removeHolding(holdings: Holding[], symbol: string): Holding[] {
  if (symbol !== CASH && holdings.filter((h) => h.symbol !== CASH).length <= 1) return holdings;
  const next = holdings.filter((h) => h.symbol !== symbol);
  const sum = next.reduce((s, h) => s + h.weight, 0);
  if (sum <= 0) return holdings;
  return fixSum(next.map((h) => ({ ...h, weight: (h.weight / sum) * 100 })));
}

export function holdingsToFractions(holdings: Holding[]): Record<string, number> {
  const sum = holdings.reduce((s, h) => s + h.weight, 0) || 1;
  const out: Record<string, number> = {};
  for (const h of holdings) out[h.symbol] = h.weight / sum;
  return out;
}

function windowBounds(n: number, window: WindowId): { start: number; end: number } {
  const spec = WINDOWS.find((w) => w.id === window)!;
  const len = Math.min(n, spec.days);
  return { start: n - len, end: n };
}

export function sliceWindow<T>(arr: T[], window: WindowId): T[] {
  const { start, end } = windowBounds(arr.length, window);
  return arr.slice(start, end);
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) ** 2;
  return Math.sqrt(v / (xs.length - 1));
}

export function cagr(returns: number[]): number {
  if (!returns.length) return 0;
  let eq = 1;
  for (const r of returns) eq *= 1 + r;
  if (eq <= 0) return -1;
  const years = returns.length / 252;
  return eq ** (1 / years) - 1;
}

export function annVol(returns: number[]): number {
  return stdev(returns) * Math.sqrt(252);
}

export function sharpe(returns: number[]): number {
  const vol = annVol(returns);
  if (vol <= 1e-8) return 0;
  return (cagr(returns) - RF) / vol;
}

export function maxDrawdown(returns: number[]): number {
  let eq = 1;
  let peak = 1;
  let worst = 0;
  for (const r of returns) {
    eq *= 1 + r;
    if (eq > peak) peak = eq;
    const dd = eq / peak - 1;
    if (dd < worst) worst = dd;
  }
  return worst;
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

function betaOf(port: number[], mkt: number[]): number {
  const n = Math.min(port.length, mkt.length);
  if (n < 3) return 0;
  const a = port.slice(0, n);
  const b = mkt.slice(0, n);
  const vb = stdev(b) ** 2;
  if (vb === 0) return 0;
  return (pearson(a, b) * stdev(a) * stdev(b)) / vb;
}

function compoundRange(xs: number[], i0: number, i1: number): number {
  let eq = 1;
  const a = Math.max(0, i0);
  const b = Math.min(xs.length, i1);
  for (let i = a; i < b; i++) eq *= 1 + xs[i];
  return eq - 1;
}

function portOnDay(frac: Record<string, number>, day: number, market: Market): number {
  let r = 0;
  for (const [symbol, w] of Object.entries(frac)) {
    if (w === 0) continue;
    if (symbol === CASH) r += w * CASH_DAILY;
    else r += w * (market.returns[symbol]?.[day] ?? 0);
  }
  return r;
}

export function seriesFor(holdings: Holding[], window: WindowId): { dates: string[]; daily: number[]; world: number[] } {
  const market = getMarket();
  const { start, end } = windowBounds(market.dates.length, window);
  const frac = holdingsToFractions(holdings);
  const dates: string[] = [];
  const daily: number[] = [];
  const world: number[] = [];
  for (let i = start; i < end; i++) {
    dates.push(market.dates[i]);
    daily.push(portOnDay(frac, i, market));
    world.push(market.market[i]);
  }
  return { dates, daily, world };
}

function equitySymbols(holdings: Holding[]): string[] {
  return holdings.filter((h) => h.symbol !== CASH && h.weight >= 0).map((h) => h.symbol).filter((s) => getMarket().returns[s]);
}

function cashFraction(holdings: Holding[]): number {
  const sum = holdings.reduce((s, h) => s + h.weight, 0) || 1;
  return (holdings.find((h) => h.symbol === CASH)?.weight ?? 0) / sum;
}

function monthStarts(dates: string[]): number[] {
  const out = [0];
  for (let i = 1; i < dates.length; i++) {
    if (dates[i].slice(0, 7) !== dates[i - 1].slice(0, 7)) out.push(i);
  }
  return out;
}

function trailingVol(xs: number[], asOf: number, lookback = 126): number {
  const a = Math.max(0, asOf - lookback);
  return annVol(xs.slice(a, asOf));
}

function trailingBeta(xs: number[], mkt: number[], asOf: number, lookback = 252): number {
  const a = Math.max(0, asOf - lookback);
  return betaOf(xs.slice(a, asOf), mkt.slice(a, asOf));
}

function momentum12(xs: number[], asOf: number): number {
  if (asOf < 252) return compoundRange(xs, 0, asOf);
  return compoundRange(xs, asOf - 252, asOf - 21);
}

function normalizePositive(raw: Record<string, number>): Record<string, number> {
  const keys = Object.keys(raw);
  let sum = 0;
  for (const k of keys) sum += Math.max(0, raw[k]);
  const out: Record<string, number> = {};
  if (sum <= 0) {
    const each = keys.length ? 1 / keys.length : 0;
    for (const k of keys) out[k] = each;
    return out;
  }
  for (const k of keys) out[k] = Math.max(0, raw[k]) / sum;
  return out;
}

function fractionsAt(sleeve: SleeveId, symbols: string[], cash: number, asOf: number, market: Market): Record<string, number> {
  const equity = Math.max(0, 1 - cash);
  const out: Record<string, number> = { [CASH]: cash };
  if (!symbols.length || equity <= 0) return out;
  if (sleeve === "hold") return out;

  const score: Record<string, number> = {};
  if (sleeve === "equal") {
    for (const s of symbols) score[s] = 1;
  } else if (sleeve === "invvol") {
    for (const s of symbols) {
      const vol = trailingVol(market.returns[s], asOf);
      score[s] = 1 / Math.max(0.08, vol);
    }
  } else if (sleeve === "quality") {
    for (const s of symbols) score[s] = UNIVERSE.find((a) => a.symbol === s)?.quality ?? 50;
  } else if (sleeve === "lowbeta") {
    for (const s of symbols) {
      const b = trailingBeta(market.returns[s], market.market, asOf);
      score[s] = 1 / Math.max(0.25, b);
    }
  } else if (sleeve === "momentum") {
    const ranked = symbols
      .map((s) => ({ s, m: momentum12(market.returns[s], asOf) }))
      .sort((a, b) => b.m - a.m);
    const k = Math.max(1, Math.ceil(ranked.length / 2));
    for (const s of symbols) score[s] = 0;
    for (const row of ranked.slice(0, k)) score[row.s] = 1;
  } else if (sleeve === "barbell") {
    const inv: Record<string, number> = {};
    for (const s of symbols) inv[s] = 1 / Math.max(0.08, trailingVol(market.returns[s], asOf));
    const invN = normalizePositive(inv);
    const ranked = symbols
      .map((s) => ({ s, m: momentum12(market.returns[s], asOf) }))
      .sort((a, b) => b.m - a.m);
    const top = ranked.slice(0, Math.min(4, ranked.length));
    for (const s of symbols) score[s] = 0.5 * invN[s];
    for (const row of top) score[row.s] += 0.5 / top.length;
  }
  const norm = normalizePositive(score);
  for (const s of symbols) out[s] = equity * (norm[s] ?? 0);
  return out;
}

function holdFractions(holdings: Holding[]): Record<string, number> {
  return holdingsToFractions(holdings);
}

export type Signal = {
  symbol: string;
  name: string;
  momentum: number;
  vol: number;
  beta: number;
  quality: number;
  weight: number;
  action: "OVERWEIGHT" | "LINE" | "UNDERWEIGHT" | "CASH";
};

export function diagnose(holdings: Holding[], sleeve: SleeveId): Signal[] {
  const market = getMarket();
  const asOf = market.dates.length;
  const symbols = equitySymbols(holdings);
  const cash = cashFraction(holdings);
  const target = sleeve === "hold" ? holdFractions(holdings) : fractionsAt(sleeve, symbols, cash, asOf, market);
  const equal = symbols.length ? (1 - cash) / symbols.length : 0;
  const rows: Signal[] = symbols.map((symbol) => {
    const asset = UNIVERSE.find((a) => a.symbol === symbol)!;
    const weight = (target[symbol] ?? 0) * 100;
    const line = equal * 100;
    let action: Signal["action"] = "LINE";
    if (weight > line * 1.25 + 0.4) action = "OVERWEIGHT";
    else if (weight < line * 0.75 - 0.2) action = "UNDERWEIGHT";
    return {
      symbol,
      name: asset.name,
      momentum: momentum12(market.returns[symbol], asOf),
      vol: trailingVol(market.returns[symbol], asOf),
      beta: trailingBeta(market.returns[symbol], market.market, asOf),
      quality: asset.quality,
      weight,
      action,
    };
  });
  if ((target[CASH] ?? 0) > 0 || holdings.some((h) => h.symbol === CASH)) {
    rows.push({
      symbol: CASH,
      name: "Cash",
      momentum: 0,
      vol: 0,
      beta: 0,
      quality: 0,
      weight: (target[CASH] ?? 0) * 100,
      action: "CASH",
    });
  }
  return rows.sort((a, b) => b.weight - a.weight);
}

export function sleeveHoldings(holdings: Holding[], sleeve: SleeveId): Holding[] {
  if (sleeve === "hold") return fixSum(holdings.map((h) => ({ ...h })));
  const signals = diagnose(holdings, sleeve);
  const symbols = new Set(holdings.map((h) => h.symbol));
  const rows = signals.filter((s) => symbols.has(s.symbol)).map((s) => ({ symbol: s.symbol, weight: s.weight }));
  for (const h of holdings) {
    if (!rows.some((r) => r.symbol === h.symbol)) rows.push({ symbol: h.symbol, weight: 0 });
  }
  return fixSum(rows);
}

export type SleeveStat = {
  id: SleeveId;
  total: number;
  sharpe: number;
  maxDd: number;
  spark: number[];
};

export function compareSleeves(holdings: Holding[], window: WindowId): SleeveStat[] {
  const market = getMarket();
  const symbols = equitySymbols(holdings);
  const cash = cashFraction(holdings);
  const starts = monthStarts(market.dates);
  const active: SleeveId[] = ["equal", "invvol", "momentum", "quality", "lowbeta", "barbell"];
  const daily: Record<string, number[]> = {};
  for (const id of active) daily[id] = [];

  for (let m = 0; m < starts.length; m++) {
    const a = starts[m];
    const b = m + 1 < starts.length ? starts[m + 1] : market.dates.length;
    const weights: Record<string, Record<string, number>> = {};
    for (const id of active) weights[id] = fractionsAt(id, symbols, cash, a, market);
    for (let t = a; t < b; t++) {
      for (const id of active) daily[id].push(portOnDay(weights[id], t, market));
    }
  }

  const hold = seriesFor(holdings, "MAX").daily;
  const pack = (id: SleeveId, xs: number[]): SleeveStat => {
    const sliced = sliceWindow(xs, window);
    let eq = 1;
    const path: number[] = [];
    for (const r of sliced) {
      eq *= 1 + r;
      path.push(eq);
    }
    return {
      id,
      total: eq - 1,
      sharpe: sharpe(sliced),
      maxDd: maxDrawdown(sliced),
      spark: downsample(path, 48),
    };
  };
  return [pack("hold", hold), ...active.map((id) => pack(id, daily[id]))];
}

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

export function wealth(returns: number[], start = 10_000): number[] {
  const out: number[] = [];
  let v = start;
  for (const r of returns) {
    v *= 1 + r;
    out.push(v);
  }
  return out;
}

type Episode = { start: string; end: string; depth: number; days: number; trough: string };

function drawdownPath(returns: number[], dates: string[]): { path: number[]; episodes: Episode[]; maxDd: number } {
  let eq = 1;
  let peak = 1;
  let peakIdx = 0;
  let maxDd = 0;
  const path: number[] = [];
  const episodes: Episode[] = [];
  let inDd = false;
  let start = dates[0] ?? "";
  let startIdx = 0;
  let trough = 0;
  let troughDate = dates[0] ?? "";
  for (let i = 0; i < returns.length; i++) {
    eq *= 1 + returns[i];
    if (eq >= peak) {
      if (inDd && trough < -0.004) {
        episodes.push({ start, end: dates[i], depth: trough, days: i - startIdx, trough: troughDate });
      }
      peak = eq;
      peakIdx = i;
      inDd = false;
      trough = 0;
      path.push(0);
    } else {
      const dd = eq / peak - 1;
      if (!inDd) {
        inDd = true;
        start = dates[Math.max(0, peakIdx)];
        startIdx = peakIdx;
        trough = dd;
        troughDate = dates[i];
      } else if (dd < trough) {
        trough = dd;
        troughDate = dates[i];
      }
      if (dd < maxDd) maxDd = dd;
      path.push(dd);
    }
  }
  if (inDd) {
    episodes.push({
      start,
      end: dates[dates.length - 1] ?? start,
      depth: trough,
      days: Math.max(0, returns.length - 1 - startIdx),
      trough: troughDate,
    });
  }
  episodes.sort((a, b) => a.depth - b.depth);
  return { path, episodes: episodes.slice(0, 5), maxDd };
}

function histogram(returns: number[], bins = 28): { x0: number; x1: number; count: number }[] {
  if (!returns.length) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const r of returns) {
    if (r < min) min = r;
    if (r > max) max = r;
  }
  if (min === max) {
    min -= 0.01;
    max += 0.01;
  }
  const width = (max - min) / bins;
  const counts = Array(bins).fill(0);
  for (const r of returns) {
    let idx = Math.floor((r - min) / width);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    counts[idx] += 1;
  }
  return counts.map((count, i) => ({ x0: min + i * width, x1: min + (i + 1) * width, count }));
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function tailStats(returns: number[]): { var95: number; cvar: number; skew: number; exKurt: number; best: number; worst: number; up: number } {
  if (!returns.length) return { var95: 0, cvar: 0, skew: 0, exKurt: 0, best: 0, worst: 0, up: 0 };
  const sorted = returns.slice().sort((a, b) => a - b);
  const var95 = quantile(sorted, 0.05);
  const tail = sorted.filter((r) => r <= var95 + 1e-12);
  const cvar = mean(tail);
  const m = mean(returns);
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let up = 0;
  let best = -Infinity;
  let worst = Infinity;
  for (const r of returns) {
    const d = r - m;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d ** 4;
    if (r > 0) up += 1;
    if (r > best) best = r;
    if (r < worst) worst = r;
  }
  const n = returns.length;
  m2 /= n;
  m3 /= n;
  m4 /= n;
  const sd = Math.sqrt(m2);
  return {
    var95,
    cvar,
    skew: sd > 0 ? m3 / sd ** 3 : 0,
    exKurt: sd > 0 ? m4 / sd ** 4 - 3 : 0,
    best,
    worst,
    up: up / n,
  };
}

function covariance(series: number[][]): number[][] {
  const k = series.length;
  const n = series[0]?.length ?? 0;
  const means = series.map((s) => mean(s));
  const c = Array.from({ length: k }, () => Array(k).fill(0));
  if (n < 2) return c;
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      const da = series[a][i] - means[a];
      for (let b = a; b < k; b++) {
        const v = da * (series[b][i] - means[b]);
        c[a][b] += v;
        if (a !== b) c[b][a] += v;
      }
    }
  }
  for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) c[a][b] /= n - 1;
  return c;
}

function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const a = matrix.map((row, i) => {
    const out = row.slice();
    for (let j = 0; j < n; j++) out.push(i === j ? 1 : 0);
    return out;
  });
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = a[col];
      a[col] = a[pivot];
      a[pivot] = tmp;
    }
    const div = a[col][col];
    for (let j = 0; j < 2 * n; j++) a[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[col][j];
    }
  }
  return a.map((row) => row.slice(n));
}

function ols(y: number[], cols: number[][]): { beta: number[]; se: number[]; r2: number } | null {
  const n = y.length;
  const k = cols.length;
  if (n <= k + 2) return null;
  const xtx = Array.from({ length: k }, () => Array(k).fill(0));
  const xty = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      xty[a] += cols[a][i] * y[i];
      for (let b = a; b < k; b++) {
        const v = cols[a][i] * cols[b][i];
        xtx[a][b] += v;
        if (a !== b) xtx[b][a] += v;
      }
    }
  }
  const inv = invertMatrix(xtx);
  if (!inv) return null;
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0));
  let sse = 0;
  let ybar = mean(y);
  let sst = 0;
  for (let i = 0; i < n; i++) {
    let yhat = 0;
    for (let a = 0; a < k; a++) yhat += beta[a] * cols[a][i];
    const e = y[i] - yhat;
    sse += e * e;
    sst += (y[i] - ybar) ** 2;
  }
  const sigma2 = sse / (n - k);
  const se = inv.map((row, i) => Math.sqrt(Math.max(0, sigma2 * row[i])));
  return { beta, se, r2: sst > 0 ? 1 - sse / sst : 0 };
}

export type Snapshot = {
  dates: string[];
  growth: { date: string; book: number; world: number }[];
  kpis: {
    value: number;
    annReturn: number;
    vol: number;
    beta: number;
    sharpe: number;
    maxDd: number;
    var95: number;
    divScore: number;
    effectiveN: number;
    upDays: number;
  };
  weights: { symbol: string; name: string; weight: number; color: string }[];
  allocation: { label: string; weight: number; color: string }[];
  names: { symbol: string; name: string; weight: number; via: string }[];
  contribution: { symbol: string; color: string; retShare: number; riskShare: number }[];
  countries: { label: string; flag: string; weight: number }[];
  currencies: { label: string; weight: number }[];
  sectors: { label: string; weight: number; color: string }[];
  corr: { symbols: string[]; matrix: number[][] };
  factors: { id: string; beta: number; t: number }[];
  factorMeta: { alpha: number; alphaT: number; r2: number; start: string; end: string; months: number };
  rolling: { date: string; vol: number }[];
  calendar: { year: string; book: number; world: number }[];
  months: { year: number; values: (number | null)[] }[];
  distribution: {
    bins: { x0: number; x1: number; count: number }[];
    var95: number;
    cvar: number;
    skew: number;
    exKurt: number;
    best: number;
    worst: number;
    up: number;
  };
  drawdown: { date: string; dd: number }[];
  episodes: { start: string; end: string; depth: number; days: number }[];
  scatter: { symbol: string; vol: number; ret: number; color: string }[];
  you: { vol: number; ret: number; sharpe: number };
  world: { vol: number; ret: number };
  scenarios: {
    id: string;
    title: string;
    range: string;
    total: number;
    worstDay: number;
    note: string;
    path: number[];
  }[];
  window: { start: string; end: string; days: number };
  largest: { symbol: string; weight: number };
  topCountry: { label: string; weight: number };
  daily: number[];
};

function assetOf(symbol: string): Asset | undefined {
  return UNIVERSE.find((a) => a.symbol === symbol);
}

function monthlyCompound(returns: number[], dates: string[]): Map<string, number> {
  const buckets = new Map<string, number>();
  for (let i = 0; i < returns.length; i++) {
    const key = dates[i].slice(0, 7);
    buckets.set(key, (buckets.get(key) ?? 1) * (1 + returns[i]));
  }
  const out = new Map<string, number>();
  buckets.forEach((v, k) => out.set(k, v - 1));
  return out;
}

export function buildSnapshot(holdings: Holding[], window: WindowId): Snapshot {
  if (!holdings.length) holdings = DEFAULT_HOLDINGS;
  const market = getMarket();
  const { dates, daily, world } = seriesFor(holdings, window);
  const bookWealth = wealth(daily);
  const worldWealth = wealth(world);
  const growthIdx = downsample(
    dates.map((_, i) => i),
    180,
  );
  const growth = growthIdx.map((i) => ({ date: dates[i], book: bookWealth[i], world: worldWealth[i] }));
  const symbols = equitySymbols(holdings);
  const frac = holdingsToFractions(holdings);
  const { start } = windowBounds(market.dates.length, window);

  const assetWindow: Record<string, number[]> = {};
  for (const s of symbols) assetWindow[s] = market.returns[s].slice(start);

  const tails = tailStats(daily);
  const dd = drawdownPath(daily, dates);
  const kpis = {
    value: bookWealth[bookWealth.length - 1] ?? 10_000,
    annReturn: cagr(daily),
    vol: annVol(daily),
    beta: betaOf(daily, world),
    sharpe: sharpe(daily),
    maxDd: dd.maxDd,
    var95: tails.var95,
    divScore: 0,
    effectiveN: 0,
    upDays: tails.up,
  };

  const corrMatrix = symbols.map((a) => symbols.map((b) => (a === b ? 1 : pearson(assetWindow[a], assetWindow[b]))));
  const equityWeights = symbols.map((s) => frac[s] ?? 0);
  const equitySum = equityWeights.reduce((s, w) => s + w, 0);
  if (symbols.length > 1 && equitySum > 0) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < symbols.length; i++) {
      for (let j = 0; j < symbols.length; j++) {
        if (i === j) continue;
        const ww = equityWeights[i] * equityWeights[j];
        num += ww * corrMatrix[i][j];
        den += ww;
      }
    }
    kpis.divScore = den > 0 ? Math.round(clamp((1 - num / den) * 100, 0, 100)) : 0;
  }
  const renorm = equitySum > 0 ? equityWeights.map((w) => w / equitySum) : [];
  const hhi = renorm.reduce((s, w) => s + w * w, 0);
  kpis.effectiveN = hhi > 0 ? 1 / hhi : 0;

  const weights = [...holdings]
    .sort((a, b) => b.weight - a.weight)
    .map((h) => ({
      symbol: h.symbol,
      name: h.symbol === CASH ? "Cash" : assetOf(h.symbol)?.name ?? h.symbol,
      weight: h.weight,
      color: h.symbol === CASH ? "#6b7280" : assetOf(h.symbol)?.color ?? "#60a5fa",
    }));

  const sectorMap = new Map<string, number>();
  const countryMap = new Map<string, { label: string; flag: string; weight: number }>();
  const currencyMap = new Map<string, number>();
  for (const h of holdings) {
    if (h.symbol === CASH) {
      sectorMap.set("Cash", (sectorMap.get("Cash") ?? 0) + h.weight);
      const prev = countryMap.get("Cash") ?? { label: "Cash", flag: "", weight: 0 };
      prev.weight += h.weight;
      countryMap.set("Cash", prev);
      currencyMap.set("USD", (currencyMap.get("USD") ?? 0) + h.weight);
      continue;
    }
    const a = assetOf(h.symbol);
    if (!a) continue;
    sectorMap.set(a.sector, (sectorMap.get(a.sector) ?? 0) + h.weight);
    const prev = countryMap.get(a.country) ?? { label: a.country, flag: "", weight: 0 };
    prev.weight += h.weight;
    countryMap.set(a.country, prev);
    currencyMap.set(a.currency, (currencyMap.get(a.currency) ?? 0) + h.weight);
  }
  const allocation = Array.from(sectorMap.entries())
    .map(([label, weight]) => ({
      label,
      weight,
      color: label === "Cash" ? "#6b7280" : sectorColor(label),
    }))
    .sort((a, b) => b.weight - a.weight);

  const names = weights
    .filter((w) => w.symbol !== CASH)
    .map((w) => {
      const a = assetOf(w.symbol);
      return { symbol: w.symbol, name: w.name, weight: w.weight, via: a ? `${a.countryCode}` : "" };
    });

  const parts = symbols.map((s) => ({
    symbol: s,
    color: assetOf(s)?.color ?? "#60a5fa",
    raw: (frac[s] ?? 0) * cagr(assetWindow[s]),
  }));
  parts.push({ symbol: CASH, color: "#6b7280", raw: (frac[CASH] ?? 0) * CASH_YIELD });
  const partSum = parts.reduce((s, p) => s + p.raw, 0);
  const cov = symbols.length ? covariance(symbols.map((s) => assetWindow[s])) : [];
  const wEq = equityWeights;
  const sigmaW = wEq.map((_, i) => wEq.reduce((s, w, j) => s + cov[i][j] * w, 0));
  const portVar = wEq.reduce((s, w, i) => s + w * sigmaW[i], 0);
  const contribution = parts
    .filter((p) => (p.symbol === CASH ? (frac[CASH] ?? 0) > 0 : true))
    .map((p) => {
      let riskShare = 0;
      if (p.symbol !== CASH && portVar > 0) {
        const i = symbols.indexOf(p.symbol);
        riskShare = (wEq[i] * sigmaW[i]) / portVar;
      }
      return {
        symbol: p.symbol,
        color: p.color,
        retShare: partSum !== 0 ? p.raw / partSum : 0,
        riskShare,
      };
    });

  const countries = Array.from(countryMap.values()).sort((a, b) => b.weight - a.weight);
  for (const row of countries) {
    if (row.label === "Cash") continue;
    const code = UNIVERSE.find((a) => a.country === row.label)?.countryCode ?? "";
    row.flag = code;
  }
  const currencies = Array.from(currencyMap.entries())
    .map(([label, weight]) => ({ label, weight }))
    .sort((a, b) => b.weight - a.weight);
  const invested = holdings.filter((h) => h.symbol !== CASH).reduce((s, h) => s + h.weight, 0) || 1;
  const sectors = Array.from(sectorMap.entries())
    .filter(([label]) => label !== "Cash")
    .map(([label, weight]) => ({ label, weight: (weight / invested) * 100, color: sectorColor(label) }))
    .sort((a, b) => b.weight - a.weight);

  const rfDaily = RF / 252;
  const y = daily.map((r, i) => r - rfDaily);
  const ones = y.map(() => 1);
  const mktCol = world.map((r, i) => r - rfDaily);
  const fStart = start;
  const cols = [
    ones,
    mktCol,
    market.factors.smb.slice(fStart),
    market.factors.hml.slice(fStart),
    market.factors.rmw.slice(fStart),
    market.factors.cma.slice(fStart),
    market.factors.wml.slice(fStart),
  ];
  const fit = ols(y, cols);
  const ids = ["MKT", "SMB", "HML", "RMW", "CMA", "WML"];
  const factors = ids.map((id, i) => {
    const b = fit?.beta[i + 1] ?? 0;
    const se = fit?.se[i + 1] ?? 0;
    return { id, beta: b, t: se > 0 ? b / se : 0 };
  });
  const factorMeta = {
    alpha: (fit?.beta[0] ?? 0) * 252,
    alphaT: fit && fit.se[0] > 0 ? fit.beta[0] / fit.se[0] : 0,
    r2: fit?.r2 ?? 0,
    start: dates[0] ?? "",
    end: dates[dates.length - 1] ?? "",
    months: Math.round(dates.length / 21),
  };

  const rolling: { date: string; vol: number }[] = [];
  const rollDates = seriesFor(holdings, "MAX");
  for (let i = 126; i < rollDates.daily.length; i += 5) {
    rolling.push({ date: rollDates.dates[i], vol: annVol(rollDates.daily.slice(i - 125, i + 1)) });
  }

  const bookMonths = monthlyCompound(daily, dates);
  const worldMonths = monthlyCompound(world, dates);
  const years = new Set<string>();
  bookMonths.forEach((_v, key) => years.add(key.slice(0, 4)));
  const yearList = Array.from(years).sort();
  const calendar = yearList.map((year) => {
    let b = 1;
    let w = 1;
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, "0")}`;
      if (bookMonths.has(key)) b *= 1 + (bookMonths.get(key) ?? 0);
      if (worldMonths.has(key)) w *= 1 + (worldMonths.get(key) ?? 0);
    }
    return { year, book: b - 1, world: w - 1 };
  });
  const months = yearList.map((year) => ({
    year: Number(year),
    values: Array.from({ length: 12 }, (_, i) => {
      const key = `${year}-${String(i + 1).padStart(2, "0")}`;
      return bookMonths.has(key) ? bookMonths.get(key)! : null;
    }),
  }));

  const scatter = symbols.map((s) => ({
    symbol: s,
    vol: annVol(assetWindow[s]),
    ret: cagr(assetWindow[s]),
    color: assetOf(s)?.color ?? "#60a5fa",
  }));

  const scenarios = [
    scenario(market, frac, "covid", "COVID crash", "2020-02-14", "2020-03-23", "Fastest equity drawdown in the sample. There is no bond sleeve, so the book takes the hit in full."),
    scenario(market, frac, "rates", "2022 rate selloff", "2022-01-04", "2022-10-14", "A long grind. High-beta growth gives back more than the world proxy; cash is the only ballast."),
    scenario(market, frac, "spring25", "Spring 2025 drawdown", "2025-02-19", "2025-04-08", "A short risk-off in the path. Depth follows the beta you hold today."),
  ];

  const largest = names[0] ?? { symbol: "—", weight: 0 };
  const topGeo = countries.find((c) => c.label !== "Cash") ?? { label: "—", weight: 0 };

  return {
    dates,
    growth,
    kpis,
    weights,
    allocation,
    names,
    contribution,
    countries,
    currencies,
    sectors,
    corr: { symbols, matrix: corrMatrix },
    factors,
    factorMeta,
    rolling: downsample(rolling, 160),
    calendar,
    months,
    distribution: { bins: histogram(daily), ...tails },
    drawdown: downsample(
      dd.path.map((v, i) => ({ date: dates[i], dd: v })),
      180,
    ),
    episodes: dd.episodes.map(({ start: s, end, depth, days }) => ({ start: s, end, depth, days })),
    scatter,
    you: { vol: kpis.vol, ret: kpis.annReturn, sharpe: kpis.sharpe },
    world: { vol: annVol(world), ret: cagr(world) },
    scenarios,
    window: { start: dates[0] ?? "", end: dates[dates.length - 1] ?? "", days: dates.length },
    largest: { symbol: largest.symbol, weight: largest.weight },
    topCountry: { label: topGeo.label, weight: topGeo.weight },
    daily,
  };
}

function sectorColor(label: string): string {
  const map: Record<string, string> = {
    "Information Technology": "#3b82f6",
    Financials: "#34d399",
    "Health Care": "#f472b6",
    Industrials: "#a78bfa",
    "Consumer Discretionary": "#f59e0b",
    "Communication Services": "#2dd4bf",
    Energy: "#fb7185",
    "Consumer Staples": "#fbbf24",
    Materials: "#38bdf8",
  };
  return map[label] ?? "#60a5fa";
}

function scenario(
  market: Market,
  frac: Record<string, number>,
  id: string,
  title: string,
  from: string,
  to: string,
  note: string,
): Snapshot["scenarios"][number] {
  const i0 = market.dates.findIndex((d) => d >= from);
  let i1 = market.dates.findIndex((d) => d > to);
  if (i1 < 0) i1 = market.dates.length;
  const path: number[] = [];
  let eq = 1;
  let worst = 0;
  if (i0 >= 0) {
    for (let i = i0; i < i1; i++) {
      const r = portOnDay(frac, i, market);
      if (r < worst) worst = r;
      eq *= 1 + r;
      path.push(eq);
    }
  }
  return {
    id,
    title,
    range: `${from} → ${to}`,
    total: path.length ? path[path.length - 1] - 1 : 0,
    worstDay: worst,
    note,
    path: downsample(path, 40),
  };
}

export type FrontierPoint = { vol: number; ret: number; sharpe: number; weights: Record<string, number> };

export function sampleFrontier(holdings: Holding[], window: WindowId, seed: number, n = 420): FrontierPoint[] {
  const market = getMarket();
  const symbols = equitySymbols(holdings);
  if (symbols.length < 2) return [];
  const { start, end } = windowBounds(market.dates.length, window);
  const series = symbols.map((s) => market.returns[s].slice(start, end));
  const cash = cashFraction(holdings);
  const equity = 1 - cash;
  const rng = mulberry32(seed || 1);
  const points: FrontierPoint[] = [];
  for (let i = 0; i < n; i++) {
    const draws = symbols.map(() => -Math.log(Math.max(rng(), 1e-12)));
    const sum = draws.reduce((s, v) => s + v, 0);
    const weights: Record<string, number> = { [CASH]: cash };
    const daily: number[] = Array(series[0].length).fill(CASH_DAILY * cash);
    symbols.forEach((s, k) => {
      const w = equity * (draws[k] / sum);
      weights[s] = w;
      const col = series[k];
      for (let t = 0; t < col.length; t++) daily[t] += w * col[t];
    });
    const vol = annVol(daily);
    const ret = cagr(daily);
    points.push({ vol, ret, sharpe: vol > 0 ? (ret - RF) / vol : 0, weights });
  }
  return points;
}

export function frontierAtVol(points: FrontierPoint[], vol: number): FrontierPoint | null {
  if (!points.length) return null;
  let best = points[0];
  let gap = Math.abs(points[0].vol - vol);
  for (const p of points) {
    const g = Math.abs(p.vol - vol);
    if (g < gap) {
      best = p;
      gap = g;
    }
  }
  return best;
}

export function applyFrontier(holdings: Holding[], weights: Record<string, number>): Holding[] {
  const rows = holdings.map((h) => ({ symbol: h.symbol, weight: (weights[h.symbol] ?? 0) * 100 }));
  return fixSum(rows);
}

export type MonteCarlo = {
  bands: { p5: number; p25: number; p50: number; p75: number; p95: number }[];
  p5: number;
  median: number;
  p95: number;
  mean: number;
  contributed: number;
};

export function projectMonteCarlo(daily: number[], years: number, seed: number, paths = 180): MonteCarlo {
  const rng = mulberry32(seed || 1);
  const steps = Math.max(21, Math.round(years * 252));
  const checkpoints = 36;
  const stride = Math.max(1, Math.floor(steps / checkpoints));
  const pointCount = Math.floor(steps / stride);
  const cols: number[][] = Array.from({ length: pointCount }, () => []);
  const terminals: number[] = [];
  const n = daily.length || 1;
  const source = daily.length ? daily : [0];
  for (let p = 0; p < paths; p++) {
    let eq = 10_000;
    let pi = 0;
    for (let s = 1; s <= steps; s++) {
      eq *= 1 + source[Math.floor(rng() * n) % source.length];
      if (s % stride === 0 && pi < pointCount) {
        cols[pi].push(eq);
        pi += 1;
      }
    }
    terminals.push(eq);
  }
  const sorted = terminals.slice().sort((a, b) => a - b);
  const meanV = mean(terminals);
  return {
    bands: cols.map((col) => {
      const s = col.slice().sort((a, b) => a - b);
      return { p5: quantile(s, 0.05), p25: quantile(s, 0.25), p50: quantile(s, 0.5), p75: quantile(s, 0.75), p95: quantile(s, 0.95) };
    }),
    p5: quantile(sorted, 0.05),
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    mean: meanV,
    contributed: meanV - 10_000,
  };
}

export function layoutTreemap(
  items: { key: string; value: number }[],
  x: number,
  y: number,
  w: number,
  h: number,
): { key: string; value: number; x: number; y: number; w: number; h: number }[] {
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const out: { key: string; value: number; x: number; y: number; w: number; h: number }[] = [];
  const rec = (list: { key: string; value: number }[], rx: number, ry: number, rw: number, rh: number) => {
    if (!list.length || rw <= 0 || rh <= 0) return;
    if (list.length === 1) {
      out.push({ ...list[0], x: rx, y: ry, w: rw, h: rh });
      return;
    }
    const sum = list.reduce((s, it) => s + it.value, 0);
    let acc = 0;
    let i = 0;
    while (i < list.length - 1 && acc < sum / 2) {
      acc += list[i].value;
      i += 1;
    }
    i = Math.max(1, Math.min(i, list.length - 1));
    const a = list.slice(0, i);
    const b = list.slice(i);
    const aSum = a.reduce((s, it) => s + it.value, 0);
    const frac = aSum / sum;
    if (rw >= rh) {
      const aw = rw * frac;
      rec(a, rx, ry, aw, rh);
      rec(b, rx + aw, ry, rw - aw, rh);
    } else {
      const ah = rh * frac;
      rec(a, rx, ry, rw, ah);
      rec(b, rx, ry + ah, rw, rh - ah);
    }
  };
  rec(sorted, x, y, w, h);
  return out;
}

export { DEFAULT_HOLDINGS };
