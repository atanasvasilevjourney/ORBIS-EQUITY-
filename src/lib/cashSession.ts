/** NYSE cash-session clock. Matches pipeline.clients.cash_eod.drop_in_progress. */

const SESSION_CLOSE_MINUTES = 16 * 60;

function part(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

export function nyCashClock(now = new Date()): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  let hour = Number(part(parts, "hour"));
  if (hour === 24) hour = 0;
  return {
    date: `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`,
    minutes: hour * 60 + Number(part(parts, "minute")),
  };
}

/** Calendar date in America/New_York for a unix-second timestamp. */
export function nySessionDate(tsSec: number): string {
  return nyCashClock(new Date(tsSec * 1000)).date;
}

/** Drop today's daily bar before the 16:00 ET close so scans stay on a finished session. */
export function dropOpenCashSession<T extends { date: string }>(bars: T[], now = new Date()): T[] {
  if (!bars.length) return bars;
  const { date, minutes } = nyCashClock(now);
  const last = bars[bars.length - 1].date.slice(0, 10);
  if (last === date && minutes < SESSION_CLOSE_MINUTES) return bars.slice(0, -1);
  return bars;
}
