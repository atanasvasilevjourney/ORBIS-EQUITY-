"use client";

import Link from "next/link";
import { BiasChip } from "./BiasChip";

export type ScreenerRow = {
  symbol: string;
  companyName: string;
  sector: string;
  country: string;
  state: 1 | 0 | -1;
  rank: number;
  zMom: number;
  fEwmac: number;
  z52: number;
  breakout: boolean;
  volumeConfirmed: boolean;
  kamaRegime?: number;
  adx?: number | null;
  entryTiming?: string | null;
  convergence: number;
  stateChangedAt: string | null;
  dayPct?: number | null;
  relVolume?: number | null;
  pctFromHigh?: number | null;
  price: number | null;
  marketCap: number | null;
  peRatio: number | null;
};

function formatPrice(price: number | null): string {
  if (price == null) return "—";
  return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSigned(value: number | null | undefined, digits: number, suffix = ""): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}${suffix}`;
}

function isRecentFlip(changedAt: string | null): boolean {
  if (!changedAt) return false;
  const diff = Date.now() - new Date(changedAt).getTime();
  return diff < 3 * 24 * 60 * 60 * 1000;
}

export function ScoreboardRow({ row }: { row: ScreenerRow }) {
  const dayPct = row.dayPct ?? row.zMom;
  const relVol = row.relVolume ?? row.fEwmac;
  const offHigh = row.pctFromHigh ?? row.z52 * 100;
  const sectorLabel = row.sector || "—";
  const flip = isRecentFlip(row.stateChangedAt);
  const dayColor = dayPct > 0 ? "var(--accent-bull)" : dayPct < 0 ? "var(--accent-bear)" : "";

  return (
    <tr className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors">
      <td className="px-3 py-2.5">
        <Link href={`/ticker/${row.symbol}`} className="hover:text-[var(--accent-info)] transition-colors">
          <span className="font-semibold">{row.symbol}</span>
        </Link>
        <span className="text-[var(--text-muted)] ml-2 text-xs hidden lg:inline">{row.companyName}</span>
      </td>
      <td className="px-3 py-2.5">
        <BiasChip state={row.state} rank={row.rank} entryTiming={row.entryTiming} />
      </td>
      <td className="px-3 py-2.5 text-right font-terminal text-xs" style={{ color: dayColor }}>
        {formatSigned(dayPct, 1, "%")}
      </td>
      <td className="px-3 py-2.5 text-right font-terminal text-xs" style={{ color: relVol >= 5 ? "var(--accent-bull)" : relVol >= 2 ? "var(--accent-warning)" : "" }}>
        {relVol != null ? `${relVol.toFixed(1)}×` : "—"}
      </td>
      <td className="px-3 py-2.5 text-right font-terminal text-xs" style={{ color: offHigh >= -1 ? "var(--accent-bull)" : "" }}>
        {formatSigned(offHigh, 1, "%")}
      </td>
      <td className="px-3 py-2.5 text-[var(--text-secondary)] text-xs truncate max-w-[9rem]" title={row.sector}>{sectorLabel}</td>
      <td className="px-3 py-2.5 text-right font-terminal text-xs">{formatPrice(row.price)}</td>
      <td className="px-3 py-2.5">
        <div className="flex gap-1">
          {flip && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--accent-info)] text-[var(--surface)] font-terminal font-bold">
              NEW
            </span>
          )}
          {row.breakout && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--badge-bg)] text-[var(--accent-warning)] font-terminal">
              NEAR HIGH
            </span>
          )}
          {row.volumeConfirmed && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--badge-bg)] text-[var(--accent-bull)] font-terminal">
              5×
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
