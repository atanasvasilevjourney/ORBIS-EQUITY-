/** Format LSE screener market_cap (often millions USD) for display. */

export function normalizeMarketCapUsd(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return NaN;
  if (raw >= 1e9) return raw;
  if (raw >= 1e5) return raw * 1_000;
  if (raw >= 500) return raw * 1_000_000;
  return raw * 1_000_000;
}

const SHARES_MIN = 1e6;
const SHARES_MAX = 25e9;

/** Pick USD market cap whose implied share count is plausible at ``price``. */
export function resolveMarketCapUsd(
  rawMcap: number | null | undefined,
  price: number | null | undefined
): { usd: number | null; sharesImplied: number | null; unit: "as_is" | "thousands" | "millions" | "unknown" } {
  if (rawMcap == null || !Number.isFinite(rawMcap) || rawMcap <= 0) {
    return { usd: null, sharesImplied: null, unit: "unknown" };
  }
  if (price == null || !Number.isFinite(price) || price <= 0) {
    const usd = normalizeMarketCapUsd(rawMcap);
    return Number.isFinite(usd)
      ? { usd, sharesImplied: null, unit: "unknown" }
      : { usd: null, sharesImplied: null, unit: "unknown" };
  }

  const candidates: { usd: number; unit: "as_is" | "thousands" | "millions" }[] = [
    { usd: rawMcap, unit: "as_is" },
    { usd: rawMcap * 1_000, unit: "thousands" },
    { usd: rawMcap * 1_000_000, unit: "millions" },
  ];
  if (rawMcap >= 1e9) {
    candidates.unshift({ usd: rawMcap, unit: "as_is" });
  }

  let best: (typeof candidates)[0] | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (!Number.isFinite(c.usd) || c.usd <= 0) continue;
    const shares = c.usd / price;
    if (shares < SHARES_MIN || shares > SHARES_MAX) continue;
    const score = Math.abs(Math.log10(shares) - 9);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (best) {
    return { usd: best.usd, sharesImplied: best.usd / price, unit: best.unit };
  }

  const fallback = normalizeMarketCapUsd(rawMcap);
  if (!Number.isFinite(fallback)) {
    return { usd: null, sharesImplied: null, unit: "unknown" };
  }
  const shares = fallback / price;
  if (shares >= SHARES_MIN && shares <= SHARES_MAX) {
    return { usd: fallback, sharesImplied: shares, unit: "unknown" };
  }
  return { usd: fallback, sharesImplied: null, unit: "unknown" };
}

export function formatMarketCap(raw: number | null | undefined): string {
  if (raw == null || !Number.isFinite(raw)) return "—";
  const usd = normalizeMarketCapUsd(raw);
  if (!Number.isFinite(usd)) return "—";
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}