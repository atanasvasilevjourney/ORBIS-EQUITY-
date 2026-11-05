/**
 * Pick the scan session from per-symbol latest bars.
 *
 * A single global max(bar_date) drops every name whose last print is even one
 * session behind (partial nightly, or one Yahoo bar dated today).
 */

export const SCAN_STALE_DAYS = 5;
const FUTURE_SLACK_DAYS = 7;
const DAY_MS = 86_400_000;

export type DatedSymbolRow = { symbol: string; bar_date: string };

function utcMs(isoDate: string): number {
  return Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
}

export function selectScanUniverse<T extends DatedSymbolRow>(
  rows: T[]
): { asOfDate: string | null; latest: T[] } {
  if (!rows.length) return { asOfDate: null, latest: [] };

  const bySym = new Map<string, T>();
  for (const row of rows) {
    const prev = bySym.get(row.symbol);
    if (!prev || row.bar_date > prev.bar_date) bySym.set(row.symbol, row);
  }
  const latest = Array.from(bySym.values());
  const dates = latest.map((r) => r.bar_date.slice(0, 10)).sort();
  const median = dates[Math.floor((dates.length - 1) / 2)];
  const cap = utcMs(median) + FUTURE_SLACK_DAYS * DAY_MS;

  let asOfDate = median;
  for (const d of dates) {
    if (utcMs(d) <= cap && d > asOfDate) asOfDate = d;
  }

  const floor = utcMs(asOfDate) - SCAN_STALE_DAYS * DAY_MS;
  const asOfMs = utcMs(asOfDate);
  const kept = latest.filter((r) => {
    const ms = utcMs(r.bar_date);
    return ms >= floor && ms <= asOfMs;
  });
  return { asOfDate, latest: kept };
}
