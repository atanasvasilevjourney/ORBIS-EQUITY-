"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScoreboardRow, type ScreenerRow } from "@/components/scoreboard/ScoreboardRow";
import { sectorsMatch } from "@/lib/sectorBreadth";

type SectorMember = { symbol: string; state: number; rank: number };
type SectorScore = {
  sector: string;
  n: number;
  green: number;
  red: number;
  grey: number;
  net: number;
  names?: SectorMember[];
};

type Summary = {
  asOfDate: string | null;
  briefText: string | null;
  storedBrief?: string | null;
  briefSource?: string;
  posture: number | null;
  postureLabel: string | null;
  breadth: { total: number; greens: number; reds: number; greys?: number; pctGreen: number; pctRed: number };
  avgRank: number;
  bestSector: string | null;
  worstSector: string | null;
  bestSectorScore: number | null;
  worstSectorScore: number | null;
  sectors?: SectorScore[];
  regionBreadth: Record<string, number>;
  tape?: { source: string | null; lastClose: string | null; names: number };
};

type FilterState = {
  direction: "all" | "bull" | "bear";
  region: "all" | "us" | "uk" | "eu";
  minRank: number;
  sector: string | null;
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

function netColor(net: number | null | undefined): string {
  if (net == null) return "var(--text-primary)";
  if (net > 0) return "var(--accent-bull)";
  if (net < 0) return "var(--accent-bear)";
  return "var(--text-primary)";
}

function sectorProof(score: SectorScore | undefined): string {
  if (!score) return "—";
  const ticks = (score.names ?? []).slice(0, 8).map((n) => n.symbol).join(" · ");
  return `${score.green}G / ${score.red}R / ${score.grey}X · ${score.n} names${ticks ? ` · ${ticks}` : ""}`;
}

export default function ScreenerPage() {
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filters, setFilters] = useState<FilterState>({ direction: "all", region: "all", minRank: 0, sector: null });
  const [loading, setLoading] = useState(true);
  const [maxRank, setMaxRank] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pinnedLead = useRef(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ meta: "1" });
    if (filters.direction !== "all") params.set("direction", filters.direction);
    if (filters.region !== "all") params.set("region", filters.region);
    if (filters.minRank > 0) params.set("min_rank", String(filters.minRank));
    if (filters.sector) params.set("sector", filters.sector);

    try {
      const [screenerRes, summaryRes] = await Promise.all([
        fetch(`/api/screener?${params}`),
        fetch("/api/summary"),
      ]);
      const screenerData = await screenerRes.json();
      const summaryData = await summaryRes.json();

      const nextRows = Array.isArray(screenerData)
        ? screenerData
        : Array.isArray(screenerData?.rows)
          ? screenerData.rows
          : [];
      setRows(nextRows);
      if (screenerData?.meta?.maxRank != null) setMaxRank(screenerData.meta.maxRank);
      if (screenerData?.error) setError(String(screenerData.error));
      setSummary(summaryData);

      if (!pinnedLead.current && !filters.sector && summaryData?.bestSector) {
        pinnedLead.current = true;
        setFilters((p) => (p.sector ? p : { ...p, sector: summaryData.bestSector }));
      }
    } catch (e) {
      console.error("Failed to fetch screener data:", e);
      setError("Screener fetch failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const selectedSector = useMemo(
    () => (summary?.sectors ?? []).find((s) => sectorsMatch(s.sector, filters.sector)),
    [summary?.sectors, filters.sector]
  );
  const bestScore = useMemo(
    () => (summary?.sectors ?? []).find((s) => sectorsMatch(s.sector, summary?.bestSector)),
    [summary?.sectors, summary?.bestSector]
  );
  const worstScore = useMemo(
    () => (summary?.sectors ?? []).find((s) => sectorsMatch(s.sector, summary?.worstSector)),
    [summary?.sectors, summary?.worstSector]
  );

  const tableSectors = useMemo(() => new Set(rows.map((r) => r.sector)), [rows]);
  const tableMatchesLead = Boolean(
    filters.sector && rows.length > 0 && [...tableSectors].every((s) => sectorsMatch(s, filters.sector))
  );

  const postureColor = (summary?.posture ?? 50) >= 55
    ? "var(--accent-bull)"
    : (summary?.posture ?? 50) <= 45
      ? "var(--accent-bear)"
      : "var(--text-primary)";

  return (
    <div className="px-4 py-6">
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
            {summary?.breadth?.pctGreen ?? "—"}%
          </div>
          <div className="text-xs text-[var(--text-secondary)]">
            {summary?.breadth
              ? `${summary.breadth.greens}G / ${summary.breadth.reds}R of ${summary.breadth.total}`
              : "—"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setFilters((p) => ({ ...p, sector: summary?.bestSector ?? null }))}
          className={`p-3 rounded border bg-[var(--card-bg)] text-center ${
            sectorsMatch(filters.sector, summary?.bestSector)
              ? "border-[var(--accent-bull)]"
              : "border-[var(--border)]"
          }`}
        >
          <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">BEST SECTOR</div>
          <div className="text-lg font-terminal font-bold mt-1" style={{ color: "var(--accent-bull)" }}>
            {summary?.bestSector ?? "—"}
          </div>
          <div className="text-xs text-[var(--text-secondary)]">
            {bestScore
              ? `Net ${bestScore.net} · ${bestScore.green}G/${bestScore.red}R/${bestScore.n}`
              : summary?.bestSectorScore != null
                ? `Net ${summary.bestSectorScore}`
                : "Leading"}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setFilters((p) => ({ ...p, sector: summary?.worstSector ?? null }))}
          className={`p-3 rounded border bg-[var(--card-bg)] text-center ${
            sectorsMatch(filters.sector, summary?.worstSector)
              ? "border-[var(--accent-bear)]"
              : "border-[var(--border)]"
          }`}
        >
          <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">WORST SECTOR</div>
          <div className="text-lg font-terminal font-bold mt-1" style={{ color: "var(--accent-bear)" }}>
            {summary?.worstSector ?? "—"}
          </div>
          <div className="text-xs text-[var(--text-secondary)]">
            {worstScore
              ? `Net ${worstScore.net} · ${worstScore.green}G/${worstScore.red}R/${worstScore.n}`
              : summary?.worstSectorScore != null
                ? `Net ${summary.worstSectorScore}`
                : "Lagging"}
          </div>
        </button>
        <div className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
          <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">AVG RANK</div>
          <div className="text-xl font-terminal font-bold mt-1">{summary?.avgRank ?? "—"}</div>
          <div className="text-xs text-[var(--text-secondary)]">Quality</div>
        </div>
      </div>

      {bestScore && (
        <div className="px-4 py-2 mb-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-xs font-terminal text-[var(--text-secondary)]">
          <span style={{ color: "var(--accent-bull)" }}>LEAD:</span> {bestScore.sector} {sectorProof(bestScore)}
        </div>
      )}

      {summary?.briefText && (
        <div className="px-4 py-2 mb-4 rounded border border-[var(--border)] bg-[var(--badge-bg)] text-sm text-[var(--text-secondary)] font-terminal">
          <span style={{ color: "var(--accent-info)" }}>AI:</span> {summary.briefText}
          {summary.briefSource === "live_radar" && (
            <span className="text-[10px] text-[var(--text-muted)] ml-2">live radar</span>
          )}
        </div>
      )}

      {!!summary?.sectors?.length && (
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={() => { pinnedLead.current = true; setFilters((p) => ({ ...p, sector: null })); }}
            className={`px-3 py-1 text-xs font-terminal rounded border ${
              !filters.sector
                ? "border-[var(--accent-info)] text-[var(--accent-info)]"
                : "border-[var(--border)] hover:bg-[var(--surface-alt)]"
            }`}
          >
            All sectors
          </button>
          {summary.sectors.map((s) => {
            const active = sectorsMatch(filters.sector, s.sector);
            return (
              <button
                key={s.sector}
                type="button"
                onClick={() => {
                  pinnedLead.current = true;
                  setFilters((p) => ({ ...p, sector: active ? null : s.sector }));
                }}
                className={`px-3 py-1 text-xs font-terminal rounded border ${
                  active
                    ? "border-[var(--accent-info)] text-[var(--accent-info)]"
                    : "border-[var(--border)] hover:bg-[var(--surface-alt)]"
                }`}
                style={{ color: active ? undefined : netColor(s.net) }}
              >
                {s.sector} {s.net > 0 ? "+" : ""}{s.net} · {s.green}G/{s.red}R/{s.n}
              </button>
            );
          })}
        </div>
      )}

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

      <p className="text-xs font-terminal text-[var(--text-muted)] mb-2">
        {filters.sector
          ? `Table is ${filters.sector} only${selectedSector ? ` · net ${selectedSector.net} · ${selectedSector.green}G/${selectedSector.red}R/${selectedSector.n}` : ""}${tableMatchesLead ? " · rows match the card" : ""}`
          : "Table is all-sector Q-rank — tap BEST or a sector chip to prove the lead"}
      </p>

      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">SECTOR</th>
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
                <td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">
                  {error
                    ? `Screener error: ${error}`
                    : filters.minRank > 0 || filters.direction !== "all" || filters.region !== "all" || filters.sector
                      ? `No names match these filters${filters.minRank ? ` (Q>=${filters.minRank}${maxRank != null ? `; highest rank is ${maxRank}` : ""})` : ""}. Click Any / All sectors, or tap the leading sector card.`
                      : "No radar rows. Re-run python -m pipeline.compute.trend_radar after cash EOD ingest."}
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
          {rows.length} names · LAST $ = cash EOD ({summary?.tape?.source ?? "yahoo"}) · {summary?.asOfDate ?? "—"} · live LSE last is quotes_last, not this board
        </p>
      </div>
    </div>
  );
}
