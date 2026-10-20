/** PB-EMA ribbon edges: EMA200 close + EMA200 high (min/max = band). */

export function ribbonLoHi(
  emaClose: (number | null)[],
  emaHigh: (number | null)[]
): { lo: number; hi: number }[] {
  const n = Math.min(emaClose.length, emaHigh.length);
  const out: { lo: number; hi: number }[] = [];
  for (let i = 0; i < n; i++) {
    const c = emaClose[i];
    const h = emaHigh[i];
    if (c == null || h == null || !Number.isFinite(c) || !Number.isFinite(h)) continue;
    out.push({ lo: Math.min(c, h), hi: Math.max(c, h) });
  }
  return out;
}
