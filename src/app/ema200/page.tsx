"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { ModulePanel } from "@/components/ui/ModulePanel";
import { FilterChip } from "@/components/ui/FilterChip";
import { EmptyState } from "@/components/ui/EmptyState";

type Ema200Row = {
  symbol: string;
  companyName: string;
  sector: string;
  setup: string;
  close: number | null;
  ema200: number | null;
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
  disclaimer: string;
  filter: string;
  rows: Ema200Row[];
};

export default function Ema200WatchlistPage() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [relaxed, setRelaxed] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const q = relaxed ? "?near=1" : "";
      const res = await fetch(`/api/ema200${q}`);
      const json = await res.json();
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [relaxed]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <div className="px-4 py-6 space-y-4">
      <ModuleHeader
        module="EMA200"
        title="RETRACE WATCHLIST"
        description="Shows names that pulled back to the rising 200 EMA and held the level (daily EOD). Discretionary only — you trade manually in IBKR."
        source="NIGHTLY FEATURES"
        accent="var(--accent-info)"
      />

      {data?.disclaimer && (
        <p className="text-xs font-terminal text-[var(--text-muted)] border border-[var(--panel-border)] rounded px-3 py-2 bg-[var(--surface-alt)]">
          {data.disclaimer}
        </p>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <FilterChip
          label="Retrace + held"
          active={!relaxed}
          onClick={() => setRelaxed(false)}
        />
        <FilterChip
          label="Near EMA (all)"
          active={relaxed}
          onClick={() => setRelaxed(true)}
        />
        <span className="text-[10px] text-[var(--text-muted)] font-terminal ml-2">
          As of {data?.asOfDate ?? "—"} · mode {data?.mode ?? "watchlist_only"}
        </span>
      </div>

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
                  <th className="text-left px-3 py-2">SETUP</th>
                  <th className="text-right px-3 py-2">DIST (ATR)</th>
                  <th className="text-right px-3 py-2">DAYS↑</th>
                  <th className="text-right px-3 py-2">SLOPE</th>
                  <th className="text-right px-3 py-2">RVOL</th>
                  <th className="text-left px-3 py-2">REGIME</th>
                  <th className="text-right px-3 py-2">CLOSE</th>
                  <th className="text-right px-3 py-2">EMA200</th>
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
                        title="No retracements on this filter"
                        detail="Either nothing is within 1.5 ATR of the 200 EMA with your trend rules, or nightly ema200_features has not run yet."
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
                      <td className="px-3 py-2 text-xs">{r.setup.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2 text-right">{r.distAtr?.toFixed(2) ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{r.daysAbove ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {r.ema200Slope != null ? (r.ema200Slope * 100).toFixed(2) + "%" : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">{r.rvol?.toFixed(2) ?? "—"}</td>
                      <td className="px-3 py-2">{r.regime ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{r.close?.toFixed(2) ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{r.ema200?.toFixed(2) ?? "—"}</td>
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
