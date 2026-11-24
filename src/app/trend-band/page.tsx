"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MultiSortBar } from "@/components/table/MultiSortBar";
import { SortableTh } from "@/components/table/SortableTh";
import { useMultiSort } from "@/hooks/useMultiSort";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { DeskSplitLayout, type DeskLayoutMode } from "@/components/desk/DeskSplitLayout";
import { Ema200BandChart } from "@/components/trendBand/Ema200BandChart";
import { Ema200BandSpark } from "@/components/trendBand/Ema200BandSpark";
import type { PbEmaSparkBar } from "@/lib/trendBandPullback";

type Row = {
  symbol: string;
  barDate: string;
  timeframes: string[];
  assetClass: string;
  setupKind: string;
  score: number | null;
  close: number | null;
  bandLo: number | null;
  bandHi: number | null;
  invalidation: number | null;
  distToBandPct: number | null;
  pullbackPct: number | null;
  bandFlip: boolean;
  dualTimeframe: boolean;
  spark: PbEmaSparkBar[];
  sparkByTf: Record<string, PbEmaSparkBar[]>;
  companyName: string;
};

type Payload = {
  asOfDate: string | null;
  headline: string | null;
  rows: Row[];
  dataSource?: string;
  disclaimer?: string;
  band?: { emaPeriod: number; upper: string; lower: string; note?: string };
};

const fmt = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

type SortKey = "symbol" | "setupKind" | "score" | "distToBandPct" | "pullbackPct" | "invalidation";

const SORT_LABELS: Record<SortKey, string> = {
  symbol: "Ticker",
  setupKind: "Setup",
  score: "Score",
  distToBandPct: "Dist %",
  pullbackPct: "Pullback %",
  invalidation: "Invalidate",
};

export default function TrendBandPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<"all" | "pullback" | "band_flip">("all");
  const [flipOnly, setFlipOnly] = useState(false);
  const [timeframe, setTimeframe] = useState<"all" | "1d" | "1wk">("all");
  const [assetClass, setAssetClass] = useState<"all" | "equity" | "etf" | "index" | "crypto">("all");
  const [sel, setSel] = useState<string | null>(null);
  const [chartTf, setChartTf] = useState<"1d" | "1wk">("1d");
  const [layoutMode, setLayoutMode] = useState<DeskLayoutMode>("split");

  useEffect(() => {
    const params = new URLSearchParams();
    if (kind !== "all") params.set("kind", kind);
    if (flipOnly) params.set("flip", "1");
    if (timeframe !== "all") params.set("timeframe", timeframe);
    if (assetClass !== "all") params.set("asset", assetClass);
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
  }, [kind, flipOnly, timeframe, assetClass]);

  const rows = data?.rows ?? [];
  const accessors = useMemo(
    (): Record<SortKey, (r: Row) => string | number | null | undefined> => ({
      symbol: (r) => r.symbol,
      setupKind: (r) => r.setupKind,
      score: (r) => r.score,
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

  const chartBars = useMemo(() => {
    if (!row) return [];
    return row.sparkByTf?.[chartTf] ?? row.spark ?? [];
  }, [row, chartTf]);

  const usingLive = data?.dataSource !== "trend_band_setups";

  return (
    <div className="px-4 py-6 space-y-4">
      <ModuleHeader
        module="PULLBACK"
        title="pb_ema · EMA200 BAND PULLBACK"
        description="Pullback into the pb_ema band: upper = EMA200(high), lower = EMA200(low). Scans daily and weekly (longer-term positioning). Green when the band is rising; invalidate on close below EMA200-of-lows. Built on the same Pine EMA200 seeding as the EMA200 watchlist — that desk scores proximity to the close/high ribbon; this scanner targets the high/low band pullbacks."
        source="EOD + weekly · ema200_universe + ETFs/indices/crypto"
        accent="var(--accent-bull)"
      />

      {usingLive && !loading && (
        <div className="px-4 py-2 rounded border border-[var(--accent-warning)] bg-[var(--badge-bg)] text-xs font-terminal text-[var(--text-secondary)]">
          Nightly tables empty or partial — showing capped live Yahoo sample. Apply migrations{" "}
          <code className="text-[var(--text-primary)]">036</code> + <code className="text-[var(--text-primary)]">037</code>{" "}
          and run <code className="text-[var(--text-primary)]">python -m pipeline.trend_band_scanner.jobs.nightly</code>.
        </div>
      )}

      {data?.headline && (
        <div className="px-4 py-2 rounded border border-[var(--border)] bg-[var(--badge-bg)] text-sm font-terminal text-[var(--text-secondary)]">
          {data.headline}
          <span className="text-[var(--text-muted)]"> · as of {data.asOfDate ?? "—"}</span>
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
              kind === k ? "border-[var(--accent-bull)] text-[var(--accent-bull)]" : "border-[var(--border)] text-[var(--text-muted)]"
            }`}
          >
            {k === "all" ? "ALL" : k.replace("_", " ").toUpperCase()}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setFlipOnly((v) => !v)}
          className={`px-2 py-1 text-[10px] font-terminal rounded border ${
            flipOnly ? "border-[var(--accent-info)] text-[var(--accent-info)]" : "border-[var(--border)] text-[var(--text-muted)]"
          }`}
        >
          FLIP ONLY
        </button>
        {(["all", "1d", "1wk"] as const).map((tf) => (
          <button
            key={tf}
            type="button"
            onClick={() => setTimeframe(tf)}
            className={`px-2 py-1 text-[10px] font-terminal rounded border ${
              timeframe === tf ? "border-[var(--accent-warning)] text-[var(--accent-warning)]" : "border-[var(--border)] text-[var(--text-muted)]"
            }`}
          >
            {tf === "all" ? "ALL TF" : tf.toUpperCase()}
          </button>
        ))}
        {(["all", "equity", "etf", "index", "crypto"] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAssetClass(a)}
            className={`px-2 py-1 text-[10px] font-terminal rounded border ${
              assetClass === a ? "border-[var(--accent-info)] text-[var(--accent-info)]" : "border-[var(--border)] text-[var(--text-muted)]"
            }`}
          >
            {a.toUpperCase()}
          </button>
        ))}
      </div>

      <DeskSplitLayout
        mode={layoutMode}
        onModeChange={setLayoutMode}
        listTitle="SCAN · pb_ema"
        chartTitle="CHART · EMA200 HIGH/LOW"
        workspaceMinHeight={640}
        list={
          <div className="overflow-x-auto">
            <MultiSortBar levels={levels} labels={SORT_LABELS} onClear={clearSort} />
            <table className="w-full text-sm font-terminal">
              <thead className="sticky top-0 z-10">
                <tr className="text-[10px] text-[var(--text-muted)] border-b border-[var(--border)] bg-[var(--surface-alt)]">
                  <th className="px-2 py-2 text-left">SPARK</th>
                  <SortableTh columnKey="symbol" label="TICKER" levels={levels} onSort={onHeaderClick} />
                  <th className="px-2 py-2 text-left">TF</th>
                  <th className="px-2 py-2 text-left">CLASS</th>
                  <SortableTh columnKey="setupKind" label="SETUP" levels={levels} onSort={onHeaderClick} />
                  <SortableTh columnKey="score" label="SCORE" levels={levels} align="right" onSort={onHeaderClick} />
                  <SortableTh columnKey="distToBandPct" label="DIST" levels={levels} align="right" onSort={onHeaderClick} />
                  <SortableTh columnKey="invalidation" label="STOP" levels={levels} align="right" onSort={onHeaderClick} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td>
                  </tr>
                ) : !sorted.length ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">No setups on this filter.</td>
                  </tr>
                ) : (
                  sorted.map((r) => (
                    <tr
                      key={r.symbol}
                      onClick={() => {
                        setSel(r.symbol);
                        setChartTf((r.timeframes.includes("1d") ? "1d" : r.timeframes[0] === "1wk" ? "1wk" : "1d") as "1d" | "1wk");
                      }}
                      className="border-b border-[var(--border)] cursor-pointer hover:bg-[var(--surface-alt)]"
                      style={{ background: sel === r.symbol ? "var(--badge-bg)" : undefined }}
                    >
                      <td className="px-2 py-1">
                        <Ema200BandSpark bars={r.spark} />
                      </td>
                      <td className="px-3 py-2 font-bold">
                        <Link href={`/ticker/${r.symbol}?swing=1`} onClick={(e) => e.stopPropagation()}>
                          {r.symbol}
                        </Link>
                        {r.dualTimeframe && (
                          <span className="ml-1 text-[9px] text-[var(--accent-warning)]">D+W</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-[10px]">{r.timeframes.join("+")}</td>
                      <td className="px-2 py-2 text-[10px] text-[var(--text-muted)]">{r.assetClass}</td>
                      <td className="px-3 py-2 text-xs">{r.bandFlip ? "flip" : r.setupKind}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.score, 1)}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.distToBandPct)}</td>
                      <td className="px-3 py-2 text-right text-[var(--accent-bear)]">{fmt(r.invalidation)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        }
        chart={
          row && chartBars.length > 10 ? (
            <div className="rounded border border-[var(--border)] bg-[var(--card-bg)]">
              <div className="flex gap-2 px-4 pt-3">
                {(["1d", "1wk"] as const).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    disabled={!row.timeframes.includes(tf)}
                    onClick={() => setChartTf(tf)}
                    className="px-2 py-0.5 text-[10px] font-terminal rounded border disabled:opacity-40"
                    style={{
                      borderColor: chartTf === tf ? "var(--accent-bull)" : "var(--border)",
                      color: chartTf === tf ? "var(--accent-bull)" : "var(--text-muted)",
                    }}
                  >
                    {tf.toUpperCase()}
                  </button>
                ))}
              </div>
              <Ema200BandChart bars={chartBars} timeframe={chartTf} symbol={row.symbol} label={row.companyName} />
              <p className="px-4 pb-3 text-[10px] font-terminal text-[var(--text-muted)]">
                Invalidate below EMA200 low ({fmt(row.invalidation)}). Heuristic only.
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