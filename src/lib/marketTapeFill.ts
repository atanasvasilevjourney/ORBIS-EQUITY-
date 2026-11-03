/** Fill index and mega-cap quotes when they are absent from prices_daily. */

import type { PricePoint } from "@/lib/liteDesks";
import { fetchYahooDaily, type YahooDailyBar } from "@/lib/yahooDaily";

export function symbolsMissingFromTape(prices: PricePoint[], symbols: string[]): string[] {
  const have = new Set(prices.map((row) => row.symbol));
  const missing: string[] = [];
  for (const symbol of symbols) {
    if (!have.has(symbol) && !missing.includes(symbol)) missing.push(symbol);
  }
  return missing;
}

/** Symbols with no bar, or whose newest bar is older than `minDate` (YYYY-MM-DD). */
export function symbolsBehind(prices: PricePoint[], symbols: string[], minDate: string): string[] {
  const latest = new Map<string, string>();
  for (const row of prices) {
    const prev = latest.get(row.symbol);
    if (!prev || row.date > prev) latest.set(row.symbol, row.date);
  }
  const behind: string[] = [];
  for (const symbol of symbols) {
    if (behind.includes(symbol)) continue;
    if ((latest.get(symbol) ?? "") < minDate) behind.push(symbol);
  }
  return behind;
}

export function barsToPoints(symbol: string, bars: YahooDailyBar[]): PricePoint[] {
  return bars
    .filter((bar) => Number.isFinite(bar.close) && bar.date)
    .map((bar) => ({
      symbol,
      date: bar.date.slice(0, 10),
      close: bar.close,
    }));
}

/** Desk rows win on the same symbol and session. */
export function mergePricePoints(primary: PricePoint[], fill: PricePoint[]): PricePoint[] {
  const seen = new Set(primary.map((row) => `${row.symbol}|${row.date}`));
  const extra = fill.filter((row) => !seen.has(`${row.symbol}|${row.date}`));
  return [...primary, ...extra];
}

export async function fillMissingTape(
  prices: PricePoint[],
  symbols: string[],
  load?: (symbol: string) => Promise<YahooDailyBar[]>,
  minDate?: string
): Promise<{ prices: PricePoint[]; filled: string[] }> {
  const fetcher = load ?? ((symbol: string) => fetchYahooDaily(symbol, "6mo"));
  const missing = minDate ? symbolsBehind(prices, symbols, minDate) : symbolsMissingFromTape(prices, symbols);
  if (!missing.length) return { prices, filled: [] };

  const batches = await Promise.all(
    missing.map(async (symbol) => {
      try {
        const bars = await fetcher(symbol);
        return { symbol, points: barsToPoints(symbol, bars) };
      } catch {
        return { symbol, points: [] as PricePoint[] };
      }
    })
  );

  const filled = batches.filter((batch) => batch.points.length > 0).map((batch) => batch.symbol);
  return {
    prices: mergePricePoints(
      prices,
      batches.flatMap((batch) => batch.points)
    ),
    filled,
  };
}
