import type { SessionMover } from "@/lib/sessionMovers";

export type OvernightMover = SessionMover & {
  tape: "pre" | "post" | "regular" | "unknown";
  quoteAt: string | null;
  orbEligible: boolean;
};

type SparkQuote = {
  close?: (number | null)[];
  open?: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  volume?: (number | null)[];
};

type SparkResponse = {
  meta?: {
    symbol?: string;
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    previousClose?: number;
  };
  timestamp?: number[];
  indicators?: { quote?: SparkQuote[] };
};

type SparkItem = {
  symbol?: string;
  response?: SparkResponse[];
};

function lastFinite(xs: (number | null | undefined)[] | undefined): { i: number; v: number } | null {
  if (!xs) return null;
  for (let i = xs.length - 1; i >= 0; i--) {
    const v = xs[i];
    if (v != null && Number.isFinite(v) && v > 0) return { i, v };
  }
  return null;
}

function firstFinite(xs: (number | null | undefined)[] | undefined): number | null {
  if (!xs) return null;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (v != null && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

function extHighLow(q: SparkQuote): { high: number | null; low: number | null } {
  let high: number | null = null;
  let low: number | null = null;
  const hs = q.high ?? [];
  const ls = q.low ?? [];
  const n = Math.max(hs.length, ls.length);
  for (let i = 0; i < n; i++) {
    const h = hs[i];
    const l = ls[i];
    if (h != null && Number.isFinite(h)) high = high == null ? h : Math.max(high, h);
    if (l != null && Number.isFinite(l) && l > 0) low = low == null ? l : Math.min(low, l);
  }
  return { high, low };
}

/** Map Yahoo spark 5m pre/post tape to overnight gap vs previous close. */
export function overnightFromSpark(
  items: SparkItem[],
  names: Record<string, string> = {}
): OvernightMover[] {
  const out: OvernightMover[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const resp = item?.response?.[0];
    const meta = resp?.meta ?? {};
    const ticker = String(item?.symbol || meta.symbol || "").toUpperCase();
    if (!ticker) continue;
    const q = resp?.indicators?.quote?.[0] ?? {};
    const lastClose = lastFinite(q.close);
    const last = lastClose?.v ?? (Number.isFinite(meta.regularMarketPrice) ? Number(meta.regularMarketPrice) : null);
    const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose);
    if (last == null || !(prevClose > 0) || !(last > 0)) continue;
    const open = firstFinite(q.open) ?? last;
    const hl = extHighLow(q);
    const volIdx = lastClose?.i ?? -1;
    const vol = volIdx >= 0 && q.volume && Number.isFinite(q.volume[volIdx] as number) ? Number(q.volume[volIdx]) : null;
    const ts = resp?.timestamp?.[volIdx];
    const gapPct = last / prevClose - 1;
    out.push({
      ticker,
      companyName: names[ticker] ?? "",
      last,
      prevClose,
      open,
      high: hl.high ?? last,
      low: hl.low ?? last,
      volume: vol,
      chgPct: gapPct,
      chgAbs: last - prevClose,
      gapPct,
      dollarVol: vol == null ? 0 : last * vol,
      tape: "unknown",
      quoteAt: ts != null ? new Date(ts * 1000).toISOString() : null,
      orbEligible: gapPct >= 0.04,
    });
  }
  return out;
}

export function rankOvernightUps(rows: OvernightMover[], minGap = 0, n = 80): OvernightMover[] {
  return rows
    .filter((r) => r.gapPct > minGap)
    .sort((a, b) => b.gapPct - a.gapPct)
    .slice(0, n);
}

export function rankOvernightDowns(rows: OvernightMover[], n = 80): OvernightMover[] {
  return rows.filter((r) => r.gapPct < 0).sort((a, b) => a.gapPct - b.gapPct).slice(0, n);
}
