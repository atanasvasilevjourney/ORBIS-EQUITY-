"use client";

import { useCallback, useEffect, useState } from "react";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { ModulePanel } from "@/components/ui/ModulePanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ema200WatchTable, type Ema200TableRow } from "@/components/ema200/Ema200WatchTable";
import { FocusUniverseBar } from "@/components/universe/FocusUniverseBar";
import { useFocusUniverse } from "@/hooks/useFocusUniverse";

type ApiPayload = {
  mode: string;
  asOfDate: string | null;
  universe: string;
  universeCount: number | null;
  shortlistAtr: number;
  approachingMaxAtr: number;
  disclaimer: string;
  watch: Ema200TableRow[];
  approaching: Ema200TableRow[];
  rows: Ema200TableRow[];
  dataSource?: string;
};

export default function Ema200WatchlistPage() {
  const { isFocusActive, symbolsParam, mode } = useFocusUniverse();
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      if (isFocusActive && symbolsParam) {
        params.set("symbols", symbolsParam);
        params.set("desk", "1");
      }
      const qs = params.toString();
      const res = await fetch(`/api/ema200${qs ? `?${qs}` : ""}`);
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [isFocusActive, symbolsParam]);

  useEffect(() => {
    load();
  }, [load]);

  const watch = data?.watch ?? data?.rows ?? [];
  const approaching = data?.approaching ?? [];

  return (
    <div className="px-4 py-6 space-y-4">
      <FocusUniverseBar moduleLabel="EMA200" />

      <ModuleHeader
        module="EMA200"
        title={isFocusActive ? "MY NASDAQ LIST · EMA200" : "RETRACE WATCHLIST"}
        description={
          isFocusActive
            ? "Scanning your Explore desk list only. Ribbon distance via live Yahoo when needed. WATCH ≤1.5 ATR; names farther out still show under desk scan."
            : "Scans S&P 500 + Nasdaq-100 index members — not every stock listed on the NASDAQ exchange. IBKR/TradingView showing “NASDAQ” is the venue, not our universe. NBIS (and other supplements) are scanned via Yahoo when missing from hosted prices. WATCH ≤1.5 ATR to the double EMA200 ribbon."
        }
        source="SP500 ∪ NDX-100 + supplements · EOD"
        accent="var(--accent-info)"
      />

      {data?.disclaimer && (
        <p className="text-xs font-terminal text-[var(--text-muted)] border border-[var(--panel-border)] rounded px-3 py-2 bg-[var(--surface-alt)]">
          {data.disclaimer}
        </p>
      )}

      <p className="text-[10px] font-terminal text-[var(--text-muted)]">
        Universe: {mode === "focus" ? `desk (${symbolsParam.split(",").filter(Boolean).length})` : `${data?.universeCount ?? "—"} index`} · as
        of {data?.asOfDate ?? "—"} · watch {watch.length} · approaching {approaching.length}
        {data?.dataSource === "prices_daily_live" ? " · live scan" : ""}
      </p>
      <p className="text-[10px] font-terminal text-[var(--text-muted)] border border-[var(--panel-border)] rounded px-3 py-2">
        <strong className="text-[var(--text-secondary)]">NASDAQ ≠ auto-included.</strong> Thousands of tickers trade on NASDAQ;
        this desk only covers ~600 large-cap index names plus configured supplements (e.g. NBIS). Re-run bootstrap if a new
        NDX-100 name is missing from <code className="text-[var(--accent-info)]">universe_members</code>.
      </p>

      <ModulePanel title="AT 200 EMA · ON WATCH" badge="≤1.5 ATR" accent="var(--accent-info)" source={`${watch.length} names`}>
        {error ? (
          <EmptyState title="Failed to load watchlist" detail="Check API and Supabase connectivity." />
        ) : loading ? (
          <p className="px-3 py-8 text-center text-[var(--text-muted)] font-terminal text-sm">Loading…</p>
        ) : watch.length === 0 ? (
          <EmptyState
            title="No retracements today"
            detail="Nothing met the retrace + hold rules on the latest EOD bar, or nightly ema200_features has not run yet."
          />
        ) : (
          <Ema200WatchTable rows={watch} emptyDetail="" />
        )}
      </ModulePanel>

      <ModulePanel
        title="APPROACHING · PULLBACK FORMING"
        badge={`1.5–${data?.approachingMaxAtr ?? 3} ATR`}
        accent="var(--accent-warning)"
        source={`${approaching.length} names`}
      >
        {loading ? (
          <p className="px-3 py-8 text-center text-[var(--text-muted)] font-terminal text-sm">Loading…</p>
        ) : approaching.length === 0 ? (
          <EmptyState
            title="No names in the approach zone"
            detail="Stocks extended above the ribbon but within 3 ATR often show up here before a touch (e.g. MA a few sessions before 30 Sep)."
          />
        ) : (
          <Ema200WatchTable rows={approaching} emptyDetail="" />
        )}
      </ModulePanel>
    </div>
  );
}
