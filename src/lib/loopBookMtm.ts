/** Mark LOOP open book to latest EOD bar in prices_daily (display-only MTM). */

export type LoopBookInput = {
  ticker: string;
  shares: number;
  entry: number;
  last: number | null;
  openedAt: string | null;
  unrealizedPnlUsd: number | null;
  daysHeld: number | null;
};

export type PriceBar = {
  symbol: string;
  date: string;
  close: number | string | null;
  adj_close?: number | string | null;
};

export type LoopBookEnriched = LoopBookInput & {
  last: number | null;
  priceAsOfDate: string | null;
  unrealizedPnlUsd: number | null;
  daysHeld: number | null;
};

function parsePx(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function latestCloseBySymbol(bars: PriceBar[]): Map<string, { close: number; date: string }> {
  const best = new Map<string, { close: number; date: string }>();
  for (const b of bars) {
    const px = parsePx(b.adj_close ?? b.close);
    if (px == null) continue;
    const d = String(b.date).slice(0, 10);
    const cur = best.get(b.symbol);
    if (!cur || d > cur.date) {
      best.set(b.symbol, { close: px, date: d });
    }
  }
  return best;
}

function calendarDaysBetween(startIso: string, endIso: string): number {
  const a = new Date(`${startIso.slice(0, 10)}T12:00:00Z`).getTime();
  const b = new Date(`${endIso.slice(0, 10)}T12:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

export function enrichLoopBookWithPrices(
  book: LoopBookInput[],
  bars: PriceBar[],
  todayIso?: string
): { rows: LoopBookEnriched[]; priceAsOfDate: string | null } {
  const latest = latestCloseBySymbol(bars);
  let maxDate: string | null = null;

  const rows = book.map((row) => {
    const m = latest.get(row.ticker);
    if (!m) {
      return {
        ...row,
        priceAsOfDate: null,
      };
    }
    if (!maxDate || m.date > maxDate) maxDate = m.date;
    const opened = row.openedAt?.slice(0, 10) ?? null;
    const daysHeld = opened ? calendarDaysBetween(opened, m.date) : row.daysHeld;
    const unrealizedPnlUsd = Math.round((m.close - row.entry) * row.shares * 100) / 100;
    return {
      ...row,
      last: m.close,
      priceAsOfDate: m.date,
      unrealizedPnlUsd,
      daysHeld,
    };
  });

  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  if (!maxDate) maxDate = today;

  return { rows, priceAsOfDate: maxDate };
}

export function tradingStaleDays(lastDateIso: string | null, todayIso?: string): number | null {
  if (!lastDateIso) return null;
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  return calendarDaysBetween(lastDateIso, today);
}
