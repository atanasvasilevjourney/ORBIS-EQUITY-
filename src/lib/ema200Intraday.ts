/**
 * Phase 3 — daily EMA200 ribbon on 5m bars + intraday triggers (parity with pipeline).
 */
import { emaPineSeries } from "@/lib/chartEma";
import { EMA200_DEFAULTS, classifyEma200Setup, type Ema200FeatureRow } from "@/lib/ema200Watchlist";
import { ribbonDistUsd } from "@/lib/ema200Distance";
import { dropOpenCashIntradayBars, nySessionDate, nySessionDateFromUnix } from "@/lib/cashSession";

export type IntradayBar = {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type DailyOhlc = { date: string; open: number; high: number; low: number; close: number; volume: number };

export type Phase3TriggerType = "INTRADAY_AT_RIBBON" | "INTRADAY_RECLAIM";

export type Phase3Trigger = {
  symbol: string;
  triggerType: Phase3TriggerType;
  barTime: string | number;
  sessionDate: string;
  close: number;
  ema200Daily: number;
  ribbonDistAtr: number;
  rvol5m: number | null;
  score: number;
  dailySetup: string | null;
};

export type Merged5mRow = {
  time: string | number;
  close: number;
  high: number;
  low: number;
  volume: number;
  ema200Daily: number | null;
  ema200HighDaily: number | null;
  ribbonDistAtrDaily: number | null;
  rvol5m: number | null;
};

const HISTORY_MIN = 200;
const ATR_PERIOD = 14;
const RTH_START = 9 * 60 + 30;
const RTH_END = 16 * 60;

function computeAtr(bars: { high: number; low: number; close: number }[], period: number): (number | null)[] {
  const n = bars.length;
  const out: (number | null)[] = Array(n).fill(null);
  const tr: number[] = [];
  for (let i = 0; i < n; i++) {
    const pc = i > 0 ? bars[i - 1].close : bars[i].close;
    tr.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - pc), Math.abs(bars[i].low - pc)));
  }
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += tr[j];
    out[i] = sum / period;
  }
  return out;
}

function nyMinutes(time: string | number): number | null {
  const ms = typeof time === "number" ? time * 1000 : Date.parse(String(time));
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

function isRth(time: string | number): boolean {
  const mins = nyMinutes(time);
  if (mins == null) return false;
  return mins >= RTH_START && mins <= RTH_END;
}

function sessionDate(time: string | number): string {
  if (typeof time === "number") return nySessionDateFromUnix(time);
  return String(time).slice(0, 10);
}

export function buildDailyEmaMaps(daily: DailyOhlc[]): {
  emaClose: Map<string, number>;
  emaHigh: Map<string, number>;
} {
  if (daily.length < HISTORY_MIN) return { emaClose: new Map(), emaHigh: new Map() };
  const closes = daily.map((b) => b.close);
  const highs = daily.map((b) => b.high);
  const emaC = emaPineSeries(closes, 200);
  const emaH = emaPineSeries(highs, 200);
  const emaClose = new Map<string, number>();
  const emaHigh = new Map<string, number>();
  for (let i = HISTORY_MIN - 1; i < daily.length; i++) {
    if (emaC[i] == null || emaH[i] == null) continue;
    emaClose.set(daily[i].date.slice(0, 10), emaC[i]!);
    emaHigh.set(daily[i].date.slice(0, 10), emaH[i]!);
  }
  return { emaClose, emaHigh };
}

export function mergeDailyRibbonOn5m(bars: IntradayBar[], daily: DailyOhlc[]): Merged5mRow[] {
  const work = dropOpenCashIntradayBars(bars);

  const { emaClose, emaHigh } = buildDailyEmaMaps(daily);
  const atr = computeAtr(work, ATR_PERIOD);
  const out: Merged5mRow[] = [];
  for (let i = 0; i < work.length; i++) {
    const d = sessionDate(work[i].time);
    const emaC = emaClose.get(d) ?? null;
    const emaH = emaHigh.get(d) ?? null;
    let ribbonDist: number | null = null;
    if (emaC != null && atr[i] != null && atr[i]! > 0) {
      const usd = ribbonDistUsd(work[i].close, emaC, emaH);
      ribbonDist = usd == null ? null : usd / atr[i]!;
    }
    let rvol: number | null = null;
    if (i >= 19) {
      let vsum = 0;
      for (let j = i - 19; j <= i; j++) vsum += work[j].volume ?? 0;
      const avg = vsum / 20;
      rvol = avg > 0 ? (work[i].volume ?? 0) / avg : null;
    }
    out.push({
      time: work[i].time,
      close: work[i].close,
      high: work[i].high,
      low: work[i].low,
      volume: work[i].volume ?? 0,
      ema200Daily: emaC,
      ema200HighDaily: emaH,
      ribbonDistAtrDaily: ribbonDist,
      rvol5m: rvol,
    });
  }
  return out;
}

export function dailyRibbonSwingLines(
  candles: IntradayBar[],
  daily: DailyOhlc[]
): { ema200: (number | null)[]; ema200High: (number | null)[] } {
  const { emaClose, emaHigh } = buildDailyEmaMaps(daily);
  const ema200 = candles.map((c) => emaClose.get(sessionDate(c.time)) ?? null);
  const ema200High = candles.map((c) => emaHigh.get(sessionDate(c.time)) ?? null);
  return { ema200, ema200High };
}

function scoreTrigger(distAtr: number, rvol: number | null): number {
  const cap = EMA200_DEFAULTS.shortlistAtr;
  let base = Math.max(0, 100 - (distAtr / cap) * 35);
  if (rvol != null && rvol >= 1.2) base += 5;
  return Math.min(100, base);
}

export function detectPhase3Triggers(
  symbol: string,
  merged: Merged5mRow[],
  dailySetup: string | null,
  opts: { requireDailyWatchlist?: boolean; liveLastBarOnly?: boolean } = {}
): Phase3Trigger[] {
  const requireWl = opts.requireDailyWatchlist ?? true;
  const liveOnly = opts.liveLastBarOnly ?? true;
  if (requireWl && !dailySetup) return [];
  if (merged.length < 2) return [];

  const indices = liveOnly ? [merged.length - 1] : merged.map((_, i) => i).filter((i) => i > 0);
  const out: Phase3Trigger[] = [];

  for (const i of indices) {
    const row = merged[i];
    const prev = merged[i - 1];
    if (!isRth(row.time)) continue;
    if (row.ema200Daily == null || row.ribbonDistAtrDaily == null) continue;
    const dist = Math.abs(row.ribbonDistAtrDaily);
    const held = row.close >= row.ema200Daily;
    const rvol = row.rvol5m;

    if (dist <= EMA200_DEFAULTS.shortlistAtr && held && (rvol == null || rvol >= 1.2)) {
      out.push({
        symbol,
        triggerType: "INTRADAY_AT_RIBBON",
        barTime: row.time,
        sessionDate: sessionDate(row.time),
        close: row.close,
        ema200Daily: row.ema200Daily,
        ribbonDistAtr: dist,
        rvol5m: rvol,
        score: scoreTrigger(dist, rvol),
        dailySetup,
      });
    }

    if (prev.ema200Daily == null || prev.ribbonDistAtrDaily == null) continue;
    const prevHeld = prev.close >= prev.ema200Daily;
    const prevDist = Math.abs(prev.ribbonDistAtrDaily);
    const dipped = prev.close < prev.ema200Daily || prevDist > EMA200_DEFAULTS.shortlistAtr;
    let reclaim = dipped && held && dist <= EMA200_DEFAULTS.shortlistAtr && (rvol == null || rvol >= 1.2);
    if (reclaim && dailySetup !== "RETRACE_HELD") reclaim = false;
    if (reclaim) {
      out.push({
        symbol,
        triggerType: "INTRADAY_RECLAIM",
        barTime: row.time,
        sessionDate: sessionDate(row.time),
        close: row.close,
        ema200Daily: row.ema200Daily,
        ribbonDistAtr: dist,
        rvol5m: rvol,
        score: scoreTrigger(dist, rvol),
        dailySetup,
      });
    }
  }

  if (out.some((t) => t.triggerType === "INTRADAY_RECLAIM")) {
    return out.filter((t) => t.triggerType !== "INTRADAY_AT_RIBBON");
  }
  return out;
}

export function classifyDailySetup(row: Ema200FeatureRow): string | null {
  return classifyEma200Setup(row);
}

export function ribbonDistFromRow(row: Merged5mRow): number | null {
  if (row.ribbonDistAtrDaily == null) return null;
  return Math.abs(row.ribbonDistAtrDaily);
}
