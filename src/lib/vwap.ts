import type { Candle } from "@/components/chart/TradingChart";

const NY = "America/New_York";

function barMs(time: string | number): number {
  if (typeof time === "number") return time * 1000;
  const t = Date.parse(time);
  return Number.isFinite(t) ? t : 0;
}

/** Calendar date in US/Eastern (session boundary for listed equities). */
export function etSessionKey(time: string | number): string {
  const ms = barMs(time);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NY,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ms);
}

function etDayOfWeek(time: string | number): number {
  const wd =
    new Intl.DateTimeFormat("en-US", { timeZone: NY, weekday: "short" }).format(barMs(time)) ?? "Mon";
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

/** Monday session date (ET) for the bar's week — anchor for multi-day AVWAP on 5m tape. */
export function etWeekAnchorKey(time: string | number): string {
  const ms = barMs(time);
  const dow = etDayOfWeek(time);
  const offset = dow === 0 ? 6 : dow - 1;
  return etSessionKey(ms - offset * 86_400_000);
}

export function typicalPrice(c: Pick<Candle, "high" | "low" | "close">): number {
  return (c.high + c.low + c.close) / 3;
}

export type VwapAnchor = "session" | "week" | "range";

function cumulativeVwap(
  candles: Candle[],
  boundary: (time: string | number, i: number) => string
): (number | null)[] {
  const out: (number | null)[] = [];
  let key = "";
  let cumPv = 0;
  let cumVol = 0;
  let last: number | null = null;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const k = boundary(c.time, i);
    if (k !== key) {
      key = k;
      cumPv = 0;
      cumVol = 0;
    }
    const vol = c.volume != null && c.volume > 0 ? c.volume : 0;
    if (vol > 0) {
      cumPv += typicalPrice(c) * vol;
      cumVol += vol;
      last = cumPv / cumVol;
    }
    out.push(last);
  }
  return out;
}

/** Resets each US/Eastern session — intraday fair value on 5m tape. */
export function sessionVwapSeries(candles: Candle[]): (number | null)[] {
  return cumulativeVwap(candles, (t) => etSessionKey(t));
}

/** Resets each Monday (ET) — swing AVWAP for the current week on intraday bars. */
export function weekAnchoredVwapSeries(candles: Candle[]): (number | null)[] {
  return cumulativeVwap(candles, (t) => etWeekAnchorKey(t));
}

/** Cumulative from the first bar in the window (Yahoo 5d range anchor). */
export function rangeAnchoredVwapSeries(candles: Candle[]): (number | null)[] {
  return cumulativeVwap(candles, () => "range");
}

export function vwapOverlaysForIntraday(candles: Candle[]): {
  session: (number | null)[];
  anchored: (number | null)[];
  anchorLabel: string;
} {
  return {
    session: sessionVwapSeries(candles),
    anchored: weekAnchoredVwapSeries(candles),
    anchorLabel: "week (ET)",
  };
}
