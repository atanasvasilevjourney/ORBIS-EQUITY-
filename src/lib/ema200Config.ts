/** Keep in sync with pipeline/ema200_scanner/config/ema200_scanner.yaml universe.supplements */
export const EMA200_SYMBOL_SUPPLEMENTS: string[] = [
  "NBIS", // Nebius — user watch; not in S&P/NDX-100
];

export function ema200SupplementSet(): Set<string> {
  return new Set(EMA200_SYMBOL_SUPPLEMENTS.map((s) => s.toUpperCase()));
}

/** Weekly live Yahoo scans are capped per request (index desks are large). */
export const EMA200_WEEKLY_SYMBOL_CAP = 120;
