/** Long-only simplex Markowitz — lite QUANT, no SciPy. */

const RF_ANN = 0.04;
const RF_DAILY = RF_ANN / 252;

export function finiteMean(xs: number[]): number | null {
  let s = 0;
  let k = 0;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (Number.isFinite(v)) {
      s += v;
      k += 1;
    }
  }
  return k ? s / k : null;
}

export function finiteVol(xs: number[], mu: number | null): number | null {
  if (mu == null) return null;
  let s = 0;
  let k = 0;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (!Number.isFinite(v)) continue;
    s += (v - mu) ** 2;
    k += 1;
  }
  if (k < 2) return null;
  return Math.sqrt(s / (k - 1)) * Math.sqrt(252);
}

export function lastFinite(xs: number[]): number | null {
  for (let i = xs.length - 1; i >= 0; i--) {
    if (Number.isFinite(xs[i])) return xs[i];
  }
  return null;
}

/** Keep rows where every name is finite — matches pipeline listwise align. */
export function listwiseReturns(rets: number[][]): number[][] {
  if (!rets.length) return [];
  const t = rets[0].length;
  const rows: number[][] = rets.map(() => []);
  for (let i = 0; i < t; i++) {
    let ok = true;
    for (let j = 0; j < rets.length; j++) {
      if (!Number.isFinite(rets[j][i])) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (let j = 0; j < rets.length; j++) rows[j].push(rets[j][i]);
  }
  return rows;
}

export function sampleMu(panel: number[][]): number[] {
  return panel.map((r) => finiteMean(r) ?? 0);
}

export function sampleCov(panel: number[][]): number[][] {
  const n = panel.length;
  const t = n ? panel[0].length : 0;
  const mu = sampleMu(panel);
  const cov: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const den = Math.max(t - 1, 1);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let k = 0; k < t; k++) s += (panel[i][k] - mu[i]) * (panel[j][k] - mu[j]);
      const v = s / den;
      cov[i][j] = v;
      cov[j][i] = v;
    }
  }
  return cov;
}

/** Duchi et al. Euclidean projection onto {w ≥ 0, Σw = 1}. */
export function projectSimplex(v: number[]): number[] {
  const n = v.length;
  if (!n) return [];
  const u = [...v].sort((a, b) => b - a);
  let cssv = 0;
  let rho = -1;
  let theta = 0;
  for (let i = 0; i < n; i++) {
    cssv += u[i];
    const t = (cssv - 1) / (i + 1);
    if (u[i] - t > 0) {
      rho = i;
      theta = t;
    }
  }
  if (rho < 0) return Array(n).fill(1 / n);
  return v.map((x) => Math.max(x - theta, 0));
}

function mul(cov: number[][], w: number[]): number[] {
  return cov.map((row) => row.reduce((s, v, j) => s + v * w[j], 0));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

export function minVarWeights(cov: number[][], steps = 80): number[] {
  const n = cov.length;
  if (n < 1) return [];
  let w = Array(n).fill(1 / n);
  let lr = 0.25;
  for (let s = 0; s < steps; s++) {
    const g = mul(cov, w).map((x) => 2 * x);
    const nxt = projectSimplex(w.map((wi, i) => wi - lr * g[i]));
    const prev = dot(w, mul(cov, w));
    const now = dot(nxt, mul(cov, nxt));
    if (now <= prev) {
      w = nxt;
      lr *= 1.05;
    } else {
      lr *= 0.5;
    }
  }
  return w;
}

export function maxSharpeWeights(mu: number[], cov: number[][], steps = 80): number[] {
  const n = mu.length;
  if (n < 1) return [];
  let w = Array(n).fill(1 / n);
  let lr = 0.15;
  let best = w;
  let bestSh = -Infinity;
  for (let s = 0; s < steps; s++) {
    const portMu = dot(w, mu);
    const sigmaW = mul(cov, w);
    const portVar = Math.max(dot(w, sigmaW), 1e-12);
    const portVol = Math.sqrt(portVar);
    const excess = portMu - RF_DAILY;
    const g = mu.map((m, i) => (portVol * m - (excess * sigmaW[i]) / portVol) / portVar);
    w = projectSimplex(w.map((wi, i) => wi + lr * g[i]));
    const sh = excess / portVol;
    if (sh > bestSh) {
      bestSh = sh;
      best = w;
    }
  }
  return best;
}

export function portfolioStats(w: number[], mu: number[], cov: number[][]): {
  annReturn: number;
  annVol: number;
  sharpe: number;
} {
  const portMu = dot(w, mu);
  const portVar = Math.max(dot(w, mul(cov, w)), 0);
  const annReturn = portMu * 252;
  const annVol = Math.sqrt(portVar) * Math.sqrt(252);
  const sharpe = annVol > 1e-8 ? (annReturn - RF_ANN) / annVol : 0;
  return { annReturn, annVol, sharpe };
}
