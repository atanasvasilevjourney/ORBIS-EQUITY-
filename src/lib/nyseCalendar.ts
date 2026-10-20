/** NYSE full-day closures, computed from the exchange's holiday rules (UTC date math on ISO dates). */

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function nthWeekday(y: number, m: number, weekday: number, n: number): Date {
  const first = utc(y, m, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utc(y, m, 1 + offset + (n - 1) * 7);
}

function lastWeekday(y: number, m: number, weekday: number): Date {
  const last = utc(y, m + 1, 0);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return utc(y, m, last.getUTCDate() - offset);
}

function easterSunday(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(y, month, day);
}

/** Saturday holidays close the prior Friday; Sunday holidays close the next Monday. */
function observed(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === 6) return new Date(d.getTime() - 86400000);
  if (dow === 0) return new Date(d.getTime() + 86400000);
  return d;
}

const cache = new Map<number, Set<string>>();

function holidaysForYear(y: number): Set<string> {
  const hit = cache.get(y);
  if (hit) return hit;
  const set = new Set<string>();
  // A Saturday Jan 1 is not observed on Dec 31 (NYSE rule 7.2).
  const newYear = utc(y, 1, 1);
  if (newYear.getUTCDay() !== 6) set.add(iso(observed(newYear)));
  set.add(iso(nthWeekday(y, 1, 1, 3)));
  set.add(iso(nthWeekday(y, 2, 1, 3)));
  set.add(iso(new Date(easterSunday(y).getTime() - 2 * 86400000)));
  set.add(iso(lastWeekday(y, 5, 1)));
  if (y >= 2022) set.add(iso(observed(utc(y, 6, 19))));
  set.add(iso(observed(utc(y, 7, 4))));
  set.add(iso(nthWeekday(y, 9, 1, 1)));
  set.add(iso(nthWeekday(y, 11, 4, 4)));
  set.add(iso(observed(utc(y, 12, 25))));
  cache.set(y, set);
  return set;
}

export function isNyseHoliday(isoDate: string): boolean {
  const day = isoDate.slice(0, 10);
  const y = Number(day.slice(0, 4));
  return holidaysForYear(y).has(day);
}

export function isNyseTradingDay(isoDate: string): boolean {
  const dow = utc(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)),
    Number(isoDate.slice(8, 10))
  ).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !isNyseHoliday(isoDate);
}
