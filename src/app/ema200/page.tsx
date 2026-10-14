"use client";

import { useCallback, useEffect, useState } from "react";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { ModulePanel } from "@/components/ui/ModulePanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ema200WatchTable, type Ema200TableRow } from "@/components/ema200/Ema200WatchTable";

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
};

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

  const watch = data?.watch ?? data?.rows ?? [];
  const approaching = data?.approaching ?? [];

  return (
    <div className="px-4 py-6 space-y-4">
      <ModuleHeader
        module="EMA200"
        title="RETRACE WATCHLIST"
        description="Distance to the double EMA200 ribbon (ATR, $, %). WATCH ≤1.5 ATR; APPROACHING 1.5–3 ATR. Names only appear when the latest EOD bar qualifies (e.g. MA on 30 Sep 2026, not when price is extended like MA at ~6 ATR above the ribbon). Live scan uses prices_daily when ema200_features is empty."
        source="SP500 ∪ NDX-100 · EOD"
        accent="var(--accent-info)"
      />

      {data?.disclaimer && (
        <p className="text-xs font-terminal text-[var(--text-muted)] border border-[var(--panel-border)] rounded px-3 py-2 bg-[var(--surface-alt)]">
          {data.disclaimer}
        </p>
      )}

      <p className="text-[10px] font-terminal text-[var(--text-muted)]">
        Universe: {data?.universeCount ?? "—"} symbols · as of {data?.asOfDate ?? "—"} · watch {watch.length} ·
        approaching {approaching.length}
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
