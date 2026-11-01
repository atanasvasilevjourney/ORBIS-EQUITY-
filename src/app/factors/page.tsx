"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { FundamentalsModuleTabs } from "@/components/fundamentals/FundamentalsModuleTabs";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { EmptyState } from "@/components/ui/EmptyState";
import { InfoCallout } from "@/components/ui/InfoCallout";
import type { SectorFactorRow, StyleSummary } from "@/lib/factorInvesting";

type FactorsData = {
  summary: {
    universeNames: number;
    withComposite: number;
    avgComposite: number | null;
    highComposite70: number;
    factorComputedAt: string | null;
  };
  styles: StyleSummary[];
  sectors: SectorFactorRow[];
  topComposite: {
    symbol: string;
    companyName: string;
    sector: string;
    compositeScore: number | null;
    valueScore: number | null;
    qualityScore: number | null;
    growthScore: number | null;
  }[];
};

function fmtScore(v: number | null | undefined): string {
  if (v == null) return "—";
  return String(Math.round(v));
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function scoreColor(v: number | null): string {
  if (v == null) return "var(--text-muted)";
  if (v >= 70) return "var(--accent-bull)";
  if (v <= 30) return "var(--accent-bear)";
  return "var(--text-primary)";
}

export default function FactorInvestingPage() {
  const [d, setD] = useState<FactorsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeStyle, setActiveStyle] = useState<string>("value");

  useEffect(() => {
    fetch("/api/factors")
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) {
          setD(null);
          return;
        }
        setD(data);
        if (data.styles?.[0]?.id) setActiveStyle(data.styles[0].id);
      })
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  const stylePanel = d?.styles.find((s) => s.id === activeStyle) ?? d?.styles[0];

  return (
    <div className="py-6">
      <ModuleHeader
        module="MODULE 2 · FACTOR DESK"
        title="Factor investing"
        description="Cross-sectional value, quality, growth, earnings quality, and leverage ranks — equal-weight within each style, composite renormalizes when inputs are missing."
        source="NIGHTLY · EOD FUNDAMENTALS"
        accent="var(--module-2)"
      />

      <FundamentalsModuleTabs />

      <MetricStrip
        loading={loading}
        columns={4}
        items={[
          { label: "UNIVERSE", value: d?.summary.universeNames ?? "—" },
          {
            label: "AVG COMP",
            value: d?.summary.avgComposite != null ? fmtScore(d.summary.avgComposite) : "—",
          },
          { label: "COMP 70+", value: d?.summary.highComposite70 ?? "—" },
          {
            label: "COMPUTED",
            value: d?.summary.factorComputedAt
              ? new Date(d.summary.factorComputedAt).toLocaleDateString()
              : "—",
          },
        ]}
      />

      <InfoCallout>
        Scores are peer percentiles (0–100), not forecasts. Use the screener for range filters and watchlist overlays.
      </InfoCallout>

      {loading ? (
        <div className="desk-widget h-64 animate-pulse" />
      ) : !d ? (
        <EmptyState
          title="No factor data"
          detail="Run pipeline/compute/factor_scores after fundamentals ingest."
        />
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-3">
              STYLE SLEEVES · COMPOSITE WEIGHTS
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
              {d.styles.map((style) => {
                const active = style.id === activeStyle;
                return (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setActiveStyle(style.id)}
                    className="text-left glass-panel p-4 transition-colors border"
                    style={{
                      borderColor: active ? "var(--module-2)" : "var(--border)",
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-terminal font-bold tracking-wider">{style.label}</span>
                      <span className="text-[10px] font-terminal text-[var(--text-muted)]">
                        {(style.weight * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div
                      className="mt-2 text-2xl font-display font-semibold tabular-nums"
                      style={{ color: scoreColor(style.avgScore) }}
                    >
                      {fmtScore(style.avgScore)}
                    </div>
                    <div className="mt-1 text-[10px] font-terminal text-[var(--text-muted)]">
                      {style.namesScored} scored · {style.topQuartile} ≥75
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-[var(--gauge-track)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--module-2)]"
                        style={{ width: `${style.avgScore ?? 0}%` }}
                      />
                    </div>
                    <Link
                      href={style.screenerHref}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-3 inline-block text-[10px] font-terminal text-[var(--accent-info)] hover:underline"
                    >
                      Open in screener →
                    </Link>
                  </button>
                );
              })}
            </div>
          </section>

          {stylePanel && (
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-4 glass-panel p-4">
                <h3 className="text-xs font-terminal tracking-widest text-[var(--text-muted)] mb-2">
                  {stylePanel.label} INPUTS
                </h3>
                <ul className="text-sm text-[var(--text-secondary)] space-y-1.5 list-disc pl-4">
                  {stylePanel.inputs.map((inp) => (
                    <li key={inp}>{inp}</li>
                  ))}
                </ul>
              </div>
              <div className="lg:col-span-8 desk-table-wrap">
                <h3 className="text-xs font-terminal tracking-widest text-[var(--text-muted)] mb-2 px-1">
                  TOP {stylePanel.label} NAMES
                </h3>
                <table className="desk-table">
                  <thead>
                    <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
                      <th className="text-left px-3 py-2">TICKER</th>
                      <th className="text-left px-3 py-2">COMPANY</th>
                      <th className="text-left px-3 py-2">SECTOR</th>
                      <th className="text-right px-3 py-2">{stylePanel.label}</th>
                      <th className="text-right px-3 py-2">COMP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stylePanel.leaders.map((row) => (
                      <tr key={row.symbol} className="border-b border-[var(--border)]/60">
                        <td className="px-3 py-2">
                          <Link
                            href={`/ticker/${row.symbol}`}
                            className="font-terminal font-bold text-[var(--accent-info)] hover:underline"
                          >
                            {row.symbol}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-sm text-[var(--text-secondary)] truncate max-w-[12rem]">
                          {row.companyName}
                        </td>
                        <td className="px-3 py-2 text-[10px] font-terminal text-[var(--text-muted)]">
                          {row.sector || "—"}
                        </td>
                        <td
                          className="px-3 py-2 text-right font-terminal tabular-nums"
                          style={{ color: scoreColor(row.score) }}
                        >
                          {row.score}
                        </td>
                        <td className="px-3 py-2 text-right font-terminal tabular-nums text-[var(--text-secondary)]">
                          {fmtScore(row.compositeScore)}
                        </td>
                      </tr>
                    ))}
                    {stylePanel.leaders.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                          No scored names for this style yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section>
            <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">
              TOP COMPOSITE
            </h2>
            <div className="desk-table-wrap">
              <table className="desk-table">
                <thead>
                  <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
                    <th className="text-left px-3 py-2">TICKER</th>
                    <th className="text-left px-3 py-2">SECTOR</th>
                    <th className="text-right px-3 py-2">COMP</th>
                    <th className="text-right px-3 py-2">VAL</th>
                    <th className="text-right px-3 py-2">QLT</th>
                    <th className="text-right px-3 py-2">GRW</th>
                  </tr>
                </thead>
                <tbody>
                  {d.topComposite.map((row) => (
                    <tr key={row.symbol} className="border-b border-[var(--border)]/60">
                      <td className="px-3 py-2">
                        <Link
                          href={`/ticker/${row.symbol}`}
                          className="font-terminal font-bold text-[var(--accent-info)] hover:underline"
                        >
                          {row.symbol}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-[10px] font-terminal text-[var(--text-muted)]">
                        {row.sector || "—"}
                      </td>
                      <td
                        className="px-3 py-2 text-right font-terminal tabular-nums font-bold"
                        style={{ color: scoreColor(row.compositeScore) }}
                      >
                        {fmtScore(row.compositeScore)}
                      </td>
                      <td className="px-3 py-2 text-right font-terminal tabular-nums text-[var(--text-secondary)]">
                        {fmtScore(row.valueScore)}
                      </td>
                      <td className="px-3 py-2 text-right font-terminal tabular-nums text-[var(--text-secondary)]">
                        {fmtScore(row.qualityScore)}
                      </td>
                      <td className="px-3 py-2 text-right font-terminal tabular-nums text-[var(--text-secondary)]">
                        {fmtScore(row.growthScore)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {d.sectors.length > 0 && (
            <section>
              <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">
                SECTOR FACTOR BREADTH
              </h2>
              <div className="desk-table-wrap">
                <table className="desk-table">
                  <thead>
                    <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
                      <th className="text-left px-3 py-2">SECTOR</th>
                      <th className="text-right px-3 py-2">N</th>
                      <th className="text-right px-3 py-2">AVG COMP</th>
                      <th className="text-right px-3 py-2">VAL ≥50</th>
                      <th className="text-right px-3 py-2">QLT ≥50</th>
                      <th className="text-right px-3 py-2">GRW ≥50</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.sectors.slice(0, 20).map((row) => (
                      <tr key={row.sector} className="border-b border-[var(--border)]/60">
                        <td className="px-3 py-2 text-sm">{row.sector}</td>
                        <td className="px-3 py-2 text-right font-terminal">{row.nNames}</td>
                        <td
                          className="px-3 py-2 text-right font-terminal tabular-nums"
                          style={{ color: scoreColor(row.avgComposite) }}
                        >
                          {fmtScore(row.avgComposite)}
                        </td>
                        <td className="px-3 py-2 text-right font-terminal text-[var(--text-secondary)]">
                          {fmtPct(row.valueBreadth)}
                        </td>
                        <td className="px-3 py-2 text-right font-terminal text-[var(--text-secondary)]">
                          {fmtPct(row.qualityBreadth)}
                        </td>
                        <td className="px-3 py-2 text-right font-terminal text-[var(--text-secondary)]">
                          {fmtPct(row.growthBreadth)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
