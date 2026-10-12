import { evaluateFreshness, type FreshnessVerdict } from "@/lib/freshness";

export function deskFreshnessFromAsOf(asOfDate: string | null | undefined, priceAsOf?: string | null): FreshnessVerdict {
  return evaluateFreshness(asOfDate, priceAsOf);
}

export function legacyStaleFlag(asOfDate: string | null | undefined): boolean {
  return evaluateFreshness(asOfDate).stale;
}
