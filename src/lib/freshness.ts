/** US EOD freshness — calendar dates treated as America/New_York session dates. */

import { isNyseTradingDay } from "@/lib/nyseCalendar";

export function nyCalendarDate(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function nyHour(now = new Date()): number {
  const h = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(h, 10);
}

export function isWeekendIso(iso: string): boolean {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/** Previous NYSE session strictly before ``iso`` (NY calendar date string). */
export function previousTradingDayIso(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (!isNyseTradingDay(d.toISOString().slice(0, 10)));
  return d.toISOString().slice(0, 10);
}

/** Latest EOD session we expect to be ingested (before tonight's job on weekdays). */
export function lastExpectedEodDate(now = new Date()): string {
  let d = nyCalendarDate(now);
  if (!isNyseTradingDay(d) || nyHour(now) < 16) {
    d = previousTradingDayIso(d);
  }
  return d;
}

/**
 * True when ``asOf`` is more than one US trading session behind ``lastExpectedEodDate``.
 * Example: on Monday, Friday's bar is fresh; Thursday is stale.
 */
export function isEodStale(asOf: string | null | undefined, now = new Date()): boolean {
  if (!asOf) return true;
  const a = asOf.slice(0, 10);
  const expected = lastExpectedEodDate(now);
  const floor = previousTradingDayIso(expected);
  return a < floor;
}

export function calendarDaysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T12:00:00Z`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T12:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 999;
  return Math.max(0, Math.round((b - a) / 86400000));
}

export type FreshnessVerdict = {
  stale: boolean;
  signalsSuppressed: boolean;
  expectedEodDate: string;
  minFreshDate: string;
  asOfDate: string | null;
};

export function evaluateFreshness(
  asOfDate: string | null | undefined,
  priceAsOf?: string | null,
  now = new Date()
): FreshnessVerdict {
  const expectedEodDate = lastExpectedEodDate(now);
  const minFreshDate = previousTradingDayIso(expectedEodDate);
  const stale =
    isEodStale(asOfDate, now) || (priceAsOf ? isEodStale(priceAsOf, now) : false);
  return {
    stale,
    signalsSuppressed: stale,
    expectedEodDate,
    minFreshDate,
    asOfDate: asOfDate?.slice(0, 10) ?? null,
  };
}
