/** Macro canary votes — same z / EMA-smooth / ±0.25 band as pipeline.compute.canary_math. */

import { ema } from "@/lib/tema";

export const Z_WINDOW = 126;
export const SMOOTH_SPAN = 10;
export const VOTE_BAND = 0.25;
export const SMA_TREND = 200;

export type CanaryVote = {
  name: string;
  pair: string;
  z: number | null;
  smooth: number | null;
  vote: number;
  implication: string;
  proxy: boolean;
  tape: { ratio: number | null; z: number | null; smooth: number | null }[];
};

export type CanaryRegime = {
  regime: string;
  score: number;
  nOn: number;
  nOff: number;
  nFlat: number;
  votes: CanaryVote[];
};

export function rollingZ(series: number[], window = Z_WINDOW): (number | null)[] {
  const n = series.length;
  const out: (number | null)[] = Array(n).fill(null);
  for (let i = window - 1; i < n; i++) {
    const sl = series.slice(i - window + 1, i + 1).filter(Number.isFinite);
    if (sl.length < Math.max(20, Math.floor(window / 3))) continue;
    const mean = sl.reduce((a, b) => a + b, 0) / sl.length;
    const var_ = sl.reduce((a, b) => a + (b - mean) ** 2, 0) / (sl.length - 1);
    const sd = Math.sqrt(var_);
    if (sd <= 0) continue;
    out[i] = (series[i] - mean) / sd;
  }
  return out;
}

export function causalSmooth(z: (number | null)[], span = SMOOTH_SPAN): (number | null)[] {
  const x = z.map((v) => (v == null || !Number.isFinite(v) ? NaN : v));
  const start = x.findIndex(Number.isFinite);
  const out: (number | null)[] = Array(x.length).fill(null);
  if (start < 0) return out;
  const seeded = x.slice(start).map((v, i) => (i === 0 || Number.isFinite(v) ? (Number.isFinite(v) ? v : 0) : 0));
  seeded[0] = x[start];
  const sm = ema(seeded, span);
  for (let i = 0; i < sm.length; i++) {
    out[start + i] = Number.isFinite(x[start + i]) ? sm[i] : null;
  }
  return out;
}

export function voteFromSmooth(smooth: number, invert = false): number {
  if (!Number.isFinite(smooth)) return 0;
  const v = smooth > VOTE_BAND ? 1 : smooth < -VOTE_BAND ? -1 : 0;
  return invert ? -v : v;
}

function lastN<T>(arr: T[], n: number): T[] {
  return arr.length <= n ? arr : arr.slice(arr.length - n);
}

export function ratioCanary(
  num: number[],
  den: number[],
  opts: {
    name: string;
    pair: string;
    invert: boolean;
    implicationOn: string;
    implicationOff: string;
  }
): CanaryVote {
  const n = Math.min(num.length, den.length);
  const empty: CanaryVote = {
    name: opts.name,
    pair: opts.pair,
    z: null,
    smooth: null,
    vote: 0,
    implication: "insufficient history",
    proxy: true,
    tape: [],
  };
  if (n < Z_WINDOW + SMOOTH_SPAN) return empty;
  const a = num.slice(num.length - n);
  const b = den.slice(den.length - n);
  const ratio = a.map((v, i) => (b[i] > 0 ? v / b[i] : NaN));
  const z = rollingZ(ratio);
  const sm = causalSmooth(z);
  const zLast = z[z.length - 1];
  const smLast = sm[sm.length - 1];
  const vote = voteFromSmooth(smLast ?? NaN, opts.invert);
  const tape = lastN(
    ratio.map((r, i) => ({
      ratio: Number.isFinite(r) ? r : null,
      z: z[i],
      smooth: sm[i],
    })),
    80
  );
  return {
    name: opts.name,
    pair: opts.pair,
    z: zLast,
    smooth: smLast,
    vote,
    implication: vote > 0 ? opts.implicationOn : vote < 0 ? opts.implicationOff : "flat",
    proxy: true,
    tape,
  };
}

export function trendCanary(eq: number[]): CanaryVote {
  if (eq.length < SMA_TREND) {
    return {
      name: "SPY/200DMA",
      pair: "UNIV vs SMA200",
      z: null,
      smooth: null,
      vote: 0,
      implication: "insufficient history",
      proxy: true,
      tape: [],
    };
  }
  const sma = eq.slice(-SMA_TREND).reduce((a, b) => a + b, 0) / SMA_TREND;
  const last = eq[eq.length - 1];
  const z = sma > 0 ? last / sma - 1 : 0;
  const vote = last > sma ? 1 : -1;
  return {
    name: "SPY/200DMA",
    pair: "UNIV vs SMA200",
    z,
    smooth: z,
    vote,
    implication: vote > 0 ? "broad trend up" : "broad trend down",
    proxy: true,
    tape: lastN(
      eq.map((v, i) => {
        const w = eq.slice(Math.max(0, i - SMA_TREND + 1), i + 1);
        const m = w.reduce((a, b) => a + b, 0) / w.length;
        const zz = m > 0 ? v / m - 1 : 0;
        return { ratio: v, z: zz, smooth: zz };
      }),
      80
    ),
  };
}

export function scoreRegime(votes: CanaryVote[]): Omit<CanaryRegime, "votes"> & { votes: CanaryVote[] } {
  const score = votes.reduce((a, v) => a + v.vote, 0);
  const nOn = votes.filter((v) => v.vote > 0).length;
  const nOff = votes.filter((v) => v.vote < 0).length;
  const nFlat = votes.filter((v) => v.vote === 0).length;
  let regime = "NEUTRAL";
  if (score >= 3) regime = "STRONG RISK-ON";
  else if (score >= 1) regime = "RISK-ON";
  else if (score <= -3) regime = "STRONG RISK-OFF";
  else if (score <= -1) regime = "RISK-OFF";
  return { regime, score, nOn, nOff, nFlat, votes };
}

export function equityFromCloses(closes: number[][]): number[] {
  if (!closes.length) return [1];
  const n = Math.min(...closes.map((c) => c.length));
  if (n < 2) return [1];
  const eq = [1];
  for (let i = 1; i < n; i++) {
    let acc = 0;
    let k = 0;
    for (const c of closes) {
      const sliced = c.slice(c.length - n);
      if (sliced[i - 1] > 0) {
        acc += sliced[i] / sliced[i - 1] - 1;
        k += 1;
      }
    }
    eq.push(eq[i - 1] * (1 + (k ? acc / k : 0)));
  }
  return eq;
}

export function buildCanaries(baskets: Record<string, number[]>): ReturnType<typeof scoreRegime> {
  const univ = baskets.univ;
  if (!univ) return scoreRegime([]);
  const pairs: [string, string, string, boolean, string, string][] = [
    ["tech", "QQQ/SPY", "TECH/UNIV", false, "growth / tech risk-on", "growth fading"],
    ["disc", "XLY/XLP", "DISC/STAPLES", false, "cyclical appetite", "defensive consumer"],
    ["energy", "XLE/SPY", "ENERGY/UNIV", false, "cyclical / energy lead", "energy lag"],
    ["defensive", "XLU/SPY", "DEFENSIVE/UNIV", true, "risk-on (defensives lag)", "defensive bid"],
    ["financials", "HYG/LQD", "FIN/STAPLES", false, "credit-appetite proxy", "credit-caution proxy"],
  ];
  const denOverride: Record<string, string> = { "XLY/XLP": "staples", "HYG/LQD": "staples" };
  const votes: CanaryVote[] = [];
  for (const [key, name, pair, invert, on, off] of pairs) {
    const num = baskets[key];
    const den = baskets[denOverride[name] ?? "univ"];
    if (!num || !den) continue;
    votes.push(ratioCanary(num, den, { name, pair, invert, implicationOn: on, implicationOff: off }));
  }
  votes.push(trendCanary(univ));
  return scoreRegime(votes);
}
