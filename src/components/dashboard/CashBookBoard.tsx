"use client";

import Link from "next/link";
import { DeskWidget } from "@/components/ui/DeskWidget";
import { barShare, formatPx, shortLabel } from "@/lib/rotationDesk";

export type CashBookCard = {
  ticker: string;
  companyName: string;
  last: number | null;
  notional: number | null;
  side: string | null;
};

const ACCENTS = ["var(--dot-amzn)", "var(--dot-googl)", "var(--dot-meta)", "var(--dot-msft)"];

function usd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function CashBookBoard({
  names,
  onPick,
}: {
  names: CashBookCard[];
  onPick?: (ticker: string) => void;
}) {
  const rows = [...names]
    .filter((row) => row.ticker)
    .sort((a, b) => (b.notional ?? 0) - (a.notional ?? 0))
    .slice(0, 4);
  if (!rows.length) return null;
  const peers = rows.map((row) => row.notional);
  const ranked = [...rows].sort((a, b) => (b.notional ?? 0) - (a.notional ?? 0));

  return (
    <DeskWidget
      title="Cash book"
      className="mb-6"
      menu={[{ href: "/fundamentals", label: "Fundamentals" }]}
      footer={
        <>
          <span>Paper slots · listed EOD</span>
          <span>Sized by cash notional</span>
        </>
      }
    >
      <p className="section-label mb-3">Largest funded names</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {rows.map((row, index) => {
          const accent = ACCENTS[index % ACCENTS.length];
          return (
            <Link
              key={row.ticker}
              href={`/ticker/${row.ticker}`}
              onClick={() => onPick?.(row.ticker)}
              className="quote-card block overflow-hidden px-4 py-3.5 hover:bg-[var(--surface-alt)]"
              style={{ boxShadow: `inset 0 2px 0 0 ${accent}` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] font-semibold tracking-wide" style={{ color: accent }}>
                    {row.ticker}
                  </div>
                  <div className="mt-1 font-display text-[1.7rem] font-semibold leading-none tracking-tight tabular-nums">
                    {formatPx(row.last)}
                  </div>
                  <div className="mt-1.5 text-xs text-[var(--text-secondary)]">{row.side ?? "—"}</div>
                </div>
                <span className="max-w-[42%] truncate text-right text-[11px] text-[var(--text-muted)]" title={row.companyName || row.ticker}>
                  {shortLabel(row.companyName, row.ticker)}
                </span>
              </div>
              <div className="mt-4">
                <div className="flex items-baseline justify-between text-[10px] text-[var(--text-muted)]">
                  <span>Cash notional</span>
                  <span
                    className="tabular-nums"
                    style={{ color: (row.notional ?? 0) < 0 ? "var(--accent-bear)" : "var(--text-primary)" }}
                  >
                    {usd(row.notional)}
                  </span>
                </div>
                <div className="mag-track mt-1.5">
                  <div
                    className="mag-fill"
                    style={{
                      width: `${barShare(row.notional, peers)}%`,
                      background: (row.notional ?? 0) < 0 ? "var(--accent-bear)" : accent,
                    }}
                  />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="mt-3 rounded-xl border border-[var(--panel-border)] bg-[var(--surface-alt)] px-3 py-2.5">
        <p className="section-label mb-2">Who&apos;s sized largest?</p>
        <div className="flex flex-wrap gap-2">
          {ranked.map((row, index) => (
            <button
              key={row.ticker}
              type="button"
              onClick={() => onPick?.(row.ticker)}
              className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[12px]"
              style={{
                boxShadow:
                  index === 0 ? "inset 0 0 0 1px var(--accent-bull)" : "inset 0 0 0 1px var(--panel-border)",
              }}
            >
              <span className="text-[10px] text-[var(--text-muted)]">#{index + 1}</span>
              <span className="font-semibold text-[var(--text-primary)]">{row.ticker}</span>
              <span className="tabular-nums text-[var(--text-secondary)]">{usd(row.notional)}</span>
            </button>
          ))}
        </div>
      </div>
    </DeskWidget>
  );
}
