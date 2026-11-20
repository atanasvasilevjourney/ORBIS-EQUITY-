/** Nearby earnings calendar. Desk rows win; Nasdaq fills the sessions the desk does not have. */

import { cachedYahooJson } from "@/lib/yahooCache";
import { nyCalendarDate } from "@/lib/freshness";
import { isNyseTradingDay } from "@/lib/nyseCalendar";
import type { BriefNewsItem } from "@/lib/briefNews";

export type EarningsSource = "desk" | "nasdaq";

export type EarningsEvent = {
  ticker: string;
  name: string | null;
  eventDate: string;
  confirmed: boolean;
  epsEst: number | null;
  epsActual: number | null;
  surprisePct: number | null;
  marketCap: number | null;
  revenueEst: number | null;
  revenueActual: number | null;
  source: EarningsSource;
};

export type EarningsSummary = {
  beats: number;
  misses: number;
  upcoming: number;
  reported: number;
  avgSurprise: number;
  source: "desk" | "nasdaq" | "mixed" | "none";
};

export type DeskEarningsRow = {
  ticker?: string | null;
  event_date?: string | null;
  confirmed?: boolean | null;
  eps_est?: number | null;
  eps_actual?: number | null;
  surprise_pct?: number | null;
  revenue_est?: number | null;
  revenue_actual?: number | null;
};

type NasdaqRow = {
  symbol?: string;
  name?: string;
  eps?: string;
  epsForecast?: string;
  surprise?: string;
  marketCap?: string;
};

function finite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseUsd(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "N/A" || trimmed === "--") return null;
  const negative = trimmed.startsWith("(") || trimmed.startsWith("-");
  const n = Number(trimmed.replace(/[$,()]/g, "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

function tickerOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase().replace("/", ".");
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)) return null;
  return symbol;
}

function shiftTradingDay(iso: string, step: number): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  let left = Math.abs(step);
  const dir = step >= 0 ? 1 : -1;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + dir);
    if (isNyseTradingDay(date.toISOString().slice(0, 10))) left -= 1;
  }
  return date.toISOString().slice(0, 10);
}

/** Today (or the next session) plus a few reported sessions and a few upcoming ones. */
export function calendarDates(today: string, past = 4, future = 3): string[] {
  const anchor = isNyseTradingDay(today) ? today : shiftTradingDay(today, 1);
  const dates = [anchor];
  for (let i = 1; i <= past; i += 1) dates.push(shiftTradingDay(anchor, -i));
  for (let i = 1; i <= future; i += 1) dates.push(shiftTradingDay(anchor, i));
  return dates.sort();
}

export function eventsFromDesk(rows: DeskEarningsRow[]): EarningsEvent[] {
  const out: EarningsEvent[] = [];
  for (const row of rows) {
    const ticker = tickerOf(row.ticker);
    const eventDate = typeof row.event_date === "string" ? row.event_date.slice(0, 10) : "";
    if (!ticker || !eventDate) continue;
    const epsActual = finite(row.eps_actual);
    out.push({
      ticker,
      name: null,
      eventDate,
      confirmed: row.confirmed === true || epsActual != null,
      epsEst: finite(row.eps_est),
      epsActual,
      surprisePct: finite(row.surprise_pct),
      marketCap: null,
      revenueEst: finite(row.revenue_est),
      revenueActual: finite(row.revenue_actual),
      source: "desk",
    });
  }
  return out;
}

export function eventsFromNasdaq(date: string, rows: unknown[]): EarningsEvent[] {
  const out: EarningsEvent[] = [];
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const row = raw as NasdaqRow;
    const ticker = tickerOf(row.symbol);
    if (!ticker) continue;
    const epsActual = parseUsd(row.eps);
    const epsEst = parseUsd(row.epsForecast);
    const surprise = finite(row.surprise);
    const computed =
      surprise == null && epsActual != null && epsEst != null && epsEst !== 0
        ? ((epsActual - epsEst) / Math.abs(epsEst)) * 100
        : surprise;
    out.push({
      ticker,
      name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : null,
      eventDate: date.slice(0, 10),
      confirmed: epsActual != null,
      epsEst,
      epsActual,
      surprisePct: computed == null ? null : Math.round(computed * 100) / 100,
      marketCap: parseUsd(row.marketCap),
      revenueEst: null,
      revenueActual: null,
      source: "nasdaq",
    });
  }
  return out;
}

/** Desk print wins when both sources have the same ticker and session. */
export function mergeEarnings(desk: EarningsEvent[], live: EarningsEvent[]): EarningsEvent[] {
  const seen = new Set(desk.map((row) => `${row.ticker}|${row.eventDate}`));
  return [...desk, ...live.filter((row) => !seen.has(`${row.ticker}|${row.eventDate}`))];
}

export function isUpcoming(row: EarningsEvent, today: string): boolean {
  return !row.confirmed && row.eventDate >= today;
}

/** Large listings, plus any row the desk already stored. */
export function liquidEarnings(events: EarningsEvent[], minCap = 5_000_000_000): EarningsEvent[] {
  return events.filter((row) => row.source === "desk" || (row.marketCap ?? 0) >= minCap);
}

export function summarizeEarnings(events: EarningsEvent[], today = nyCalendarDate()): EarningsSummary {
  const upcoming = events.filter((row) => isUpcoming(row, today));
  const reported = events.filter((row) => !isUpcoming(row, today));
  const surprises = reported
    .map((row) => row.surprisePct)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const beats = surprises.filter((value) => value > 0).length;
  const misses = surprises.filter((value) => value < 0).length;
  const origins = new Set(events.map((row) => row.source));
  const source =
    origins.size === 0 ? "none" : origins.size > 1 ? "mixed" : origins.has("desk") ? "desk" : "nasdaq";
  const avg =
    surprises.length > 0
      ? Math.round((surprises.reduce((sum, value) => sum + value, 0) / surprises.length) * 10) / 10
      : 0;
  return {
    beats,
    misses,
    upcoming: upcoming.length,
    reported: reported.length,
    avgSurprise: avg,
    source,
  };
}

export function earningsSpotlight(events: EarningsEvent[], limit = 6, today = nyCalendarDate()): EarningsEvent[] {
  const upcoming = events
    .filter((row) => isUpcoming(row, today))
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate) || (b.marketCap ?? 0) - (a.marketCap ?? 0));
  const reported = events
    .filter((row) => row.confirmed)
    .sort(
      (a, b) =>
        b.eventDate.localeCompare(a.eventDate) ||
        Math.abs(b.surprisePct ?? 0) - Math.abs(a.surprisePct ?? 0)
    );
  const picked: EarningsEvent[] = [];
  const seen = new Set<string>();
  for (const row of [...upcoming, ...reported]) {
    if (seen.has(row.ticker)) continue;
    seen.add(row.ticker);
    picked.push(row);
    if (picked.length >= limit) break;
  }
  return picked;
}

export function earningsFocusTickers(events: EarningsEvent[], limit = 4, today = nyCalendarDate()): string[] {
  return earningsSpotlight(events, limit, today).map((row) => row.ticker);
}

export function tagEarningsHeadlines(items: BriefNewsItem[], tickers: string[]): BriefNewsItem[] {
  const set = new Set(tickers.map((ticker) => ticker.toUpperCase()));
  const hit: BriefNewsItem[] = [];
  const rest: BriefNewsItem[] = [];
  for (const item of items) {
    if (item.ticker && set.has(item.ticker)) hit.push({ ...item, badge: "earnings" });
    else rest.push(item);
  }
  return [...hit, ...rest];
}

async function fetchNasdaqDate(date: string): Promise<EarningsEvent[]> {
  const url = `https://api.nasdaq.com/api/calendar/earnings?date=${date}`;
  const body = await cachedYahooJson(`nasdaq-earnings:${date}`, 15 * 60_000, async () => {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 OrbisEquity-Terminal",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    return res.json();
  });
  const rows = (body as { data?: { rows?: unknown[] } } | null)?.data?.rows ?? [];
  return eventsFromNasdaq(date, rows);
}

export async function loadEarningsCalendar(
  deskRows: DeskEarningsRow[],
  today = nyCalendarDate()
): Promise<EarningsEvent[]> {
  const desk = eventsFromDesk(deskRows);
  const dates = calendarDates(today);
  const batches = await Promise.all(
    dates.map(async (date) => {
      try {
        return await fetchNasdaqDate(date);
      } catch {
        return [];
      }
    })
  );
  return mergeEarnings(desk, batches.flat());
}
