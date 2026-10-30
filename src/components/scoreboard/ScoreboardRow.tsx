"use client";

import Link from "next/link";
import { BiasChip } from "./BiasChip";
import { orbisScoreColor } from "@/lib/orbisScore";

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
  orbisScore?: number | null;
  hasTrendRadar?: boolean;
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

export function ScoreboardRow({
  row,
  selected,
  onSelect,
  showCompany = true,
  showBadges = true,
  stickySymbol = false,
}: {
  row: ScreenerRow;
  selected?: boolean;
  onSelect?: (symbol: string) => void;
  /** Hide the company name so the split pane fits at 100% zoom. */
  showCompany?: boolean;
  /** Badge chips are wide; the full-width list shows them, the split pane does not. */
  showBadges?: boolean;
  /** Keep the ticker visible while the rest of the row scrolls sideways. */
  stickySymbol?: boolean;
}) {
  const noRadar = row.hasTrendRadar === false;
  const dayPct = row.dayPct ?? row.zMom;
  const relVol = row.relVolume ?? row.fEwmac;
  const offHigh = row.pctFromHigh ?? row.z52 * 100;
  const sectorLabel = row.sector || "—";
  const flip = isRecentFlip(row.stateChangedAt);
  const dayColor = dayPct > 0 ? "var(--accent-bull)" : dayPct < 0 ? "var(--accent-bear)" : "";

  return (
    <tr
      onClick={() => onSelect?.(row.symbol)}
      className={`group border-b border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors cursor-pointer ${
        noRadar ? "opacity-60" : ""
      } ${selected ? "bg-[rgba(56,189,248,0.08)] ring-1 ring-inset ring-[var(--accent-info)]/30" : ""}`}
    >
      <td
        className={`px-3 py-2.5 ${
          stickySymbol
            ? `sticky left-0 z-10 ${
                selected
                  ? "bg-[color-mix(in_srgb,var(--accent-info)_12%,var(--card-bg))]"
                  : "bg-[var(--card-bg)] group-hover:bg-[var(--surface-alt)]"
              }`
            : ""
        }`}
      >
        <Link
          href={`/ticker/${row.symbol}`}
          title={row.companyName}
          className="hover:text-[var(--accent-info)] transition-colors whitespace-nowrap"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="font-semibold">{row.symbol}</span>
        </Link>
        {showCompany && (
          <span className="text-[var(--text-muted)] ml-2 text-xs hidden xl:inline">{row.companyName}</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        {noRadar ? (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--badge-bg)] text-[var(--text-muted)] font-terminal w-fit">
              No radar yet
            </span>
            <Link href={`/ticker/${row.symbol}`} className="text-[10px] text-[var(--accent-info)] hover:underline">
              Chart →
            </Link>
          </div>
        ) : (
          <BiasChip state={row.state} rank={row.rank} entryTiming={row.entryTiming} />
        )}
      </td>
      <td className="px-3 py-2.5 text-right font-terminal text-xs font-bold" style={{ color: orbisScoreColor(row.orbisScore) }}>
        {row.orbisScore ?? "—"}
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
      <td className="px-3 py-2.5 text-right font-terminal text-xs">{formatPrice(row.price)}</td>
      <td className="px-3 py-2.5 text-xs text-[var(--text-secondary)]" title={row.sector}>
        <div className="max-w-[8rem] truncate">{sectorLabel}</div>
      </td>
      {showBadges && (
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
      )}
    </tr>
  );
}
