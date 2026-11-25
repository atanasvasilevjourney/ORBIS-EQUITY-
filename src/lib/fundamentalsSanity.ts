/** Recompute market cap from live price; guard impossible margin combinations. */

import { normalizeMarketCapUsd, resolveMarketCapUsd } from "@/lib/marketCap";

export type MarginSanity = {
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  marginSanityOk: boolean;
  marginNote: string | null;
};

export const PE_RATIO_MAX_SANE = 250;
export const PE_RATIO_MIN_SANE = 0;

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

export function sanitizePeRatio(pe: number | null | undefined): number | null {
  if (pe == null || !Number.isFinite(pe)) return null;
  if (pe <= PE_RATIO_MIN_SANE || pe > PE_RATIO_MAX_SANE) return null;
  return pe;
}

export function impliedSharesFromSnapshot(
  snapshotPrice: number | null | undefined,
  snapshotMarketCap: number | null | undefined
): number | null {
  const resolved = resolveMarketCapUsd(snapshotMarketCap, snapshotPrice);
  return resolved.sharesImplied;
}

export type RefreshedQuoteFields = {
  price: number | null;
  marketCap: number | null;
  priceAsOf: string | null;
  quoteStale: boolean;
  snapshotPrice: number | null;
  snapshotMarketCap: number | null;
  marketCapImpliedFromPrice: boolean;
  priceVendorMismatch: boolean;
  sharesImplied: number | null;
  marketCapUnit: string | null;
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
  const tapePrice = input.livePrice;

  let priceVendorMismatch = false;
  let price: number | null = tapePrice ?? snapshotPrice;

  if (
    tapePrice != null &&
    snapshotPrice != null &&
    snapshotPrice > 0 &&
    Math.abs(tapePrice - snapshotPrice) / snapshotPrice > 0.15
  ) {
    priceVendorMismatch = true;
    price = tapePrice;
  }

  const snapResolved = resolveMarketCapUsd(snapshotMarketCap, snapshotPrice ?? price);
  let mcapUsd = snapResolved.usd;
  let marketCapImpliedFromPrice = false;

  if (
    mcapUsd != null &&
    price != null &&
    snapshotPrice != null &&
    snapshotPrice > 0 &&
    tapePrice != null
  ) {
    mcapUsd = mcapUsd * (tapePrice / snapshotPrice);
    marketCapImpliedFromPrice = Math.abs(tapePrice - snapshotPrice) / snapshotPrice > 0.005;
  } else if (mcapUsd != null && price != null && snapResolved.sharesImplied != null) {
    mcapUsd = price * snapResolved.sharesImplied;
    marketCapImpliedFromPrice = tapePrice != null;
  }

  const sharesImplied =
    mcapUsd != null && price != null && price > 0 ? mcapUsd / price : snapResolved.sharesImplied;

  return {
    price,
    marketCap: mcapUsd,
    priceAsOf: input.quoteAsOf,
    quoteStale: input.quoteStale,
    snapshotPrice,
    snapshotMarketCap,
    marketCapImpliedFromPrice,
    priceVendorMismatch,
    sharesImplied,
    marketCapUnit: snapResolved.unit,
  };
}