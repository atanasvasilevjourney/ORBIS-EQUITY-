"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NASDAQ_VENUE_DISCLAIMER } from "@/lib/focusUniverse";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { ModulePanel } from "@/components/ui/ModulePanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { PanelLoadingSkeleton } from "@/components/ui/TableSkeleton";
import { fetchJson } from "@/lib/clientFetch";
import { Ema200WatchTable, type Ema200TableRow } from "@/components/ema200/Ema200WatchTable";
import { Ema200BandPullbackDesk } from "@/components/ema200/Ema200BandPullbackDesk";
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

type DeskView = "ribbon" | "pullback";

export default function Ema200WatchlistPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view: DeskView = searchParams.get("view") === "pullback" ? "pullback" : "ribbon";
  const { isFocusActive, symbolsParam, universeParam, deskLabel, isWatchlist } = useFocusUniverse();
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deskOtherOpen, setDeskOtherOpen] = useState(false);

  const setView = (v: DeskView) => {
    const params = new URLSearchParams(searchParams.toString());
    if (v === "pullback") params.set("view", "pullback");
    else params.delete("view");
    const qs = params.toString();
    router.replace(qs ? `/ema200?${qs}` : "/ema200", { scroll: false });
  };

  const load = useCallback(async () => {
    const hadData = data != null;
    if (!hadData) setLoading(true);
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
      const res = await fetchJson<ApiPayload>(`/api/ema200${qs ? `?${qs}` : ""}`, undefined, {
        timeoutMs: 75_000,
      });
      if (res.timedOut || !res.ok || !res.data) {
        setError(true);
        return;
      }
      setData(res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [isFocusActive, symbolsParam, universeParam, data]);

  useEffect(() => {
    if (view === "ribbon") load();
  }, [load, view]);

  const watch = data?.watch ?? data?.rows ?? [];
  const approaching = data?.approaching ?? [];
  const deskOther = data?.desk ?? [];
  const deskScanActive = isFocusActive && Boolean(symbolsParam);

  return (
    <div className="px-4 py-6 space-y-4">
      <FocusUniverseModuleBanner allowIndexDesk />

      <ModuleHeader
        module="EMA200"
        title={isFocusActive ? "MY WATCHLIST · EMA200" : "EMA200 DESK"}
        description={
          isFocusActive
            ? "Your list on one desk: ribbon proximity (WATCH / APPROACHING) and pb_ema band pullbacks (daily + weekly) share the same EMA200 math."
            : `Ribbon retrace watch and band pullback scan on ${deskLabel}. Same Pine EMA200 stack — ribbon uses close/high proximity; band tab scores pullbacks into EMA200(high/low).`
        }
        source="SP500 ∪ NDX-100 + supplements · EOD"
        accent="var(--accent-info)"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setView("ribbon")}
          className={`px-3 py-1.5 text-[10px] font-terminal rounded border ${
            view === "ribbon"
              ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
              : "border-[var(--border)] text-[var(--text-muted)]"
          }`}
        >
          RIBBON · WATCH
        </button>
        <button
          type="button"
          onClick={() => setView("pullback")}
          className={`px-3 py-1.5 text-[10px] font-terminal rounded border ${
            view === "pullback"
              ? "border-[var(--accent-bull)] text-[var(--accent-bull)] bg-[var(--badge-bg)]"
              : "border-[var(--border)] text-[var(--text-muted)]"
          }`}
        >
          BAND PULLBACK
        </button>
      </div>

      {view === "pullback" ? (
        <Ema200BandPullbackDesk symbolsParam={symbolsParam} deskActive={deskScanActive} />
      ) : (
        <>
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
            ) : loading && !data ? (
              <PanelLoadingSkeleton label="Loading EMA200 watchlist…" />
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
            {loading && !data ? (
              <PanelLoadingSkeleton label="Loading approaching names…" />
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
        </>
      )}
    </div>
  );
}