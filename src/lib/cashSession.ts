/** US cash-equity session (NYSE regular hours). LSE ticks live in quotes_last. */

const CASH_OPEN_MIN = 9 * 60 + 30;
const CASH_CLOSE_MIN = 16 * 60;

export type SessionState = "CLOSED_WEEKEND" | "PRE" | "RTH" | "CLOSED_EOD";

function nyParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const weekday = get("weekday");
  return { y, m, d, hour, minute, weekday, iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

function weekdayIndex(short: string): number {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function isoWeekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function sessionState(now = new Date()): SessionState {
  const p = nyParts(now);
  const wd = weekdayIndex(p.weekday);
  if (wd === 0 || wd === 6) return "CLOSED_WEEKEND";
  const mins = p.hour * 60 + p.minute;
  if (mins < CASH_OPEN_MIN) return "PRE";
  if (mins < CASH_CLOSE_MIN) return "RTH";
  return "CLOSED_EOD";
}

export function lastClosedSession(now = new Date()): string {
  const p = nyParts(now);
  const state = sessionState(now);
  if (state === "CLOSED_EOD") return p.iso;
  let iso = addDaysIso(p.iso, -1);
  while (isoWeekday(iso) === 0 || isoWeekday(iso) === 6) {
    iso = addDaysIso(iso, -1);
  }
  return iso;
}

export function sessionLabel(state: SessionState): string {
  switch (state) {
    case "CLOSED_WEEKEND":
      return "WEEKEND — CASH SESSION CLOSED";
    case "PRE":
      return "PRE-MARKET — LAST CLOSE IS PRIOR SESSION";
    case "RTH":
      return "CASH RTH — IN-PROGRESS BAR NOT EOD";
    case "CLOSED_EOD":
      return "CASH SESSION CLOSED — EOD";
  }
}
