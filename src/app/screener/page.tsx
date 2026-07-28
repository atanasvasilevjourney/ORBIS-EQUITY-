"use client";

import { useCallback, useEffect, useState } from "react";
import { ScoreboardRow, type ScreenerRow } from "@/components/scoreboard/ScoreboardRow";

type Summary = {
  asOfDate: string | null;
  briefText: string | null;
  posture: number | null;
  postureLabel: string | null;
  breadth: { total: number; greens: number; reds: number; pctGreen: number; pctRed: number };
  avgRank: number;
  bestSector: string | null;
  worstSector: string | null;
  regionBreadth: Record<string, number>;
};

type FilterState = {
  direction: "all" | "bull" | "bear";
  region: "all" | "us" | "uk" | "eu";
  minRank: number;
};

const DIRECTION_FILTERS = [
  { key: "all", label: "All" },
  { key: "bull", label: "Bull" },
  { key: "bear", label: "Bear" },
] as const;

const REGION_FILTERS = [
  { key: "all", label: "ALL" },
  { key: "us", label: "US" },
  { key: "uk", label: "UK" },
  { key: "eu", label: "EU" },
] as const;

const RANK_FILTERS = [
  { key: 0, label: "Any" },
  { key: 60, label: "Q>=60" },
  { key: 70, label: "Q>=70" },
  { key: 80, label: "Q>=80" },
] as const;

export default function ScreenerPage() {
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filters, setFilters] = useState<FilterState>({ direction: "all", region: "all", minRank: 0 });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.direction !== "all") params.set("direction", filters.direction);
    if (filters.region !== "all") params.set("region", filters.region);
    if (filters.minRank > 0) params.set("min_rank", String(filters.minRank));

    try {
      const [screenerRes, summaryRes] = await Promise.all([
        fetch(`/api/screener?${params}`),
        fetch("/api/summary"),
      ]);
      const screenerData = await screenerRes.json();
      const summaryData = await summaryRes.json();

      if (Array.isArray(screenerData)) setRows(screenerData);
      setSummary(summaryData);
    } catch (e) {
      console.error("Failed to fetch screener data:", e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const postureColor = (summary?.posture ?? 50) >= 55
    ? "var(--accent-bull)"
    : (summary?.posture ?? 50) <= 45
      ? "var(--accent-bear)"
      : "var(--text-primary)";

  return (
    <div className="px-4 py-6">
      {/* Section summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
          <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">POSTURE</div>
          <div className="text-xl font-terminal font-bold mt-1" style={{ color: postureColor }}>
            {summary?.posture ?? "—"}
          </div>
          <div className="text-xs text-[var(--text-secondary)]">{summary?.postureLabel ?? "—"}</div>
        </div>
        <div className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
          <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">BREADTH</div>
          <div className="text-xl font-terminal font-bold mt-1" style={{ color: "var(--accent-bull)" }}>
            {summary?.breadth.pctGreen ?? "—"}%
          </div>
          <div className="text-xs text-[var(--text-secondary)]">{summary?.breadth.total ?? 0} names</div>
        </div>
        <div className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
          <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">BEST SECTOR</div>
          <div className="text-lg font-terminal font-bold mt-1">{summary?.bestSector ?? "—"}</div>
          <div className="text-xs text-[var(--text-secondary)]">Leading</div>
        </div>
        <div className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
          <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">WORST SECTOR</div>
          <div className="text-lg font-terminal font-bold mt-1">{summary?.worstSector ?? "—"}</div>
          <div className="text-xs text-[var(--text-secondary)]">Lagging</div>
        </div>
        <div className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
          <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">AVG RANK</div>
          <div className="text-xl font-terminal font-bold mt-1">{summary?.avgRank ?? "—"}</div>
          <div className="text-xs text-[var(--text-secondary)]">Quality</div>
        </div>
      </div>

      {/* AI Brief banner */}
      {summary?.briefText && (
        <div className="px-4 py-2 mb-4 rounded border border-[var(--border)] bg-[var(--badge-bg)] text-sm text-[var(--text-secondary)] font-terminal">
          <span style={{ color: "var(--accent-info)" }}>AI:</span> {summary.briefText}
        </div>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {DIRECTION_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilters((p) => ({ ...p, direction: f.key }))}
            className={`px-3 py-1 text-xs font-terminal rounded border transition-colors ${
              filters.direction === f.key
                ? "border-[var(--accent-info)] text-[var(--accent-info)]"
                : "border-[var(--border)] hover:bg-[var(--surface-alt)]"
            }`}
          >
            {f.label}
          </button>
        ))}

        <span className="border-l border-[var(--border)] mx-1" />

        {REGION_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilters((p) => ({ ...p, region: f.key }))}
            className={`px-3 py-1 text-xs font-terminal rounded border transition-colors ${
              filters.region === f.key
                ? "border-[var(--accent-info)] text-[var(--accent-info)]"
                : "border-[var(--border)] hover:bg-[var(--surface-alt)]"
            }`}
          >
            {f.label}
          </button>
        ))}

        <span className="border-l border-[var(--border)] mx-1" />

        {RANK_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilters((p) => ({ ...p, minRank: f.key }))}
            className={`px-3 py-1 text-xs font-terminal rounded border transition-colors ${
              filters.minRank === f.key
                ? "border-[var(--accent-info)] text-[var(--accent-info)]"
                : "border-[var(--border)] hover:bg-[var(--surface-alt)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Scoreboard table */}
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">BIAS</th>
              <th className="text-left px-3 py-2">AGREE</th>
              <th className="text-left px-3 py-2">CONV</th>
              <th className="text-right px-3 py-2">LAST</th>
              <th className="text-right px-3 py-2">MKT CAP</th>
              <th className="text-left px-3 py-2">BADGES</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[var(--text-muted)]">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[var(--text-muted)]">
                  No data. Run pipeline to populate: python -m pipeline.ingest.universe
                </td>
              </tr>
            ) : (
              rows.map((r) => <ScoreboardRow key={r.symbol} row={r} />)
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3">
        <p className="text-xs text-[var(--text-muted)] font-terminal">
          {rows.length} names | Data: {summary?.asOfDate ?? "—"} EOD
        </p>
      </div>
    </div>
  );
}
