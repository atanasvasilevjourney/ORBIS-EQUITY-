/** Pure layout math for the market-rotation tracker and mega-cap tape. */

export const ROTATION_INDEXES = [
  { symbol: "QQQ", label: "Nasdaq 100" },
  { symbol: "IWM", label: "Russell 2000" },
  { symbol: "SPY", label: "S&P 500" },
] as const;

export const SCOREBOARD_META = [
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "META", name: "Meta" },
  { symbol: "MSFT", name: "Microsoft" },
] as const;

export const SCOREBOARD_SYMBOLS = SCOREBOARD_META.map((row) => row.symbol);

const SCOREBOARD_NAMES: Record<string, string> = Object.fromEntries(
  SCOREBOARD_META.map((row) => [row.symbol, row.name])
);

const SECTOR_ETF: Record<string, string> = {
  energy: "XLE",
  financials: "XLF",
  "financial services": "XLF",
  financial: "XLF",
  industrials: "XLI",
  industrial: "XLI",
  technology: "XLK",
  "information technology": "XLK",
  "info tech": "XLK",
  tech: "XLK",
  healthcare: "XLV",
  "health care": "XLV",
  "consumer discretionary": "XLY",
  discretionary: "XLY",
  "consumer staples": "XLP",
  staples: "XLP",
  utilities: "XLU",
  utility: "XLU",
  materials: "XLB",
  "basic materials": "XLB",
  "real estate": "XLRE",
  "communication services": "XLC",
  communications: "XLC",
  communication: "XLC",
};

export type MoveTone = "bull" | "bear" | "flat";

export function sessionMove(series: { date: string; close: number }[]): {
  last: number | null;
  dayPct: number | null;
  asOf: string | null;
} {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.at(-1);
  if (!last || !Number.isFinite(last.close)) return { last: null, dayPct: null, asOf: null };
  const prev = sorted.at(-2);
  const dayPct =
    prev && Number.isFinite(prev.close) && prev.close > 0
      ? (last.close / prev.close - 1) * 100
      : null;
  return { last: last.close, dayPct, asOf: last.date };
}

export function indexSpread(iwmPct: number | null, qqqPct: number | null): number | null {
  if (iwmPct == null || qqqPct == null) return null;
  if (!Number.isFinite(iwmPct) || !Number.isFinite(qqqPct)) return null;
  return iwmPct - qqqPct;
}

export function spreadCall(pp: number | null): string | null {
  if (pp == null || !Number.isFinite(pp)) return null;
  if (pp > 0.05) return "Small caps leading";
  if (pp < -0.05) return "Large caps leading";
  return "Even tape";
}

/** Center-zero meter. `scale` is the percentage-point move that fills one half of the track. */
export function spreadMeter(pp: number | null, scale = 4): { left: number; width: number } {
  if (pp == null || !Number.isFinite(pp) || !(scale > 0)) return { left: 50, width: 0 };
  const clamped = Math.max(-1, Math.min(1, pp / scale));
  const width = Math.abs(clamped) * 50;
  const left = clamped >= 0 ? 50 : 50 - width;
  return { left, width };
}

export function barShare(value: number | null, peers: (number | null)[]): number {
  if (value == null || !Number.isFinite(value) || value === 0) return 0;
  const max = Math.max(...peers.map((v) => (v != null && Number.isFinite(v) ? Math.abs(v) : 0)), 1e-9);
  return Math.max(6, Math.min(100, (Math.abs(value) / max) * 100));
}

/** Width for a signed move. `fullScale` is the absolute value that fills the track. */
export function barScale(value: number | null, fullScale: number): number {
  if (value == null || !Number.isFinite(value) || value === 0 || !(fullScale > 0)) return 0;
  return Math.max(6, Math.min(100, (Math.abs(value) / fullScale) * 100));
}

export function moveTone(value: number | null): MoveTone {
  if (value == null || !Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "bull" : "bear";
}

export function signedPct(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function signedPp(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} pp`;
}

export function formatPx(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function sectorTag(name: string): { tag: string; label: string } {
  const label = name.trim();
  const key = label
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  const mapped = SECTOR_ETF[key];
  if (mapped) return { tag: mapped, label };
  const words = label.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const tag = (words.length > 1 ? words.map((word) => word[0]).join("") : label.slice(0, 4))
    .toUpperCase()
    .slice(0, 4);
  return { tag: tag || "—", label };
}

export function sectorRank<T extends { name: string; rs4w: number | null; score?: number | null }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const ar = a.rs4w;
    const br = b.rs4w;
    if (ar == null && br == null) return (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name);
    if (ar == null) return 1;
    if (br == null) return -1;
    return br - ar || a.name.localeCompare(b.name);
  });
}

export function holdingOrder<T extends { symbol: string; dayPct: number | null }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => (b.dayPct ?? -Infinity) - (a.dayPct ?? -Infinity) || a.symbol.localeCompare(b.symbol)
  );
}

export function latestDate(dates: (string | null | undefined)[]): string | null {
  const sorted = dates.filter((d): d is string => typeof d === "string" && d.length > 0).sort();
  return sorted.at(-1) ?? null;
}

export function shortLabel(name: string | null | undefined, fallback: string): string {
  const trimmed = name?.trim();
  if (!trimmed) return fallback;
  let short = trimmed.split(/\s+-\s+/)[0] ?? trimmed;
  short = short
    .replace(/,?\s+(inc\.?|corp\.?|corporation|plc|ltd\.?|limited|co\.?)$/i, "")
    .trim();
  if (!short) return fallback;
  if (short.length > 28) return `${short.slice(0, 26).trimEnd()}…`;
  return short;
}

export function scoreboardName(symbol: string, companyName?: string | null): string {
  const fallback = SCOREBOARD_NAMES[symbol] ?? symbol;
  const trimmed = companyName?.trim();
  if (!trimmed) return fallback;
  let short = trimmed.split(/\s+-\s+/)[0] ?? trimmed;
  short = short
    .replace(/,?\s+(inc\.?|corp\.?|corporation|plc|ltd\.?|limited)$/i, "")
    .replace(/,?\s+class\s+[a-z]$/i, "")
    .trim();
  if (!short || short.length > 22) return fallback;
  return short;
}

export function finiteOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
