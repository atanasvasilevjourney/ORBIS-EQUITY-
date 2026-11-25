/** Recompute market cap from live price; guard impossible margin combinations. */

import { normalizeMarketCapUsd } from "@/lib/marketCap";

export type MarginSanity = {
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  marginSanityOk: boolean;
  marginNote: string | null;
};

/** Ratios may be 0–1 or 0–100 depending on upstream vendor. */
export function normalizeMarginRatio(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  let x = raw;
  if (Math.abs(x) > 1.5) x = x / 100;
  if (x < -1 || x > 1) return null;
  return x;
}

export function sanitizeMargins(
  gross: number | null | undefined,
  operating: number | null | undefined,
  net: number | null | undefined
): MarginSanity {
  const grossMargin = normalizeMarginRatio(gross);
  let operatingMargin = normalizeMarginRatio(operating);
  const netMargin = normalizeMarginRatio(net);
  let marginNote: string | null = null;

  if (grossMargin != null && operatingMargin != null && operatingMargin > grossMargin + 1e-6) {
    marginNote = "Operating margin exceeded gross margin; operating margin suppressed (likely mixed field or period).";
    operatingMargin = null;
  }
  if (
    grossMargin != null &&
    netMargin != null &&
    netMargin > grossMargin + 1e-6 &&
    operatingMargin == null
  ) {
    marginNote = marginNote ?? "Net margin exceeded gross margin; check upstream margin fields.";
  }

  const marginSanityOk = marginNote == null;
  return {
    grossMargin,
    operatingMargin,
    netMargin,
    marginSanityOk,
    marginNote,
  };
}

export function impliedSharesFromSnapshot(
  snapshotPrice: number | null | undefined,
  snapshotMarketCap: number | null | undefined
): number | null {
  const px = snapshotPrice;
  const mcap = snapshotMarketCap != null ? normalizeMarketCapUsd(snapshotMarketCap) : NaN;
  if (px == null || !Number.isFinite(px) || px <= 0 || !Number.isFinite(mcap) || mcap <= 0) return null;
  return mcap / px;
}

export type RefreshedQuoteFields = {
  price: number | null;
  marketCap: number | null;
  priceAsOf: string | null;
  quoteStale: boolean;
  snapshotPrice: number | null;
  snapshotMarketCap: number | null;
  marketCapImpliedFromPrice: boolean;
};

export function refreshFundamentalQuotes(input: {
  snapshotPrice: number | null;
  snapshotMarketCap: number | null;
  livePrice: number | null;
  quoteAsOf: string | null;
  quoteStale: boolean;
}): RefreshedQuoteFields {
  const snapshotPrice = input.snapshotPrice;
  const snapshotMarketCap = input.snapshotMarketCap;
  const price = input.livePrice ?? snapshotPrice;
  const shares = impliedSharesFromSnapshot(snapshotPrice, snapshotMarketCap);
  let marketCap = snapshotMarketCap;
  let marketCapImpliedFromPrice = false;

  if (price != null && shares != null) {
    const usd = price * shares;
    marketCap = usd;
    marketCapImpliedFromPrice =
      snapshotPrice == null ||
      !Number.isFinite(snapshotPrice) ||
      Math.abs(price - snapshotPrice) / Math.max(snapshotPrice, 1e-9) > 0.005;
  }

  return {
    price,
    marketCap,
    priceAsOf: input.quoteAsOf,
    quoteStale: input.quoteStale,
    snapshotPrice,
    snapshotMarketCap,
    marketCapImpliedFromPrice,
  };
}