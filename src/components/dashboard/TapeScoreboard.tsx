"use client";

import Link from "next/link";
import { DeskWidget } from "@/components/ui/DeskWidget";
import {
  barScale,
  formatPx,
  holdingOrder,
  latestDate,
  moveTone,
  SCOREBOARD_META,
  scoreboardName,
  signedPct,
} from "@/lib/rotationDesk";

export type ScoreboardName = {
  symbol: string;
  name: string;
  last: number | null;
  dayPct: number | null;
  fcfYield: number | null;
  earningsYield: number | null;
  asOf: string | null;
};

const DOT: Record<string, string> = {
  AMZN: "var(--dot-amzn)",
  GOOGL: "var(--dot-googl)",
  META: "var(--dot-meta)",
  MSFT: "var(--dot-msft)",
};

function toneColor(tone: ReturnType<typeof moveTone>): string {
  if (tone === "bull") return "var(--accent-bull)";
  if (tone === "bear") return "var(--accent-bear)";
  return "var(--text-muted)";
}

function yieldPct(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value * 100;
}

export function TapeScoreboard({
  names,
  unavailable,
}: {
  names: ScoreboardName[];
  unavailable?: boolean;
}) {
  const bySymbol = new Map(names.map((row) => [row.symbol, row]));
  const rows = SCOREBOARD_META.map((meta) => {
    const row = bySymbol.get(meta.symbol);
    return {
      symbol: meta.symbol,
      name: scoreboardName(meta.symbol, row?.name),
      last: row?.last ?? null,
      dayPct: row?.dayPct ?? null,
      fcfYield: row?.fcfYield ?? null,
      earningsYield: row?.earningsYield ?? null,
      asOf: row?.asOf ?? null,
    };
  });
  const holding = holdingOrder(rows);
  const printed = latestDate(rows.map((row) => row.asOf));

  return (
    <DeskWidget
      title="Mega-cap tape"
      menu={[
        { href: "/cash", label: "Open cash desk" },
        { href: "/fundamentals", label: "Fundamentals" },
      ]}
      footer={
        <>
          <span>{unavailable ? "Tape unavailable" : `Prices · EOD · ${printed ?? "—"}`}</span>
          <span>FCF yield, or earnings yield when free cash flow is missing</span>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="section-label">Session and free cash flow</p>
        <p className="text-[10px] text-[var(--text-muted)]">Four names · ranked below by session</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {rows.map((row) => {
          const dot = DOT[row.symbol] ?? "var(--accent-info)";
          const tone = moveTone(row.dayPct);
          const yld = yieldPct(row.fcfYield);
          const earnings = yieldPct(row.earningsYield);
          const fundamental = yld != null
            ? { label: "FCF yield", value: yld }
            : earnings != null
              ? { label: "Earnings yield", value: earnings }
              : null;
          const yTone = moveTone(fundamental?.value ?? null);
          return (
            <Link
              key={row.symbol}
              href={`/ticker/${row.symbol}`}
              className="quote-card block overflow-hidden px-4 py-3.5 hover:bg-[var(--surface-alt)]"
              style={{ boxShadow: `inset 0 2px 0 0 ${dot}` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] font-semibold tracking-wide" style={{ color: dot }}>
                    {row.symbol}
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="font-display text-[1.7rem] font-semibold leading-none tracking-tight tabular-nums">
                      {formatPx(row.last)}
                    </span>
                    <span className="text-xs tabular-nums" style={{ color: toneColor(tone) }}>
                      {signedPct(row.dayPct)}
                    </span>
                  </div>
                </div>
                <span className="max-w-[46%] truncate text-right text-[11px] text-[var(--text-muted)]" title={row.name}>
                  {row.name}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-baseline justify-between gap-2 text-[10px] text-[var(--text-muted)]">
                    <span>Session</span>
                    <span className="tabular-nums" style={{ color: toneColor(tone) }}>
                      {signedPct(row.dayPct)}
                    </span>
                  </div>
                  <div className="mag-track mt-1.5">
                    <div
                      className="mag-fill"
                      style={{
                        width: `${barScale(row.dayPct, 4)}%`,
                        background: toneColor(tone),
                      }}
                    />
                  </div>
                </div>
                <div>
                  {fundamental == null ? (
                    <p className="text-[11px] text-[var(--text-muted)]">Financial data N/A</p>
                  ) : (
                    <>
                      <div className="flex items-baseline justify-between gap-2 text-[10px] text-[var(--text-muted)]">
                        <span>{fundamental.label}</span>
                        <span className="tabular-nums" style={{ color: toneColor(yTone) }}>
                          {signedPct(fundamental.value, 1)}
                        </span>
                      </div>
                      <div className="mag-track mt-1.5">
                        <div
                          className="mag-fill"
                          style={{
                            width: `${barScale(fundamental.value, 8)}%`,
                            background: toneColor(yTone),
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-3 text-[10px] text-[var(--text-muted)]">{row.asOf ?? "—"}</div>
            </Link>
          );
        })}
      </div>

      <div className="mt-3 rounded-xl border border-[var(--panel-border)] bg-[var(--surface-alt)] px-3 py-2.5">
        <p className="section-label mb-2">Who&apos;s holding up best?</p>
        <div className="flex flex-wrap gap-2">
          {holding.map((row, index) => {
            const tone = moveTone(row.dayPct);
            const lead = index === 0 && row.dayPct != null;
            const dot = DOT[row.symbol] ?? "var(--text-secondary)";
            return (
              <Link
                key={row.symbol}
                href={`/ticker/${row.symbol}`}
                className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[12px]"
                style={{
                  boxShadow: lead ? "inset 0 0 0 1px var(--accent-bull)" : "inset 0 0 0 1px var(--panel-border)",
                  background: lead ? "rgba(34, 197, 94, 0.08)" : "transparent",
                }}
              >
                <span className="text-[10px] text-[var(--text-muted)]">#{index + 1}</span>
                <span className="font-semibold" style={{ color: lead ? "var(--accent-bull)" : dot }}>
                  {row.symbol}
                </span>
                <span className="tabular-nums" style={{ color: lead ? "var(--accent-bull)" : toneColor(tone) }}>
                  {signedPct(row.dayPct)}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </DeskWidget>
  );
}
