"use client";

import Link from "next/link";

export type Ema200TableRow = {
  symbol: string;
  companyName: string;
  indexTag: string | null;
  setup: string;
  close: number | null;
  ema200: number | null;
  ema200High: number | null;
  distAtr: number | null;
  distUsd: number | null;
  distPct: number | null;
  distDeltaAtr: number | null;
  daysSinceRibbonTouch: number | null;
  daysAbove: number | null;
  ema200Slope: number | null;
  rvol: number | null;
  regime: string | null;
  tradingViewUrl: string;
};

function indexLabel(tag: string | null): string {
  if (tag === "sp500") return "S&P 500";
  if (tag === "ndx100") return "NDX-100";
  return tag ?? "—";
}

function fmtDelta(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}

export function Ema200WatchTable({ rows, emptyDetail }: { rows: Ema200TableRow[]; emptyDetail: string }) {
  if (!rows.length) {
    return <p className="px-3 py-6 text-center text-xs text-[var(--text-muted)] font-terminal">{emptyDetail}</p>;
  }
  return (
    <div className="overflow-x-auto -mx-3 -mb-3">
      <table className="w-full text-sm font-terminal">
        <thead>
          <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--panel-border)] bg-[var(--panel-header)]">
            <th className="text-left px-3 py-2">TICKER</th>
            <th className="text-left px-3 py-2">INDEX</th>
            <th className="text-right px-3 py-2">RIBBON ATR</th>
            <th className="text-right px-3 py-2">DIST $</th>
            <th className="text-right px-3 py-2">DIST %</th>
            <th className="text-right px-3 py-2">Δ ATR 1D</th>
            <th className="text-right px-3 py-2">DAYS SINCE TOUCH</th>
            <th className="text-right px-3 py-2">DAYS↑</th>
            <th className="text-right px-3 py-2">CLOSE</th>
            <th className="text-right px-3 py-2">EMA200 LO / HI</th>
            <th className="text-left px-3 py-2">CHART</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.symbol}
              className="border-b border-[var(--panel-border)] hover:bg-[var(--surface-alt)]"
            >
              <td className="px-3 py-2">
                <Link
                  href={`/ticker/${r.symbol}?swing=1`}
                  className="text-[var(--accent-info)] hover:underline"
                  title="Open daily chart with EMA ribbon"
                >
                  {r.symbol}
                </Link>
                <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[140px]">{r.companyName}</div>
              </td>
              <td className="px-3 py-2 text-xs">{indexLabel(r.indexTag)}</td>
              <td className="px-3 py-2 text-right">{r.distAtr?.toFixed(2) ?? "—"}</td>
              <td className="px-3 py-2 text-right">{r.distUsd != null ? r.distUsd.toFixed(2) : "—"}</td>
              <td className="px-3 py-2 text-right">{r.distPct != null ? `${r.distPct.toFixed(2)}%` : "—"}</td>
              <td
                className="px-3 py-2 text-right"
                style={{
                  color:
                    r.distDeltaAtr != null && r.distDeltaAtr < 0
                      ? "var(--accent-bull)"
                      : r.distDeltaAtr != null && r.distDeltaAtr > 0
                        ? "var(--accent-bear)"
                        : undefined,
                }}
              >
                {fmtDelta(r.distDeltaAtr)}
              </td>
              <td className="px-3 py-2 text-right">{r.daysSinceRibbonTouch ?? "—"}</td>
              <td className="px-3 py-2 text-right">{r.daysAbove ?? "—"}</td>
              <td className="px-3 py-2 text-right">{r.close?.toFixed(2) ?? "—"}</td>
              <td className="px-3 py-2 text-right text-[11px]">
                {r.ema200 != null ? r.ema200.toFixed(2) : "—"}
                {r.ema200High != null ? ` / ${r.ema200High.toFixed(2)}` : ""}
              </td>
              <td className="px-3 py-2 space-x-2">
                <Link href={`/ticker/${r.symbol}?swing=1`} className="text-[10px] text-[var(--accent-info)] hover:underline">
                  CHART
                </Link>
                <a
                  href={r.tradingViewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-[var(--text-muted)] hover:text-[var(--accent-info)]"
                >
                  TV
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
