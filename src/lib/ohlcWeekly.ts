export type OhlcBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** ISO week key (year-Www) for grouping daily bars into calendar weeks (Mon–Sun). */
function isoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Aggregate daily OHLCV → weekly bars (week ends on last trading day in the ISO week). */
export function aggregateDailyToWeekly(daily: OhlcBar[]): OhlcBar[] {
  if (!daily.length) return [];
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const buckets = new Map<string, OhlcBar[]>();
  for (const bar of sorted) {
    const key = isoWeekKey(bar.date);
    const list = buckets.get(key) ?? [];
    list.push(bar);
    buckets.set(key, list);
  }
  const weeks: OhlcBar[] = [];
  for (const key of Array.from(buckets.keys()).sort()) {
    const bars = buckets.get(key)!;
    const last = bars[bars.length - 1];
    weeks.push({
      date: last.date.slice(0, 10),
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: last.close,
      volume: bars.reduce((s, b) => s + b.volume, 0),
    });
  }
  return weeks;
}
