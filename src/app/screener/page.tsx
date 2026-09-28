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
  breadth: {
    total: number;
    greens: number;
    reds: number;
    pctGreen: number;
    pctRed: number;
    advancersPct?: number;
  };
  avgRank: number;
  bestSector: string | null;
  worstSector: string | null;
};

type FilterState = {
  direction: "all" | "bull" | "bear" | "hot";
  region: "all" | "us" | "uk" | "eu";
  minDay: number;
};

const DIRECTION_FILTERS = [
  { key: "bull" as const, label: "On list" },
  { key: "hot" as const, label: "Hot" },
  { key: "all" as const, label: "All" },
  { key: "bear" as const, label: "Down day" },
];

const REGION_FILTERS = [
  { key: "all" as const, label: "ALL" },
  { key: "us" as const, label: "US" },
  { key: "uk" as const, label: "UK" },
  { key: "eu" as const, label: "EU" },
];

const DAY_FILTERS = [
  { key: 0, label: "Any day" },
  { key: 4, label: "Day ≥4%" },
  { key: 10, label: "Day ≥10%" },
];

export default function ScreenerPage() {
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    direction: "bull",
    region: "all",
    minDay: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    if (filters.direction !== "all") params.set("direction", filters.direction);
    if (filters.region !== "all") params.set("region", filters.region);
    if (filters.minDay > 0) params.set("min_day", String(filters.minDay));

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
        title="WATCHLIST"
        description="Scan only. On list: day ≥ +4% and volume ≥ 2× the prior 50-day average. Hot: ≥ +10% and ≥ 5×. Sorted by distance from the session high. Orders come from other modules."
        source="EOD PRICES"
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
          label="ADVANCERS"
          value={summary?.breadth?.advancersPct != null ? `${summary.breadth.advancersPct}%` : "—"}
          sub={summary?.breadth ? `${summary.breadth.total} names` : undefined}
          color="var(--accent-bull)"
          bar={summary?.breadth?.advancersPct}
          barColor="var(--accent-bull)"
        />
        <MetricCard label="ON LIST" value={summary?.breadth?.greens ?? "—"} sub="Day + volume" color="var(--accent-bull)" />
        <MetricCard label="BEST" value={summary?.bestSector ?? "—"} sub="Avg day" color="var(--accent-bull)" />
        <MetricCard label="WORST" value={summary?.worstSector ?? "—"} sub="Avg day" color="var(--accent-bear)" />
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
        {DAY_FILTERS.map((f) => (
          <FilterChip
            key={f.key}
            label={f.label}
            active={filters.minDay === f.key}
            onClick={() => setFilters((p) => ({ ...p, minDay: f.key }))}
          />
        ))}
      </div>

      <ModulePanel
        title="WATCHLIST"
        badge="SCAN"
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
                  <th className="text-left px-3 py-2">STATUS</th>
                  <th className="text-right px-3 py-2">DAY</th>
                  <th className="text-right px-3 py-2">REL VOL</th>
                  <th className="text-right px-3 py-2">OFF HIGH</th>
                  <th className="text-left px-3 py-2">SECTOR</th>
                  <th className="text-right px-3 py-2">LAST</th>
                  <th className="text-left px-3 py-2">BADGES</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">
                      Loading scoreboard…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-4">
                      <EmptyState
                        title="No names on this scan"
                        detail="On list needs a day of at least +4% and volume at least 2× the prior 50-day average. Switch to All to see every name sorted by distance from the session high."
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
