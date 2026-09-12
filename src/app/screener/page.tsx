"use client";

import { useCallback, useEffect, useState } from "react";
import { ScoreboardRow, type ScreenerRow } from "@/components/scoreboard/ScoreboardRow";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { ModulePanel } from "@/components/ui/ModulePanel";
import { MetricCard } from "@/components/ui/MetricCard";
import { FilterChip } from "@/components/ui/FilterChip";
import { EmptyState } from "@/components/ui/EmptyState";

type Summary = {
  asOfDate: string | null;
  briefText: string | null;
  posture: number | null;
  postureLabel: string | null;
  breadth: { total: number; greens: number; reds: number; pctGreen: number; pctRed: number };
  avgRank: number;
  bestSector: string | null;
  worstSector: string | null;
};

type FilterState = {
  direction: "all" | "bull" | "bear";
  region: "all" | "us" | "uk" | "eu";
  minRank: number;
};

const DIRECTION_FILTERS = [
  { key: "all" as const, label: "All" },
  { key: "bull" as const, label: "Bull" },
  { key: "bear" as const, label: "Bear" },
];

const REGION_FILTERS = [
  { key: "all" as const, label: "ALL" },
  { key: "us" as const, label: "US" },
  { key: "uk" as const, label: "UK" },
  { key: "eu" as const, label: "EU" },
];

const RANK_FILTERS = [
  { key: 0, label: "Any" },
  { key: 60, label: "Q≥60" },
  { key: 70, label: "Q≥70" },
  { key: 80, label: "Q≥80" },
];

export default function ScreenerPage() {
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    direction: "all",
    region: "all",
    minRank: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
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
      else setRows([]);
      setSummary(summaryData);
    } catch (e) {
      console.error("Failed to fetch screener data:", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const postureColor =
    (summary?.posture ?? 50) >= 55
      ? "var(--accent-bull)"
      : (summary?.posture ?? 50) <= 45
        ? "var(--accent-bear)"
        : "var(--text-primary)";

  return (
    <div className="px-4 py-6 space-y-4">
      <ModuleHeader
        module="MODULE 1"
        title="SWING SCREENER"
        description="Momentum & technical bias board — bull/bear swing candidates"
        source="TREND RADAR · EOD"
        accent="var(--module-1)"
      />

      {/* Compact status strip — table stays the hero */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <MetricCard
          label="POSTURE"
          value={summary?.posture ?? "—"}
          sub={summary?.postureLabel ?? undefined}
          color={postureColor}
          bar={typeof summary?.posture === "number" ? summary.posture : undefined}
          barColor={postureColor}
        />
        <MetricCard
          label="BREADTH"
          value={summary?.breadth ? `${summary.breadth.pctGreen}%` : "—"}
          sub={summary?.breadth ? `${summary.breadth.total} names` : undefined}
          color="var(--accent-bull)"
          bar={summary?.breadth?.pctGreen}
          barColor="var(--accent-bull)"
        />
        <MetricCard label="BEST" value={summary?.bestSector ?? "—"} sub="Leading" color="var(--accent-bull)" />
        <MetricCard label="WORST" value={summary?.worstSector ?? "—"} sub="Lagging" color="var(--accent-bear)" />
        <MetricCard label="AVG RANK" value={summary?.avgRank ?? "—"} sub="Quality" />
      </div>

      {summary?.briefText && (
        <ModulePanel title="SESSION BRIEF" badge="AI" accent="var(--module-1)" source="RULE-BASED">
          <p className="text-sm font-terminal text-[var(--text-secondary)] leading-relaxed">
            {summary.briefText}
          </p>
        </ModulePanel>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {DIRECTION_FILTERS.map((f) => (
          <FilterChip
            key={f.key}
            label={f.label}
            active={filters.direction === f.key}
            onClick={() => setFilters((p) => ({ ...p, direction: f.key }))}
          />
        ))}
        <span className="w-px h-4 bg-[var(--panel-border)] mx-1" />
        {REGION_FILTERS.map((f) => (
          <FilterChip
            key={f.key}
            label={f.label}
            active={filters.region === f.key}
            onClick={() => setFilters((p) => ({ ...p, region: f.key }))}
          />
        ))}
        <span className="w-px h-4 bg-[var(--panel-border)] mx-1" />
        {RANK_FILTERS.map((f) => (
          <FilterChip
            key={f.key}
            label={f.label}
            active={filters.minRank === f.key}
            onClick={() => setFilters((p) => ({ ...p, minRank: f.key }))}
          />
        ))}
      </div>

      <ModulePanel
        title="SCOREBOARD"
        badge="TABLE"
        accent="var(--module-1)"
        source={`${rows.length} NAMES · ${summary?.asOfDate ?? "—"} EOD`}
      >
        {error ? (
          <EmptyState title="Failed to load screener" detail="Check API connectivity and try again." />
        ) : (
          <div className="overflow-x-auto -mx-3 -mb-3">
            <table className="w-full text-sm font-terminal">
              <thead>
                <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--panel-border)] bg-[var(--panel-header)]">
                  <th className="text-left px-3 py-2">TICKER</th>
                  <th className="text-left px-3 py-2">BIAS</th>
                  <th className="text-left px-3 py-2">AGREE</th>
                  <th className="text-left px-3 py-2">SECTOR</th>
                  <th className="text-right px-3 py-2">LAST</th>
                  <th className="text-right px-3 py-2">MKT CAP</th>
                  <th className="text-left px-3 py-2">BADGES</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-[var(--text-muted)]">
                      Loading scoreboard…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-4">
                      <EmptyState
                        title="No names match these filters"
                        detail="Relax direction/region/quality filters, or run the nightly pipeline if the universe is empty."
                      />
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => <ScoreboardRow key={r.symbol} row={r} />)
                )}
              </tbody>
            </table>
          </div>
        )}
      </ModulePanel>
    </div>
  );
}
