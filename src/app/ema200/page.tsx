"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { ModulePanel } from "@/components/ui/ModulePanel";
import { EmptyState } from "@/components/ui/EmptyState";

type Ema200Row = {
  symbol: string;
  companyName: string;
  sector: string;
  indexTag: string | null;
  setup: string;
  close: number | null;
  ema200: number | null;
  ema200High: number | null;
  distAtr: number | null;
  daysAbove: number | null;
  ema200Slope: number | null;
  rvol: number | null;
  regime: string | null;
  barDate: string;
  tradingViewUrl: string;
};

type ApiPayload = {
  mode: string;
  asOfDate: string | null;
  universe: string;
  universeCount: number | null;
  disclaimer: string;
  rows: Ema200Row[];
};

function indexLabel(tag: string | null): string {
  if (tag === "sp500") return "S&P 500";
  if (tag === "ndx100") return "NDX-100";
  return tag ?? "—";
}

export default function Ema200WatchlistPage() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/ema200");
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <div className="px-4 py-6 space-y-4">
      <ModuleHeader
        module="EMA200"
        title="RETRACE WATCHLIST"
        description="S&P 500 + Nasdaq-100 (~600 names scanned nightly). Double-stacked 200 EMA (close + high, PB-EMA style). Listed when price retests that ribbon and the close holds the lower line — e.g. MA on 30 Sep 2026. You decide entries in IBKR."
        source="SP500 ∪ NDX-100 · EOD"
        accent="var(--accent-info)"
      />

      {data?.disclaimer && (
        <p className="text-xs font-terminal text-[var(--text-muted)] border border-[var(--panel-border)] rounded px-3 py-2 bg-[var(--surface-alt)]">
          {data.disclaimer}
        </p>
      )}

      <p className="text-[10px] font-terminal text-[var(--text-muted)]">
        Universe: {data?.universeCount ?? "—"} symbols · as of {data?.asOfDate ?? "—"} · showing{" "}
        {rows.length} retracements
      </p>

      <ModulePanel
        title="AT 200 EMA"
        badge="SCAN"
        accent="var(--accent-info)"
        source={`${rows.length} names`}
      >
        {error ? (
          <EmptyState title="Failed to load watchlist" detail="Check API and Supabase connectivity." />
        ) : (
          <div className="overflow-x-auto -mx-3 -mb-3">
            <table className="w-full text-sm font-terminal">
              <thead>
                <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--panel-border)] bg-[var(--panel-header)]">
                  <th className="text-left px-3 py-2">TICKER</th>
                  <th className="text-left px-3 py-2">INDEX</th>
                  <th className="text-right px-3 py-2">DIST (ATR)</th>
                  <th className="text-right px-3 py-2">DAYS↑</th>
                  <th className="text-right px-3 py-2">SLOPE</th>
                  <th className="text-right px-3 py-2">RVOL</th>
                  <th className="text-left px-3 py-2">REGIME</th>
                  <th className="text-right px-3 py-2">CLOSE</th>
                  <th className="text-right px-3 py-2">EMA200 LO / HI</th>
                  <th className="text-left px-3 py-2">CHART</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-[var(--text-muted)]">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-4">
                      <EmptyState
                        title="No retracements today"
                        detail="Nothing in S&P 500 / Nasdaq-100 met the retrace + hold rules on the latest EOD bar, or nightly ema200_features has not run yet."
                      />
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr
                      key={r.symbol}
                      className="border-b border-[var(--panel-border)] hover:bg-[var(--surface-alt)]"
                    >
                      <td className="px-3 py-2">
                        <Link href={`/ticker/${r.symbol}`} className="text-[var(--accent-info)] hover:underline">
                          {r.symbol}
                        </Link>
                        <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[140px]">
                          {r.companyName}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">{indexLabel(r.indexTag)}</td>
                      <td className="px-3 py-2 text-right">{r.distAtr?.toFixed(2) ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{r.daysAbove ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {r.ema200Slope != null ? (r.ema200Slope * 100).toFixed(2) + "%" : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">{r.rvol?.toFixed(2) ?? "—"}</td>
                      <td className="px-3 py-2">{r.regime ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{r.close?.toFixed(2) ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-[11px]">
                        {r.ema200 != null ? r.ema200.toFixed(2) : "—"}
                        {r.ema200High != null ? ` / ${r.ema200High.toFixed(2)}` : ""}
                      </td>
                      <td className="px-3 py-2">
                        <a
                          href={r.tradingViewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-[var(--accent-info)]"
                        >
                          TV
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </ModulePanel>
    </div>
  );
}
