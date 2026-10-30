"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ScoreboardRow, type ScreenerRow } from "@/components/scoreboard/ScoreboardRow";
import { MultiSortBar } from "@/components/table/MultiSortBar";
import { SortableTh } from "@/components/table/SortableTh";
import { useMultiSort } from "@/hooks/useMultiSort";
import { FilterChip } from "@/components/ui/FilterChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { FocusUniverseModuleBanner } from "@/components/universe/FocusUniverseModuleBanner";
import { useFocusUniverse } from "@/hooks/useFocusUniverse";
import { ChartPane } from "@/components/desk/ChartPane";
import { DeskSplitLayout, type DeskLayoutMode } from "@/components/desk/DeskSplitLayout";
import { useWatchlistKeyboard } from "@/hooks/useWatchlistKeyboard";

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

type ScreenerSortKey =
  | "symbol"
  | "orbisScore"
  | "dayPct"
  | "relVolume"
  | "pctFromHigh"
  | "rank"
  | "sector"
  | "price"
  | "marketCap";

const SCREENER_SORT_LABELS: Record<ScreenerSortKey, string> = {
  symbol: "Ticker",
  orbisScore: "Orbis",
  dayPct: "Day %",
  relVolume: "Rel vol",
  pctFromHigh: "Off high",
  rank: "Rank",
  sector: "Sector",
  price: "Last",
  marketCap: "Mkt cap",
};

const SCREENER_ACCESSORS: Record<ScreenerSortKey, (r: ScreenerRow) => string | number | null | undefined> = {
  symbol: (r) => r.symbol,
  orbisScore: (r) => r.orbisScore,
  dayPct: (r) => r.dayPct ?? r.zMom,
  relVolume: (r) => r.relVolume ?? r.fEwmac,
  pctFromHigh: (r) => r.pctFromHigh ?? r.z52 * 100,
  rank: (r) => r.rank,
  sector: (r) => r.sector,
  price: (r) => r.price,
  marketCap: (r) => r.marketCap,
};

export type WatchlistWorkspaceVariant = "tc2000" | "tos";

type Props = {
  variant?: WatchlistWorkspaceVariant;
};

export function WatchlistChartsWorkspace({ variant = "tc2000" }: Props) {
  const isTos = variant === "tos";
  const { isFocusActive, symbolsParam, universeParam } = useFocusUniverse();
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    direction: "bull",
    region: "all",
    minDay: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [chartInterval, setChartInterval] = useState<"1d" | "5m">("1d");
  const [layoutMode, setLayoutMode] = useState<DeskLayoutMode>("split");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    if (filters.direction !== "all") params.set("direction", filters.direction);
    if (filters.region !== "all") params.set("region", filters.region);
    if (filters.minDay > 0) params.set("min_day", String(filters.minDay));
    if (isFocusActive && symbolsParam) params.set("symbols", symbolsParam);
    else if (universeParam) params.set("universe", universeParam);

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
  }, [filters, isFocusActive, symbolsParam, universeParam]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const accessors = useMemo(() => SCREENER_ACCESSORS, []);
  const { sorted: sortedRows, levels, onHeaderClick, clearSort } = useMultiSort<ScreenerRow, ScreenerSortKey>(
    rows,
    accessors,
    [{ key: "pctFromHigh", dir: "desc" }],
    SCREENER_SORT_LABELS
  );

  const selectedRow = sortedRows.find((r) => r.symbol === selected) ?? sortedRows[0] ?? null;
  const symbolList = useMemo(() => sortedRows.map((r) => r.symbol), [sortedRows]);

  useWatchlistKeyboard({
    symbols: symbolList,
    selected: selectedRow?.symbol ?? null,
    onSelect: setSelected,
    onInterval: setChartInterval,
    enabled: isTos && !error && sortedRows.length > 0,
  });

  useEffect(() => {
    if (!sortedRows.length) {
      setSelected(null);
      return;
    }
    if (!selected || !sortedRows.some((r) => r.symbol === selected)) {
      setSelected(sortedRows[0].symbol);
    }
  }, [sortedRows, selected]);

  const postureColor =
    (summary?.posture ?? 50) >= 55
      ? "var(--accent-bull)"
      : (summary?.posture ?? 50) <= 45
        ? "var(--accent-bear)"
        : "var(--text-primary)";

  const listTitle = isTos ? "MARKETWATCH" : "WATCHLIST · SCAN";
  const chartTitle = isTos ? "CHARTS" : "CHART · EMA RIBBON";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden py-2">
      <FocusUniverseModuleBanner allowIndexDesk />

      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
        <h1 className="font-display text-lg font-semibold tracking-tight text-[var(--text-primary)]">
          {isTos ? "TRADE" : "WATCHLIST"}
        </h1>
        <p
          className="min-w-0 text-[11px] font-terminal text-[var(--text-muted)]"
          title={
            isTos
              ? "MarketWatch left, chart right. ↑↓ symbol, D daily, 5 five-minute. Scan only."
              : "Watchlist left, chart right. FULL for chart-only. Scan only."
          }
        >
          {isTos ? "MarketWatch + chart · ↑↓ · D / 5" : "Scan + chart · click headers to sort"}
        </p>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-terminal">
          <span>
            <span className="text-[var(--text-muted)]">POSTURE </span>
            <span style={{ color: postureColor }}>{summary?.posture ?? "—"}</span>
          </span>
          <span>
            <span className="text-[var(--text-muted)]">ADV </span>
            <span className="text-[var(--accent-bull)]">
              {summary?.breadth?.advancersPct != null ? `${summary.breadth.advancersPct}%` : "—"}
            </span>
          </span>
          <span>
            <span className="text-[var(--text-muted)]">ON LIST </span>
            <span className="text-[var(--accent-bull)]">{summary?.breadth?.greens ?? "—"}</span>
          </span>
          <span className="hidden sm:inline">
            <span className="text-[var(--text-muted)]">BEST </span>
            <span className="text-[var(--accent-bull)]">{summary?.bestSector ?? "—"}</span>
          </span>
          <span className="hidden md:inline">
            <span className="text-[var(--text-muted)]">WORST </span>
            <span className="text-[var(--accent-bear)]">{summary?.worstSector ?? "—"}</span>
          </span>
        </div>
      </div>

      {summary?.briefText && (
        <p className="shrink-0 truncate text-[11px] font-terminal text-[var(--text-secondary)]" title={summary.briefText}>
          {summary.briefText}
        </p>
      )}

      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
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

      <p className="shrink-0 text-[11px] font-terminal text-[var(--text-muted)]">
        {sortedRows.length} names · {summary?.asOfDate ?? "—"} EOD · selected {selectedRow?.symbol ?? "—"}
      </p>

      {error ? (
        <EmptyState title="Failed to load screener" detail="Check API connectivity and try again." />
      ) : (
        <DeskSplitLayout
          mode={layoutMode}
          onModeChange={setLayoutMode}
          variant={isTos ? "tos" : "default"}
          listTitle={listTitle}
          chartTitle={chartTitle}
          fit
          list={
            <div className="min-w-0">
              <MultiSortBar levels={levels} labels={SCREENER_SORT_LABELS} onClear={clearSort} />
              <table className="desk-table desk-table-fit">
                <thead className="sticky top-0 z-20">
                  <tr className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] text-[var(--text-muted)]">
                    <SortableTh
                      columnKey="symbol"
                      label="TICKER"
                      levels={levels}
                      onSort={onHeaderClick}
                      className="sticky left-0 z-30 bg-[var(--panel-header)]"
                    />
                    <th className="text-left px-3 py-2">STATUS</th>
                    <SortableTh columnKey="orbisScore" label="ORBIS" levels={levels} align="right" onSort={onHeaderClick} />
                    <SortableTh columnKey="dayPct" label="DAY" levels={levels} align="right" onSort={onHeaderClick} />
                    <SortableTh columnKey="relVolume" label="REL VOL" levels={levels} align="right" onSort={onHeaderClick} />
                    <SortableTh columnKey="pctFromHigh" label="OFF HIGH" levels={levels} align="right" onSort={onHeaderClick} />
                    <SortableTh columnKey="price" label="LAST" levels={levels} align="right" onSort={onHeaderClick} />
                    <SortableTh columnKey="sector" label="SECTOR" levels={levels} onSort={onHeaderClick} />
                    {layoutMode === "list" && <th className="text-left px-3 py-2">BADGES</th>}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={layoutMode === "list" ? 9 : 8} className="px-3 py-8 text-center text-[var(--text-muted)]">
                        Loading scoreboard…
                      </td>
                    </tr>
                  ) : sortedRows.length === 0 ? (
                    <tr>
                      <td colSpan={layoutMode === "list" ? 9 : 8} className="px-3 py-4">
                        <EmptyState
                          title="No names on this scan"
                          detail="On list needs a day of at least +4% and volume at least 2× the prior 50-day average. Switch to All to see every name sorted by distance from the session high."
                        />
                      </td>
                    </tr>
                  ) : (
                    sortedRows.map((r) => (
                      <ScoreboardRow
                        key={r.symbol}
                        row={r}
                        selected={selectedRow?.symbol === r.symbol}
                        onSelect={setSelected}
                        showCompany={layoutMode === "list"}
                        showBadges={layoutMode === "list"}
                        stickySymbol
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          }
          chart={
            <ChartPane
              symbol={selectedRow?.symbol ?? null}
              companyName={selectedRow?.companyName}
              interval={chartInterval}
              onIntervalChange={setChartInterval}
              fill
              showQuoteStrip={isTos}
              quoteRow={selectedRow}
            />
          }
        />
      )}
    </div>
  );
}
