/** Vela bars use epoch milliseconds. Desk APIs still send daily `YYYY-MM-DD` or unix seconds. */

export type DeskCandle = {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type VelaBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export function toEpochMs(time: string | number): number | null {
  if (typeof time === "number" && Number.isFinite(time)) {
    if (time > 1e12) return Math.floor(time);
    if (time > 1e9) return Math.floor(time * 1000);
    return null;
  }
  if (typeof time !== "string") return null;
  const s = time.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const ms = Date.parse(`${s}T00:00:00.000Z`);
    return Number.isFinite(ms) ? ms : null;
  }
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const stamped = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(stamped);
  return Number.isFinite(ms) ? ms : null;
}

export function toVelaBars(candles: DeskCandle[]): VelaBar[] {
  const out: VelaBar[] = [];
  let last = -1;
  for (const c of candles) {
    const t = toEpochMs(c.time);
    if (t == null || t <= last) continue;
    if (![c.open, c.high, c.low, c.close].every(Number.isFinite)) continue;
    last = t;
    out.push({
      time: t,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    });
  }
  return out;
}

/** Vela timeframes: a bare number is minutes; `D` is daily. */
export function velaTimeframe(interval?: string): string {
  if (interval === "5m") return "5";
  return "D";
}
