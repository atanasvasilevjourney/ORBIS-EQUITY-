"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  TradingChart,
  type Candle,
  type ChartLevel,
  type ChartSegment,
} from "@/components/chart/TradingChart";
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
  const [sel, setSel] = useState<string | null>(null);
  const [chart, setChart] = useState<{
    candles: Candle[];
    sma20: (number | null)[];
    swing?: import("@/components/chart/TradingChart").SwingEmaLines;
    source: string;
  } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ filter });
    if (pattern !== "all") params.set("pattern", pattern);
    setLoading(true);
    fetch(`/api/triangle?${params}`)
      .then(async (r) => r.json())
      .then((x) => {
        setData(x);
        setSel((prev) => prev || x.rows?.[0]?.symbol || null);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filter, pattern]);

  const rows = data?.rows ?? [];
  const row = rows.find((r) => r.symbol === sel) ?? rows[0] ?? null;

  useEffect(() => {
    if (!row?.symbol) return;
    const ac = new AbortController();
    setChart(null);
    fetch(`/api/chart/${row.symbol}?interval=1d`, { signal: ac.signal })
      .then(async (r) => r.json())
      .then(setChart)
      .catch(() => setChart(null));
    return () => ac.abort();
  }, [row?.symbol]);

  const { segments, levels: patternLevels } = useMemo(() => {
    if (!row) return { segments: [] as ChartSegment[], levels: [] as ChartLevel[] };
    return triangleGeometryToChart(row.geometry, row.patternType);
  }, [row]);

  const breakoutLevel: ChartLevel[] = useMemo(() => {
    if (!row?.resistancePrice) return [];
    return [
      {
        price: row.resistancePrice,
        title: "resistance @ last",
        color: "var(--accent-warning)",
        dashed: false,
      },
    ];
  }, [row]);

  const levels = [...patternLevels, ...breakoutLevel];

  return (
    <div className="px-4 py-6 space-y-4">
      <ModuleHeader
        module="TRI"
        title="TRIANGLE BREAKOUT"
        description="Ascending & descending triangles on daily OHLC — pillai-style flat/rising legs with breakout detection. Chart overlays use the shared TradingChart engine (new segment layer)."
        source="EOD · LOOP universe"
        accent="var(--accent-warning)"
      />

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] max-h-[640px] overflow-y-auto">
          <table className="w-full text-sm font-terminal">
            <thead>
              <tr className="text-[10px] text-[var(--text-muted)] border-b border-[var(--border)] bg-[var(--surface-alt)]">
                <th className="text-left px-3 py-2">TICKER</th>
                <th className="text-left px-3 py-2">TYPE</th>
                <th className="text-left px-3 py-2">STATUS</th>
                <th className="text-right px-3 py-2">SCORE</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td>
                </tr>
              ) : !rows.length ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-[var(--text-muted)]">
                    No setups. Run: python -m pipeline.triangle_scanner.jobs.nightly
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={`${r.symbol}-${r.patternType}`}
                    onClick={() => setSel(r.symbol)}
                    className="border-b border-[var(--border)] cursor-pointer hover:bg-[var(--surface-alt)]"
                    style={{ background: sel === r.symbol ? "var(--badge-bg)" : undefined }}
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
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="lg:col-span-2 space-y-3">
          {row && (
            <>
              <div>
                <Link href={`/ticker/${row.symbol}?swing=1`} className="text-lg font-terminal font-bold hover:text-[var(--accent-info)]">
                  {row.symbol}
                </Link>
                <span className="ml-2 text-xs text-[var(--text-secondary)]">{row.companyName}</span>
                <div className="text-sm font-terminal mt-1" style={{ color: statusColor(row.status) }}>
                  {row.patternType} · {row.status} · close {fmt(row.close)} · support {fmt(row.supportPrice)} · res{" "}
                  {fmt(row.resistancePrice)}
                </div>
              </div>
              <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] overflow-hidden">
                <div className="px-3 py-1 text-[10px] font-terminal text-[var(--text-muted)] border-b border-[var(--border)]">
                  {row.symbol} · Triangle overlay · {chart?.source ?? "…"} · EMA ribbon + pattern legs
                </div>
                <TradingChart
                  candles={chart?.candles ?? []}
                  sma={chart?.sma20}
                  swing={chart?.swing}
                  segments={segments}
                  levels={levels}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
