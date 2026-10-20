"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { FundamentalsModuleTabs } from "@/components/fundamentals/FundamentalsModuleTabs";
import { FilterChip } from "@/components/ui/FilterChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { BiasChip } from "@/components/scoreboard/BiasChip";
import { MultiSortBar } from "@/components/table/MultiSortBar";
import { SortableTh } from "@/components/table/SortableTh";
import { useMultiSort } from "@/hooks/useMultiSort";
import {
  FUNDAMENTAL_PRESETS,
  SCREENER_UI_FILTERS,
  type ScreenerPresetId,
  type ScreenerQuery,
  screenerQueryToSearchParams,
} from "@/lib/fundamentalsScreener";

type ResultRow = {
  symbol: string;
  companyName: string;
  sector: string;
  state: number | null;
  rank: number | null;
  orbisScore: number | null;
  pe: number | null;
  roe: number | null;
  compositeScore: number | null;
  fScore: number | null;
  divYield: number | null;
  revGrowth1y: number | null;
  verdict: string | null;
  marketCap: number | null;
};

type RangeDraft = Record<string, { min: string; max: string }>;

const PRESET_IDS = Object.keys(FUNDAMENTAL_PRESETS) as Exclude<ScreenerPresetId, "custom">[];

const REGION_OPTIONS = [
  { key: "all", label: "ALL REGIONS" },
  { key: "us", label: "US" },
  { key: "uk", label: "UK" },
  { key: "eu", label: "EU" },
] as const;

type FaSortKey =
  | "symbol"
  | "orbisScore"
  | "compositeScore"
  | "fScore"
  | "pe"
  | "roe"
  | "revGrowth1y"
  | "marketCap"
  | "verdict";

const FA_SORT_LABELS: Record<FaSortKey, string> = {
  symbol: "Ticker",
  orbisScore: "Orbis",
  compositeScore: "Comp",
  fScore: "F",
  pe: "P/E",
  roe: "ROE",
  revGrowth1y: "Rev 1Y",
  marketCap: "Mkt cap",
  verdict: "Verdict",
};

function emptyRanges(): RangeDraft {
  const d: RangeDraft = {};
  for (const f of SCREENER_UI_FILTERS) {
    d[f.field] = { min: "", max: "" };
  }
  return d;
}

function buildQueryFromDraft(
  preset: ScreenerPresetId,
  sector: string,
  region: string,
  verdict: string,
  watchlistOnly: boolean,
  minRank: number,
  ranges: RangeDraft
): ScreenerQuery {
  const rangeRecord: ScreenerQuery["ranges"] = {};
  for (const [field, { min, max }] of Object.entries(ranges)) {
    const minN = min === "" ? undefined : Number(min);
    const maxN = max === "" ? undefined : Number(max);
    if (minN !== undefined && !Number.isNaN(minN) || maxN !== undefined && !Number.isNaN(maxN)) {
      rangeRecord[field] = {
        min: minN !== undefined && !Number.isNaN(minN) ? minN : undefined,
        max: maxN !== undefined && !Number.isNaN(maxN) ? maxN : undefined,
      };
    }
  }
  return {
    preset,
    sector: sector || undefined,
    region: region as ScreenerQuery["region"],
    verdict: verdict || undefined,
    watchlistOnly,
    minRank,
    ranges: rangeRecord,
    sort: "composite_factor_score",
    sortAsc: false,
    limit: 400,
  };
}

function fmtCap(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e12) return (v / 1e12).toFixed(1) + "T";
  if (v >= 1e9) return (v / 1e9).toFixed(0) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(0) + "M";
  return v.toLocaleString();
}

export default function FundamentalsScreenerPage() {
  const [preset, setPreset] = useState<ScreenerPresetId>("quality_value");
  const [sector, setSector] = useState("");
  const [region, setRegion] = useState("all");
  const [verdict, setVerdict] = useState("");
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [minRank, setMinRank] = useState(0);
  const [ranges, setRanges] = useState<RangeDraft>(emptyRanges);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [appliedPreset, setAppliedPreset] = useState<ScreenerPresetId | null>(null);

  const runScreen = useCallback(
    async (rangeDraft: RangeDraft = ranges) => {
      setLoading(true);
      setError(false);
      const q = buildQueryFromDraft(preset, sector, region, verdict, watchlistOnly, minRank, rangeDraft);
      const sp = screenerQueryToSearchParams(q);
      try {
        const res = await fetch(`/api/fundamentals/screener?${sp}`);
        if (!res.ok) throw new Error("bad status");
        const data = await res.json();
        setRows(data.rows ?? []);
        setSectors(data.sectors ?? []);
        setAppliedPreset(data.query?.preset ?? preset);
      } catch {
        setError(true);
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [preset, sector, region, verdict, watchlistOnly, minRank, ranges]
  );

  useEffect(() => {
    runScreen(emptyRanges());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preset/chips only; ranges apply on Run screen
  }, [preset, sector, region, verdict, watchlistOnly, minRank]);

  const applyPreset = (id: Exclude<ScreenerPresetId, "custom">) => {
    setPreset(id);
    setRanges(emptyRanges());
    if (id === "conviction") {
      setWatchlistOnly(true);
      setMinRank(50);
    } else {
      setWatchlistOnly(false);
      setMinRank(0);
    }
  };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (sector) n++;
    if (region !== "all") n++;
    if (verdict) n++;
    if (watchlistOnly) n++;
    if (minRank > 0) n++;
    for (const { min, max } of Object.values(ranges)) {
      if (min || max) n++;
    }
    return n;
  }, [sector, region, verdict, watchlistOnly, minRank, ranges]);

  const faAccessors = useMemo(
    (): Record<FaSortKey, (r: ResultRow) => string | number | null | undefined> => ({
      symbol: (r) => r.symbol,
      orbisScore: (r) => r.orbisScore,
      compositeScore: (r) => r.compositeScore,
      fScore: (r) => r.fScore,
      pe: (r) => r.pe,
      roe: (r) => r.roe,
      revGrowth1y: (r) => r.revGrowth1y,
      marketCap: (r) => r.marketCap,
      verdict: (r) => r.verdict,
    }),
    []
  );
  const { sorted: sortedRows, levels, onHeaderClick, clearSort } = useMultiSort<ResultRow, FaSortKey>(
    rows,
    faAccessors,
    [{ key: "compositeScore", dir: "desc" }],
    FA_SORT_LABELS
  );

  const presetDescription =
    preset !== "custom" && preset in FUNDAMENTAL_PRESETS
      ? FUNDAMENTAL_PRESETS[preset as Exclude<ScreenerPresetId, "custom">].description
      : null;

  return (
    <div className="px-4 py-6 max-w-[1400px] mx-auto">
      <ModuleHeader
        module="MODULE 2B"
        title="FUNDAMENTAL SCREENER"
        description="Range filters on quant fundamentals — intersect with the momentum watchlist for conviction names"
        source="FACTORS · STATEMENTS · EOD"
        accent="var(--module-2)"
      />

      <FundamentalsModuleTabs />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[10px] font-terminal text-[var(--text-muted)]">
          {activeFilterCount} active filter{activeFilterCount === 1 ? "" : "s"}
          {appliedPreset && appliedPreset !== "custom" ? ` · preset: ${appliedPreset}` : ""}
        </span>
      </div>

      <div className="mb-4">
        <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest mb-2">PRESETS</div>
        <div className="flex flex-wrap gap-2">
          {PRESET_IDS.map((id) => (
            <FilterChip
              key={id}
              label={FUNDAMENTAL_PRESETS[id].label}
              active={preset === id}
              onClick={() => applyPreset(id)}
            />
          ))}
          <FilterChip
            label="CUSTOM"
            active={preset === "custom"}
            onClick={() => setPreset("custom")}
          />
        </div>
        {presetDescription && (
          <p className="text-xs text-[var(--text-muted)] font-terminal mt-2">{presetDescription}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {REGION_OPTIONS.map((r) => (
          <FilterChip
            key={r.key}
            label={r.label}
            active={region === r.key}
            onClick={() => setRegion(r.key)}
          />
        ))}
        <FilterChip
          label="WATCHLIST ONLY"
          active={watchlistOnly}
          onClick={() => setWatchlistOnly((v) => !v)}
        />
        <FilterChip
          label="RANK ≥ 60"
          active={minRank >= 60}
          onClick={() => setMinRank((v) => (v >= 60 ? 0 : 60))}
        />
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="px-2 py-1 text-xs font-terminal rounded border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-primary)]"
        >
          <option value="">All sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={verdict}
          onChange={(e) => setVerdict(e.target.value)}
          className="px-2 py-1 text-xs font-terminal rounded border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-primary)]"
        >
          <option value="">All verdicts</option>
          {["STRONG", "ATTRACTIVE", "NEUTRAL", "WEAK", "DISTRESSED"].map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            setPreset("custom");
            setRanges(emptyRanges());
            setSector("");
            setRegion("all");
            setVerdict("");
            setWatchlistOnly(false);
            setMinRank(0);
          }}
          className="px-3 py-1 text-xs font-terminal rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          Clear ranges
        </button>
        <button
          type="button"
          onClick={() => runScreen(ranges)}
          className="px-3 py-1 text-xs font-terminal rounded border border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
        >
          Run screen
        </button>
      </div>

      <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3 mb-4 overflow-x-auto">
        <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest mb-2">RANGE FILTERS</div>
        <table className="w-full text-xs font-terminal min-w-[640px]">
          <thead>
            <tr className="text-[var(--text-muted)]">
              <th className="text-left py-1 pr-2">Metric</th>
              <th className="text-left py-1 px-2">From</th>
              <th className="text-left py-1 px-2">To</th>
            </tr>
          </thead>
          <tbody>
            {SCREENER_UI_FILTERS.map(({ field, label, hint, step }) => (
              <tr key={field} className="border-t border-[var(--border)]">
                <td className="py-1.5 pr-2 text-[var(--text-primary)]">
                  {label}
                  {hint && <span className="ml-1 text-[10px] text-[var(--text-muted)]">({hint})</span>}
                </td>
                <td className="py-1 px-2">
                  <input
                    type="number"
                    step={step ?? "any"}
                    value={ranges[field]?.min ?? ""}
                    onChange={(e) =>
                      setRanges((prev) => ({
                        ...prev,
                        [field]: { ...prev[field], min: e.target.value },
                      }))
                    }
                    onFocus={() => setPreset("custom")}
                    className="w-24 px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)]"
                    placeholder="min"
                  />
                </td>
                <td className="py-1 px-2">
                  <input
                    type="number"
                    step={step ?? "any"}
                    value={ranges[field]?.max ?? ""}
                    onChange={(e) =>
                      setRanges((prev) => ({
                        ...prev,
                        [field]: { ...prev[field], max: e.target.value },
                      }))
                    }
                    onFocus={() => setPreset("custom")}
                    className="w-24 px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)]"
                    placeholder="max"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && (
        <div className="py-12 text-center text-[var(--text-muted)] font-terminal">Running screen…</div>
      )}

      {!loading && error && (
        <EmptyState title="Screen failed" detail="Check API connectivity and try again." />
      )}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: "MATCHES", value: String(sortedRows.length) },
              {
                label: "ON WATCHLIST",
                value: String(sortedRows.filter((r) => r.state === 1).length),
                color: "var(--accent-bull)",
              },
              {
                label: "COMP 70+",
                value: String(sortedRows.filter((r) => (r.compositeScore ?? 0) >= 70).length),
                color: "var(--accent-bull)",
              },
              {
                label: "STRONG / ATTRACTIVE",
                value: String(sortedRows.filter((r) => r.verdict === "STRONG" || r.verdict === "ATTRACTIVE").length),
                color: "var(--accent-info)",
              },
            ].map((c) => (
              <div key={c.label} className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
                <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">{c.label}</div>
                <div
                  className="text-lg font-terminal font-bold mt-0.5"
                  style={{ color: (c as { color?: string }).color }}
                >
                  {c.value}
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded border border-[var(--border)]">
            <MultiSortBar levels={levels} labels={FA_SORT_LABELS} onClear={clearSort} />
            <table className="w-full text-sm font-terminal">
              <thead>
                <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
                  <SortableTh columnKey="symbol" label="TICKER" levels={levels} onSort={onHeaderClick} />
                  <SortableTh columnKey="orbisScore" label="ORBIS" levels={levels} align="right" onSort={onHeaderClick} />
                  <SortableTh columnKey="compositeScore" label="COMP" levels={levels} align="right" onSort={onHeaderClick} />
                  <SortableTh columnKey="fScore" label="F" levels={levels} align="right" onSort={onHeaderClick} />
                  <SortableTh columnKey="pe" label="P/E" levels={levels} align="right" onSort={onHeaderClick} />
                  <SortableTh columnKey="roe" label="ROE" levels={levels} align="right" onSort={onHeaderClick} />
                  <SortableTh columnKey="revGrowth1y" label="REV 1Y" levels={levels} align="right" onSort={onHeaderClick} />
                  <SortableTh columnKey="marketCap" label="MKTCAP" levels={levels} align="right" onSort={onHeaderClick} />
                  <SortableTh columnKey="verdict" label="VERDICT" levels={levels} align="right" onSort={onHeaderClick} />
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-[var(--text-muted)]">
                      No names match — loosen filters or try another preset
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((r) => (
                    <tr key={r.symbol} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                      <td className="px-3 py-2.5">
                        <Link href={`/ticker/${r.symbol}`} className="font-semibold text-[var(--accent-info)] hover:underline">
                          {r.symbol}
                        </Link>
                        <span className="ml-2 text-[10px] text-[var(--text-muted)]">{r.sector}</span>
                        {r.state != null && (
                          <span className="ml-1">
                            <BiasChip state={r.state as 0 | 1 | -1} rank={r.rank ?? 0} />
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">{r.orbisScore ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right">{r.compositeScore ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right">{r.fScore ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right">{r.pe != null ? r.pe.toFixed(1) : "—"}</td>
                      <td className="px-3 py-2.5 text-right">
                        {r.roe != null ? (r.roe * 100).toFixed(1) + "%" : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {r.revGrowth1y != null ? (r.revGrowth1y * 100).toFixed(1) + "%" : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">{fmtCap(r.marketCap)}</td>
                      <td className="px-3 py-2.5 text-right text-[10px]">{r.verdict ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
