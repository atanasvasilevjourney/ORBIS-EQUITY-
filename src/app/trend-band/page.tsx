"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MultiSortBar } from "@/components/table/MultiSortBar";
import { SortableTh } from "@/components/table/SortableTh";
import { useMultiSort } from "@/hooks/useMultiSort";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { DeskSplitLayout, type DeskLayoutMode } from "@/components/desk/DeskSplitLayout";
import { TrendRibbonChart } from "@/components/diagnostics/TrendRibbonChart";
import { BandPullbackSpark } from "@/components/trendBand/BandPullbackSpark";
import type { TrendBandSparkBar } from "@/lib/trendBandPullback";

type Row = {
  symbol: string;
  barDate: string;
  setupKind: string;
  score: number | null;
  close: number | null;
  bandLo: number | null;
  bandHi: number | null;
  invalidation: number | null;
  distToBandPct: number | null;
  pullbackPct: number | null;
  advancePct: number | null;
  bandSlopePct: number | null;
  bandColor: string | null;
  bandFlip: boolean;
  daysSinceFlip: number | null;
  spark: TrendBandSparkBar[];
  emaFast: number;
  emaSlow: number;
  companyName: string;
};

type Payload = {
  asOfDate: string | null;
  headline: string | null;
  names: number;
  rows: Row[];
  dataSource?: string;
  disclaimer?: string;
  band?: { emaFast: number; emaSlow: number; note?: string };
};

const fmt = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

type SortKey =
  | "symbol"
  | "setupKind"
  | "score"
  | "close"
  | "distToBandPct"
  | "pullbackPct"
  | "invalidation";

const SORT_LABELS: Record<SortKey, string> = {
  symbol: "Ticker",
  setupKind: "Setup",
  score: "Score",
  close: "Close",
  distToBandPct: "Dist %",
  pullbackPct: "Pullback %",
  invalidation: "Invalidate",
};

function kindColor(kind: string, flip: boolean) {
  if (flip) return "var(--accent-info)";
  if (kind === "band_flip") return "var(--accent-info)";
  return "var(--accent-bull)";
}

export default function TrendBandPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<"all" | "pullback" | "band_flip">("all");
  const [flipOnly, setFlipOnly] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<DeskLayoutMode>("split");

  useEffect(() => {
    const params = new URLSearchParams();
    if (kind !== "all") params.set("kind", kind);
    if (flipOnly) params.set("flip", "1");
    setLoading(true);
    fetch(`/api/trend-band?${params}`)
      .then(async (r) => r.json())
      .then((x) => {
        setData(x);
        const first = x.rows?.[0]?.symbol;
        setSel((prev) => (prev && x.rows?.some((r: Row) => r.symbol === prev) ? prev : first ?? null));
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [kind, flipOnly]);

  const rows = data?.rows ?? [];
  const accessors = useMemo(
    (): Record<SortKey, (r: Row) => string | number | null | undefined> => ({
      symbol: (r) => r.symbol,
      setupKind: (r) => r.setupKind,
      score: (r) => r.score,
      close: (r) => r.close,
      distToBandPct: (r) => r.distToBandPct,
      pullbackPct: (r) => r.pullbackPct,
      invalidation: (r) => r.invalidation,
    }),
    []
  );
  const { sorted, levels, onHeaderClick, clearSort } = useMultiSort<Row, SortKey>(
    rows,
    accessors,
    [{ key: "score", dir: "desc" }],
    SORT_LABELS
  );
  const row = sorted.find((r) => r.symbol === sel) ?? sorted[0] ?? null;

  const chartCandles = useMemo(() => {
    if (!row?.spark?.length) return { candles: [], fast: [] as (number | null)[], slow: [] as (number | null)[] };
    const candles = row.spark.map((b) => ({
      date: b.date,
      open: b.close,
      high: b.close,
      low: b.close,
      close: b.close,
    }));
    return {
      candles,
      fast: row.spark.map((b) => b.emaFast),
      slow: row.spark.map((b) => b.emaSlow),
    };
  }, [row]);

  const usingLive = data?.dataSource !== "trend_band_setups";

  return (
    <div className="px-4 py-6 space-y-4">
      <ModuleHeader
        module="PULLBACK"
        title="TREND-BAND PULLBACK"
        description="Rising EMA 20/50 cloud pullbacks — price advances, retraces, and tests the green band without a decisive close below support. Band-flip names recently turned from falling (red) to rising (green)."
        source="EOD · LOOP + USO/XLE/XLV/DBC"
        accent="var(--accent-bull)"
      />

      {usingLive && !loading && (
        <div className="px-4 py-2 rounded border border-[var(--accent-warning)] bg-[var(--badge-bg)] text-xs font-terminal text-[var(--text-secondary)]">
          Nightly trend-band tables empty — capped live Yahoo sample. Apply{" "}
          <code className="text-[var(--text-primary)]">supabase/migrations/036_trend_band_scanner.sql</code> and run{" "}
          <code className="text-[var(--text-primary)]">python -m pipeline.trend_band_scanner.jobs.nightly</code>.
        </div>
      )}

      {data?.headline && (
        <div className="px-4 py-2 rounded border border-[var(--border)] bg-[var(--badge-bg)] text-sm font-terminal text-[var(--text-secondary)]">
          {data.headline}
          <span className="text-[var(--text-muted)]">
            {" "}
            · as of {data.asOfDate ?? "—"} · EMA {data.band?.emaFast}/{data.band?.emaSlow}
          </span>
        </div>
      )}

      {data?.disclaimer && (
        <p className="text-[10px] font-terminal text-[var(--text-muted)] border border-[var(--panel-border)] rounded px-3 py-2">
          {data.disclaimer}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {(["all", "pullback", "band_flip"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`px-2 py-1 text-[10px] font-terminal rounded border ${
              kind === k
                ? "border-[var(--accent-bull)] text-[var(--accent-bull)]"
                : "border-[var(--border)] text-[var(--text-muted)]"
            }`}
          >
            {k === "all" ? "ALL" : k.replace("_", " ").toUpperCase()}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setFlipOnly((v) => !v)}
          className={`px-2 py-1 text-[10px] font-terminal rounded border ${
            flipOnly
              ? "border-[var(--accent-info)] text-[var(--accent-info)]"
              : "border-[var(--border)] text-[var(--text-muted)]"
          }`}
        >
          FLIP ONLY
        </button>
      </div>

      <DeskSplitLayout
        mode={layoutMode}
        onModeChange={setLayoutMode}
        listTitle="SCAN · BAND"
        chartTitle="CHART · 20/50 CLOUD"
        workspaceMinHeight={640}
        list={
          <div className="overflow-x-auto">
            <MultiSortBar levels={levels} labels={SORT_LABELS} onClear={clearSort} />
            <table className="w-full text-sm font-terminal">
              <thead className="sticky top-0 z-10">
                <tr className="text-[10px] text-[var(--text-muted)] border-b border-[var(--border)] bg-[var(--surface-alt)]">
                  <th className="px-2 py-2 text-left">SPARK</th>
                  <SortableTh columnKey="symbol" label="TICKER" levels={levels} onSort={onHeaderClick} />
                  <SortableTh columnKey="setupKind" label="SETUP" levels={levels} onSort={onHeaderClick} />
                  <SortableTh columnKey="score" label="SCORE" levels={levels} align="right" onSort={onHeaderClick} />
                  <SortableTh columnKey="distToBandPct" label="DIST" levels={levels} align="right" onSort={onHeaderClick} />
                  <SortableTh columnKey="pullbackPct" label="PB %" levels={levels} align="right" onSort={onHeaderClick} />
                  <SortableTh columnKey="invalidation" label="STOP" levels={levels} align="right" onSort={onHeaderClick} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[var(--text-muted)]">
                      Loading…
                    </td>
                  </tr>
                ) : !sorted.length ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[var(--text-muted)]">
                      No setups on this filter.
                    </td>
                  </tr>
                ) : (
                  sorted.map((r) => (
                    <tr
                      key={r.symbol}
                      onClick={() => setSel(r.symbol)}
                      className="border-b border-[var(--border)] cursor-pointer hover:bg-[var(--surface-alt)]"
                      style={{ background: sel === r.symbol ? "var(--badge-bg)" : undefined }}
                    >
                      <td className="px-2 py-1">
                        <BandPullbackSpark bars={r.spark} emaFast={r.emaFast} emaSlow={r.emaSlow} />
                      </td>
                      <td className="px-3 py-2 font-bold">
                        <Link href={`/ticker/${r.symbol}?swing=1`} onClick={(e) => e.stopPropagation()}>
                          {r.symbol}
                        </Link>
                        <span className="block text-[9px] text-[var(--text-muted)] truncate max-w-[6rem]">
                          {r.companyName}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs font-bold" style={{ color: kindColor(r.setupKind, r.bandFlip) }}>
                        {r.bandFlip ? `flip D${r.daysSinceFlip ?? "?"}` : r.setupKind}
                      </td>
                      <td className="px-3 py-2 text-right">{fmt(r.score, 1)}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.distToBandPct)}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.pullbackPct)}</td>
                      <td className="px-3 py-2 text-right text-[var(--accent-bear)]">{fmt(r.invalidation)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        }
        chart={
          row && chartCandles.candles.length > 10 ? (
            <div className="rounded border border-[var(--border)] bg-[var(--card-bg)]">
              <TrendRibbonChart
                candles={chartCandles.candles}
                emaFast={chartCandles.fast}
                emaSlow={chartCandles.slow}
                fastPeriod={row.emaFast}
                slowPeriod={row.emaSlow}
                symbol={row.symbol}
                label={row.companyName}
              />
              <p className="px-4 pb-3 text-[10px] font-terminal text-[var(--text-muted)]">
                Invalidate on daily close below {fmt(row.invalidation)} (band low). Heuristic only — not a signal.
              </p>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-[var(--text-muted)] font-terminal">Select a row</div>
          )
        }
      />
    </div>
  );
}