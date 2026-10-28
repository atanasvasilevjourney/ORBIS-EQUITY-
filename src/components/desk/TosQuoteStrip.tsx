"use client";

import type { ScreenerRow } from "@/components/scoreboard/ScoreboardRow";

export type CrosshairOhlc = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type Props = {
  row: ScreenerRow | null;
  crosshair: CrosshairOhlc | null;
  interval: string;
};

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtVol(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}

export function TosQuoteStrip({ row, crosshair, interval }: Props) {
  if (!row) {
    return (
      <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-alt)] text-[10px] font-terminal text-[var(--text-muted)]">
        Select a symbol in MarketWatch
      </div>
    );
  }

  const day = row.dayPct ?? row.zMom;
  const dayColor =
    day == null ? "var(--text-muted)" : day >= 0 ? "var(--accent-bull)" : "var(--accent-bear)";

  const o = crosshair?.open ?? row.price;
  const h = crosshair?.high ?? row.price;
  const l = crosshair?.low ?? row.price;
  const c = crosshair?.close ?? row.price;
  const vol = crosshair?.volume;

  return (
    <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-alt)] flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-terminal">
      <span className="font-bold text-[var(--text-primary)]">{row.symbol}</span>
      <span className="text-[var(--text-muted)] truncate max-w-[140px] hidden sm:inline">{row.companyName}</span>
      <span>
        <span className="text-[var(--text-muted)]">Last </span>
        <span className="tabular-nums">{fmt(row.price)}</span>
      </span>
      <span style={{ color: dayColor }}>
        <span className="text-[var(--text-muted)]">Chg </span>
        {day == null ? "—" : `${day >= 0 ? "+" : ""}${day.toFixed(2)}%`}
      </span>
      <span>
        <span className="text-[var(--text-muted)]">Rel vol </span>
        {row.relVolume ?? row.fEwmac != null ? (row.relVolume ?? row.fEwmac).toFixed(2) : "—"}×
      </span>
      <span className="hidden md:inline text-[var(--text-muted)]">|</span>
      <span className="hidden md:inline tabular-nums">
        O {fmt(o)} H {fmt(h)} L {fmt(l)} C {fmt(c)}
        {vol != null ? ` · Vol ${fmtVol(vol)}` : ""}
      </span>
      <span className="ml-auto text-[var(--text-muted)]">{interval.toUpperCase()} · crosshair</span>
    </div>
  );
}
