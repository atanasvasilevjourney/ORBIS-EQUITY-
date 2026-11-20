/** Format LSE screener market_cap (often millions USD) for display. */

export function normalizeMarketCapUsd(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return NaN;
  if (raw >= 1e9) return raw;
  if (raw >= 1e5) return raw * 1_000;
  if (raw >= 500) return raw * 1_000_000;
  return raw * 1_000_000;
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