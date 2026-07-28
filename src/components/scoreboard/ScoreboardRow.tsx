"use client";

import Link from "next/link";
import { BiasChip } from "./BiasChip";
import { AgreementDots } from "./AgreementDots";

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
  convergence: number;
  stateChangedAt: string | null;
  price: number | null;
  marketCap: number | null;
  peRatio: number | null;
};

function formatPrice(price: number | null): string {
  if (price == null) return "—";
  return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMktCap(cap: number | null): string {
  if (cap == null) return "—";
  if (cap >= 1e12) return `${(cap / 1e12).toFixed(1)}T`;
  if (cap >= 1e9) return `${(cap / 1e9).toFixed(0)}B`;
  if (cap >= 1e6) return `${(cap / 1e6).toFixed(0)}M`;
  return cap.toLocaleString();
}

function isRecentFlip(changedAt: string | null): boolean {
  if (!changedAt) return false;
  const diff = Date.now() - new Date(changedAt).getTime();
  return diff < 3 * 24 * 60 * 60 * 1000; // 3 days
}

export function ScoreboardRow({ row }: { row: ScreenerRow }) {
  const signals = [
    row.zMom > 0,
    row.fEwmac > 0,
    row.z52 > -0.10,
    row.breakout,
    row.volumeConfirmed,
  ];

  // Sector breadth placeholder (will be computed from full data)
  const sectorCtx = `${row.convergence}/5`;
  const flip = isRecentFlip(row.stateChangedAt);

  return (
    <tr className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors">
      <td className="px-3 py-2.5">
        <Link href={`/ticker/${row.symbol}`} className="hover:text-[var(--accent-info)] transition-colors">
          <span className="font-semibold">{row.symbol}</span>
        </Link>
        <span className="text-[var(--text-muted)] ml-2 text-xs hidden lg:inline">{row.companyName}</span>
      </td>
      <td className="px-3 py-2.5">
        <BiasChip state={row.state} rank={row.rank} />
      </td>
      <td className="px-3 py-2.5">
        <AgreementDots signals={signals} />
      </td>
      <td className="px-3 py-2.5 text-[var(--text-secondary)] text-xs">{sectorCtx}</td>
      <td className="px-3 py-2.5 text-right font-terminal text-xs">{formatPrice(row.price)}</td>
      <td className="px-3 py-2.5 text-right text-xs text-[var(--text-muted)]">{formatMktCap(row.marketCap)}</td>
      <td className="px-3 py-2.5">
        <div className="flex gap-1">
          {flip && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--accent-info)] text-[var(--surface)] font-terminal font-bold">
              FLIP
            </span>
          )}
          {row.breakout && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--badge-bg)] text-[var(--accent-warning)] font-terminal">
              BRK
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
