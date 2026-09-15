/** Pearson correlation matrix on a T×N return book. */

export type CorrMatrix = {
  labels: string[];
  matrix: (number | null)[][];
};

export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 8) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, k = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    k += 1;
  }
  if (k < 8) return null;
  const cov = sxy / k - (sx / k) * (sy / k);
  const vx = sxx / k - (sx / k) ** 2;
  const vy = syy / k - (sy / k) ** 2;
  const den = Math.sqrt(Math.max(vx, 0) * Math.max(vy, 0));
  if (den <= 1e-12) return null;
  const r = cov / den;
  return Math.max(-1, Math.min(1, r));
}

export function corrMatrix(labels: string[], series: number[][]): CorrMatrix {
  const n = labels.length;
  const matrix: (number | null)[][] = Array.from({ length: n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const r = pearson(series[i], series[j]);
      matrix[i][j] = r;
      matrix[j][i] = r;
    }
  }
  return { labels, matrix };
}

export function parseCorr(raw: unknown): CorrMatrix | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as { labels?: unknown; matrix?: unknown };
  if (!Array.isArray(rec.labels) || !Array.isArray(rec.matrix)) return null;
  const labels = rec.labels.filter((x): x is string => typeof x === "string");
  if (labels.length < 2) return null;
  const matrix = rec.matrix.map((row) =>
    Array.isArray(row)
      ? row.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null))
      : []
  );
  return { labels, matrix };
}

export function dailyReturns(close: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < close.length; i++) {
    const prev = close[i - 1];
    out.push(prev > 0 && Number.isFinite(close[i]) ? close[i] / prev - 1 : 0);
  }
  return out;
}
