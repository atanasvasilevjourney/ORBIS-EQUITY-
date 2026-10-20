"use client";

import { useEffect, useMemo, useState } from "react";
import { MultiSortBar } from "@/components/table/MultiSortBar";
import { SortableTh } from "@/components/table/SortableTh";
import { useMultiSort } from "@/hooks/useMultiSort";
import Link from "next/link";
import type { ChartLevel } from "@/components/chart/TradingChart";
import { ChartPane } from "@/components/desk/ChartPane";
import { DeskSplitLayout, type DeskLayoutMode } from "@/components/desk/DeskSplitLayout";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { triangleGeometryToChart, type TriangleHit } from "@/lib/trianglePattern";

type Row = {
  symbol: string;
  barDate: string;
  patternType: "ascending" | "descending";
  status: string;
  score: number | null;
  close: number | null;
  supportPrice: number | null;
  resistancePrice: number | null;
  geometry: TriangleHit["geometry"] | null;
  companyName: string;
};

type Payload = {
  asOfDate: string | null;
  headline: string | null;
  names: number;
  rows: Row[];
  dataSource?: string;
  disclaimer?: string;
};

const fmt = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

type TriSortKey = "symbol" | "patternType" | "status" | "score" | "close" | "supportPrice" | "resistancePrice";

const TRI_SORT_LABELS: Record<TriSortKey, string> = {
  symbol: "Ticker",
  patternType: "Type",
  status: "Status",
  score: "Score",
  close: "Close",
  supportPrice: "Support",
  resistancePrice: "Resistance",
};

function rowKey(r: Row) {
  return `${r.symbol}::${r.patternType}`;
}

function statusColor(status: string) {
  if (status === "breakout_up") return "var(--accent-bull)";
  if (status === "breakout_down") return "var(--accent-bear)";
  return "var(--accent-warning)";
}

export default function TrianglePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"breakout" | "forming" | "all">("breakout");
  const [pattern, setPattern] = useState<"all" | "ascending" | "descending">("all");
  const [selKey, setSelKey] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<DeskLayoutMode>("split");

  useEffect(() => {
    const params = new URLSearchParams({ filter });
    if (pattern !== "all") params.set("pattern", pattern);
    setLoading(true);
    fetch(`/api/triangle?${params}`)
      .then(async (r) => r.json())
      .then((x) => {
        setData(x);
        const first = x.rows?.[0];
        setSelKey((prev) => {
          if (prev && x.rows?.some((r: Row) => rowKey(r) === prev)) return prev;
          return first ? rowKey(first) : null;
        });
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filter, pattern]);

  const rows = data?.rows ?? [];
  const triAccessors = useMemo(
    (): Record<TriSortKey, (r: Row) => string | number | null | undefined> => ({
      symbol: (r) => r.symbol,
      patternType: (r) => r.patternType,
      status: (r) => r.status,
      score: (r) => r.score,
      close: (r) => r.close,
      supportPrice: (r) => r.supportPrice,
      resistancePrice: (r) => r.resistancePrice,
    }),
    []
  );
  const { sorted: sortedRows, levels: sortLevels, onHeaderClick, clearSort } = useMultiSort<Row, TriSortKey>(
    rows,
    triAccessors,
    [{ key: "score", dir: "desc" }],
    TRI_SORT_LABELS
  );
  const row = sortedRows.find((r) => rowKey(r) === selKey) ?? sortedRows[0] ?? null;

  const { segments, levels: patternLevels } = useMemo(() => {
    if (!row) return { segments: [], levels: [] as ChartLevel[] };
    return triangleGeometryToChart(row.geometry, row.patternType);
  }, [row]);

  const levels = useMemo((): ChartLevel[] => {
    const breakoutLevel: ChartLevel[] = row?.resistancePrice
      ? [
          {
            price: row.resistancePrice,
            title: "resistance @ last",
            color: "var(--accent-warning)",
            dashed: false,
          },
        ]
      : [];
    return [...patternLevels, ...breakoutLevel];
  }, [patternLevels, row?.resistancePrice]);

  const usingLiveFallback = data?.dataSource !== "triangle_setups";

  const patternMeta = row
    ? (
        <span
          className="text-[10px] font-terminal px-2 py-0.5 rounded border"
          style={{ borderColor: statusColor(row.status), color: statusColor(row.status) }}
        >
          {row.patternType} · {row.status} · close {fmt(row.close)} · S {fmt(row.supportPrice)} · R {fmt(row.resistancePrice)}
        </span>
      )
    : null;

  return (
    <div className="px-4 py-6 space-y-4">
      <ModuleHeader
        module="TRI"
        title="TRIANGLE BREAKOUT"
        description="Ascending & descending triangles on daily OHLC — pillai-style flat/rising legs with breakout detection. Chart overlays use the shared TradingChart engine (segment layer)."
        source="EOD · LOOP universe"
        accent="var(--accent-warning)"
      />

      {usingLiveFallback && !loading && (
        <div className="px-4 py-2 rounded border border-[var(--accent-warning)] bg-[var(--badge-bg)] text-xs font-terminal text-[var(--text-secondary)]">
          Nightly triangle tables not found or empty — showing a capped live Yahoo sample. Apply{" "}
          <code className="text-[var(--text-primary)]">supabase/migrations/029_triangle_scanner.sql</code> and run{" "}
          <code className="text-[var(--text-primary)]">python -m pipeline.triangle_scanner.jobs.nightly</code>. See{" "}
          <Link href="/status" className="text-[var(--accent-info)] hover:underline">system status</Link>.
        </div>
      )}

      {data?.headline && (
        <div className="px-4 py-2 rounded border border-[var(--border)] bg-[var(--badge-bg)] text-sm font-terminal text-[var(--text-secondary)]">
          {data.headline}
          <span className="text-[var(--text-muted)]">
            {" "}
            · as of {data.asOfDate ?? "—"} · {data.dataSource === "triangle_setups" ? "nightly DB" : "live Yahoo sample"}
          </span>
        </div>
      )}

      {data?.disclaimer && (
        <p className="text-[10px] font-terminal text-[var(--text-muted)] border border-[var(--panel-border)] rounded px-3 py-2">
          {data.disclaimer}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {(["breakout", "forming", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-2 py-1 text-[10px] font-terminal rounded border ${
              filter === f
                ? "border-[var(--accent-warning)] text-[var(--accent-warning)]"
                : "border-[var(--border)] text-[var(--text-muted)]"
            }`}
          >
            {f.toUpperCase()}
          </button>
        ))}
        {(["all", "ascending", "descending"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPattern(p)}
            className={`px-2 py-1 text-[10px] font-terminal rounded border ${
              pattern === p
                ? "border-[var(--accent-info)] text-[var(--accent-info)]"
                : "border-[var(--border)] text-[var(--text-muted)]"
            }`}
          >
            {p === "all" ? "BOTH" : p.toUpperCase()}
          </button>
        ))}
      </div>

      <p className="text-[10px] font-terminal text-[var(--text-muted)]">
        {sortedRows.length} setups · selected {row ? `${row.symbol} (${row.patternType})` : "—"}
      </p>

      <DeskSplitLayout
        mode={layoutMode}
        onModeChange={setLayoutMode}
        listTitle="SETUPS · TRI"
        chartTitle="CHART · TRIANGLE OVERLAY"
        workspaceMinHeight={640}
        list={
          <div className="overflow-x-auto">
            <MultiSortBar levels={sortLevels} labels={TRI_SORT_LABELS} onClear={clearSort} />
            <table className="w-full text-sm font-terminal">
              <thead className="sticky top-0 z-10">
                <tr className="text-[10px] text-[var(--text-muted)] border-b border-[var(--border)] bg-[var(--surface-alt)]">
                  <SortableTh columnKey="symbol" label="TICKER" levels={sortLevels} onSort={onHeaderClick} />
                  <SortableTh columnKey="patternType" label="TYPE" levels={sortLevels} onSort={onHeaderClick} />
                  <SortableTh columnKey="status" label="STATUS" levels={sortLevels} onSort={onHeaderClick} />
                  <SortableTh columnKey="score" label="SCORE" levels={sortLevels} align="right" onSort={onHeaderClick} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td>
                  </tr>
                ) : !sortedRows.length ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-[var(--text-muted)]">
                      No setups. Run: python -m pipeline.triangle_scanner.jobs.nightly
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((r) => {
                    const key = rowKey(r);
                    return (
                      <tr
                        key={key}
                        onClick={() => setSelKey(key)}
                        className="border-b border-[var(--border)] cursor-pointer hover:bg-[var(--surface-alt)]"
                        style={{ background: selKey === key ? "var(--badge-bg)" : undefined }}
                      >
                        <td className="px-3 py-2 font-bold">
                          <Link href={`/ticker/${r.symbol}?swing=1`} onClick={(e) => e.stopPropagation()}>
                            {r.symbol}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-xs">{r.patternType}</td>
                        <td className="px-3 py-2 text-xs font-bold" style={{ color: statusColor(r.status) }}>
                          {r.status}
                        </td>
                        <td className="px-3 py-2 text-right">{fmt(r.score, 1)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        }
        chart={
          <ChartPane
            symbol={row?.symbol ?? null}
            companyName={row?.companyName}
            interval="1d"
            fill={layoutMode === "chart"}
            height={layoutMode === "chart" ? undefined : 520}
            segments={segments}
            levels={levels}
            toolbarExtra={patternMeta}
          />
        }
      />
    </div>
  );
}
