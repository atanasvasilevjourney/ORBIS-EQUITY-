"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type HealthRow = {
  symbol: string;
  companyName: string;
  industry: string;
  country: string;
  price: number | null;
  pe: number | null;
  roe: number | null;
  divYield: number | null;
  revGrowth1y: number | null;
  valueScore: number | null;
  qualityScore: number | null;
  growthScore: number | null;
  compositeScore: number | null;
  fScore: number | null;
  state: number | null;
  rank: number | null;
};

type Catalyst = {
  nctId: string;
  ticker: string;
  companyName: string;
  eventType: string;
  direction: string;
  phase: string | null;
  confidence: number | null;
  daysToCatalyst: number | null;
  drugName: string | null;
  condition: string | null;
  status: string | null;
  completionDate: string | null;
  resultsPosted: boolean | null;
};

type HealthData = {
  rows: HealthRow[];
  catalysts: Catalyst[];
  summary: {
    healthNames: number;
    totalCatalysts: number;
    upcomingCatalysts: number;
    longSignals: number;
    phase3: number;
  } | null;
};

const fmtPct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const fmtNum = (v: number | null, d = 1) => (v == null ? "—" : v.toFixed(d));
const fmtScore = (v: number | null) => (v == null ? "—" : String(v));

function biasLabel(state: number | null) {
  if (state === 1) return { label: "BULL", color: "var(--accent-bull)" };
  if (state === -1) return { label: "BEAR", color: "var(--accent-bear)" };
  return { label: "NEUTRAL", color: "var(--text-secondary)" };
}

function phaseColor(phase: string | null) {
  if (phase === "PHASE3") return "var(--accent-bull)";
  if (phase === "PHASE2" || phase === "PHASE2_PHASE3") return "var(--accent-info)";
  return "var(--text-muted)";
}

function etaLabel(days: number | null) {
  if (days == null) return "—";
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "today";
  return `in ${days}d`;
}

export default function HealthPage() {
  const [d, setD] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => setD(data))
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  const cards = [
    { label: "HEALTH NAMES", value: d?.summary?.healthNames ?? "—", color: "" },
    { label: "CATALYSTS", value: d?.summary?.totalCatalysts ?? "—", color: "var(--accent-info)" },
    { label: "UPCOMING", value: d?.summary?.upcomingCatalysts ?? "—", color: "var(--accent-info)" },
    { label: "LONG SIGNALS", value: d?.summary?.longSignals ?? "—", color: "var(--accent-bull)" },
    { label: "PHASE 3", value: d?.summary?.phase3 ?? "—", color: "var(--accent-bull)" },
  ];

  return (
    <div className="px-4 py-6">
      <div className="mb-4">
        <h1 className="text-lg font-terminal font-bold tracking-wider" style={{ color: "var(--accent-info)" }}>
          HEALTH SECTOR
        </h1>
        <p className="text-xs text-[var(--text-secondary)]">
          Pharma &amp; biotech fundamentals + clinical-trial catalyst calendar
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {cards.map((c) => (
          <div key={c.label} className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
            <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">{c.label}</div>
            <div className="text-xl font-terminal font-bold mt-1" style={{ color: c.color || undefined }}>
              {loading ? "…" : c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Fundamentals table */}
      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">
        HEALTH-SECTOR FUNDAMENTALS
      </h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">COMPANY</th>
              <th className="text-left px-3 py-2">BIAS</th>
              <th className="text-right px-3 py-2">COMP</th>
              <th className="text-right px-3 py-2">VAL</th>
              <th className="text-right px-3 py-2">QLT</th>
              <th className="text-right px-3 py-2">GRW</th>
              <th className="text-right px-3 py-2">F</th>
              <th className="text-right px-3 py-2">P/E</th>
              <th className="text-right px-3 py-2">ROE</th>
              <th className="text-right px-3 py-2">PRICE</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.rows?.length ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-[var(--text-muted)]">No health-sector names.</td></tr>
            ) : (
              d.rows.map((r) => {
                const b = biasLabel(r.state);
                return (
                  <tr key={r.symbol} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                    <td className="px-3 py-2 font-bold">
                      <Link href={`/ticker/${r.symbol}`} className="hover:text-[var(--accent-info)]">{r.symbol}</Link>
                    </td>
                    <td className="px-3 py-2 text-[var(--text-secondary)] truncate max-w-[180px]">{r.companyName}</td>
                    <td className="px-3 py-2 font-bold" style={{ color: b.color }}>{b.label}</td>
                    <td className="px-3 py-2 text-right font-bold">{fmtScore(r.compositeScore)}</td>
                    <td className="px-3 py-2 text-right">{fmtScore(r.valueScore)}</td>
                    <td className="px-3 py-2 text-right">{fmtScore(r.qualityScore)}</td>
                    <td className="px-3 py-2 text-right">{fmtScore(r.growthScore)}</td>
                    <td className="px-3 py-2 text-right">{fmtScore(r.fScore)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(r.pe, 1)}</td>
                    <td className="px-3 py-2 text-right">{fmtPct(r.roe)}</td>
                    <td className="px-3 py-2 text-right">{r.price == null ? "—" : `$${r.price.toFixed(2)}`}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Catalyst calendar */}
      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">
        CLINICAL-TRIAL CATALYST CALENDAR
      </h2>
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">DRUG / INTERVENTION</th>
              <th className="text-left px-3 py-2">CONDITION</th>
              <th className="text-left px-3 py-2">PHASE</th>
              <th className="text-left px-3 py-2">EVENT</th>
              <th className="text-left px-3 py-2">DIR</th>
              <th className="text-right px-3 py-2">CONF</th>
              <th className="text-right px-3 py-2">ETA</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.catalysts?.length ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">
                No catalysts. Run: python -m pipeline.ingest.pharma_trials &amp;&amp; python -m pipeline.compute.pharma_signals
              </td></tr>
            ) : (
              d.catalysts.slice(0, 40).map((c) => (
                <tr key={`${c.nctId}-${c.eventType}`} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                  <td className="px-3 py-2 font-bold">
                    <Link href={`/ticker/${c.ticker}`} className="hover:text-[var(--accent-info)]">{c.ticker}</Link>
                  </td>
                  <td className="px-3 py-2 text-[var(--text-secondary)] truncate max-w-[220px]">{c.drugName ?? "—"}</td>
                  <td className="px-3 py-2 text-[var(--text-muted)] truncate max-w-[200px]">{c.condition ?? "—"}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: phaseColor(c.phase) }}>
                    {(c.phase ?? "—").replace("PHASE", "P").replace("_P", "/")}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{c.eventType.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: c.direction === "LONG" ? "var(--accent-bull)" : "var(--text-muted)" }}>
                    {c.direction}
                  </td>
                  <td className="px-3 py-2 text-right">{c.confidence ?? "—"}</td>
                  <td className="px-3 py-2 text-right" style={{ color: (c.daysToCatalyst ?? -1) >= 0 ? "var(--accent-info)" : "var(--text-muted)" }}>
                    {etaLabel(c.daysToCatalyst)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-3">
        Catalyst data: ClinicalTrials.gov Data API v2 (public domain, no API key). Signals are heuristic and not investment advice.
      </p>
    </div>
  );
}
