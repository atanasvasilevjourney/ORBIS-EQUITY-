"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DeskPageHeader } from "@/components/ui/DeskPageHeader";
import { MetricStrip } from "@/components/ui/MetricStrip";

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

type HealthData = {
  rows: HealthRow[];
  summary: { healthNames: number } | null;
};

const fmtPct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const fmtNum = (v: number | null, d = 1) => (v == null ? "—" : v.toFixed(d));
const fmtScore = (v: number | null) => (v == null ? "—" : String(v));

function biasLabel(state: number | null) {
  if (state === 1) return { label: "ON LIST", color: "var(--accent-bull)" };
  if (state === -1) return { label: "DOWN", color: "var(--accent-bear)" };
  return { label: "—", color: "var(--text-secondary)" };
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

  return (
    <div className="py-6">
      <DeskPageHeader
        badge="SECTOR DESK"
        title="Health Care"
        subtitle="Factor scores, F-Score, and watchlist bias — fundamentals only"
      />

      <MetricStrip
        items={[{ label: "HEALTH NAMES", value: d?.summary?.healthNames ?? "—" }]}
        columns={4}
        loading={loading}
      />

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">
        HEALTH-SECTOR FUNDAMENTALS
      </h2>
      <div className="desk-table-wrap">
        <table className="desk-table">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">COMPANY</th>
              <th className="text-left px-3 py-2">WATCHLIST</th>
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
    </div>
  );
}
