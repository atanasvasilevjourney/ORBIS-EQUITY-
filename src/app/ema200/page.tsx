"use client";

import { useCallback, useEffect, useState } from "react";
import { NASDAQ_VENUE_DISCLAIMER } from "@/lib/focusUniverse";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { ModulePanel } from "@/components/ui/ModulePanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ema200WatchTable, type Ema200TableRow } from "@/components/ema200/Ema200WatchTable";
import { FocusUniverseModuleBanner } from "@/components/universe/FocusUniverseModuleBanner";
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
  desk?: Ema200TableRow[];
  rows: Ema200TableRow[];
  dataSource?: string;
};

export default function Ema200WatchlistPage() {
  const { isFocusActive, symbolsParam, universeParam, deskLabel, isWatchlist } = useFocusUniverse();
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deskOtherOpen, setDeskOtherOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      if (isFocusActive && symbolsParam) {
        params.set("symbols", symbolsParam);
        params.set("desk", "1");
      } else if (universeParam) {
        params.set("universe", universeParam);
      }
      const qs = params.toString();
      const res = await fetch(`/api/ema200${qs ? `?${qs}` : ""}`);
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [isFocusActive, symbolsParam, universeParam]);

  useEffect(() => {
    load();
  }, [load]);

  const watch = data?.watch ?? data?.rows ?? [];
  const approaching = data?.approaching ?? [];
  const deskOther = data?.desk ?? [];
  const deskScanActive = isFocusActive && Boolean(symbolsParam);

  return (
    <div className="px-4 py-6 space-y-4">
      <FocusUniverseModuleBanner />

      <ModuleHeader
        module="EMA200"
        title={isFocusActive ? "MY WATCHLIST · EMA200" : "RETRACE WATCHLIST"}
        description={
          isFocusActive
            ? "Scanning your watchlist only. Ribbon distance via live Yahoo when needed. WATCH ≤1.5 ATR; names farther out still show under desk scan."
            : `Scans ${deskLabel} (index desk). Not every stock on the NASDAQ exchange — venue ≠ universe. WATCH ≤1.5 ATR to the double EMA200 ribbon.`
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
        Universe: {isWatchlist ? `watchlist (${symbolsParam.split(",").filter(Boolean).length})` : deskLabel} · as
        of {data?.asOfDate ?? "—"} · watch {watch.length} · approaching {approaching.length}
        {data?.dataSource === "prices_daily_live" ? " · live scan" : ""}
      </p>
      <p className="text-[10px] font-terminal text-[var(--text-muted)] border border-[var(--panel-border)] rounded px-3 py-2">
        {NASDAQ_VENUE_DISCLAIMER}
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

      {deskScanActive && deskOther.length > 0 && (
        <ModulePanel
          title="OTHER NAMES ON YOUR LIST"
          badge={`${deskOther.length}`}
          accent="var(--accent-desk)"
          source="Sorted by ribbon ATR"
        >
          <button
            type="button"
            onClick={() => setDeskOtherOpen((o) => !o)}
            className="w-full text-left px-3 py-2 text-[10px] font-terminal text-[var(--text-muted)] border-b border-[var(--panel-border)] hover:bg-[var(--surface-alt)]"
          >
            {deskOtherOpen ? "▼" : "▶"} Other names on your list ({deskOther.length}) — not in watch / approaching
          </button>
          {deskOtherOpen && <Ema200WatchTable rows={deskOther} emptyDetail="" />}
        </ModulePanel>
      )}
    </div>
  );
}
