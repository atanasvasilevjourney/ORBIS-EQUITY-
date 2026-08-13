"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { BiasChip } from "@/components/scoreboard/BiasChip";

type FundRow = {
  symbol: string;
  companyName: string;
  sector: string;
  country: string;
  exchange: string;
  tier: string;
  state: number | null;
  rank: number | null;
  price: number | null;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  evEbitda: number | null;
  roe: number | null;
  netMargin: number | null;
  debtToEquity: number | null;
  revGrowth1y: number | null;
  epsGrowth1y: number | null;
  divYield: number | null;
  fScore: number | null;
  valueScore: number | null;
  qualityScore: number | null;
  growthScore: number | null;
  earningsQualityScore: number | null;
  leverageScore: number | null;
  compositeScore: number | null;
  sectorValuePctile: number | null;
  sectorQualityPctile: number | null;
};

type SortKey = keyof FundRow;

const COLUMNS: { key: SortKey; label: string; fmt?: "pct" | "ratio" | "score" | "cap" | "factor" }[] = [
  { key: "symbol", label: "TICKER" },
  { key: "compositeScore", label: "COMP", fmt: "factor" },
  { key: "valueScore", label: "VAL", fmt: "factor" },
  { key: "qualityScore", label: "QLT", fmt: "factor" },
  { key: "growthScore", label: "GRW", fmt: "factor" },
  { key: "earningsQualityScore", label: "EQ", fmt: "factor" },
  { key: "leverageScore", label: "LEV", fmt: "factor" },
  { key: "fScore", label: "F-SCR", fmt: "score" },
  { key: "pe", label: "P/E", fmt: "ratio" },
  { key: "roe", label: "ROE", fmt: "pct" },
  { key: "revGrowth1y", label: "REV 1Y", fmt: "pct" },
  { key: "marketCap", label: "MKTCAP", fmt: "cap" },
];

function fmtVal(v: number | null, fmt?: string): string {
  if (v == null) return "—";
  if (fmt === "pct") return (v * 100).toFixed(1) + "%";
  if (fmt === "cap") {
    if (v >= 1e12) return (v / 1e12).toFixed(1) + "T";
    if (v >= 1e9) return (v / 1e9).toFixed(0) + "B";
    if (v >= 1e6) return (v / 1e6).toFixed(0) + "M";
    return v.toLocaleString();
  }
  if (fmt === "score") return `${v}/9`;
  if (fmt === "factor") return String(v);
  return v.toFixed(2);
}

function valColor(v: number | null, fmt?: string): string {
  if (v == null) return "";
  if (fmt === "pct") return v > 0 ? "var(--accent-bull)" : v < 0 ? "var(--accent-bear)" : "";
  if (fmt === "score") return v >= 7 ? "var(--accent-bull)" : v <= 3 ? "var(--accent-bear)" : "";
  if (fmt === "factor") return v >= 70 ? "var(--accent-bull)" : v <= 30 ? "var(--accent-bear)" : "";
  return "";
}

export default function FundamentalsPage() {
  const [data, setData] = useState<FundRow[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sector, setSector] = useState("");
  const [minF, setMinF] = useState(0);
  const [minComposite, setMinComposite] = useState(0);
  const [valTier, setValTier] = useState<"" | "value" | "growth" | "quality" | "multifactor">("");
  const [sortKey, setSortKey] = useState<SortKey>("compositeScore");
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (minF > 0) params.set("min_f", String(minF));
    if (minComposite > 0) params.set("min_composite", String(minComposite));
    params.set("limit", "500");

    fetch(`/api/fundamentals?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d.rows ?? []);
        setSectors(d.sectors ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [minF, minComposite]);

  const filtered = useMemo(() => {
    let rows = [...data];
    if (sector) rows = rows.filter((r) => r.sector === sector);
    if (valTier === "value") rows = rows.filter((r) => (r.valueScore ?? 0) >= 70);
    else if (valTier === "growth") rows = rows.filter((r) => (r.growthScore ?? 0) >= 70);
    else if (valTier === "quality") rows = rows.filter((r) => (r.qualityScore ?? 0) >= 70 && (r.fScore ?? 0) >= 6);
    else if (valTier === "multifactor") rows = rows.filter((r) => (r.compositeScore ?? 0) >= 65);

    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return rows;
  }, [data, sector, valTier, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const highComposite = filtered.filter((r) => (r.compositeScore ?? 0) >= 70).length;
  const avgComposite = filtered.length > 0
    ? Math.round(filtered.reduce((s, r) => s + (r.compositeScore ?? 0), 0) / filtered.length)
    : 0;

  if (loading) {
    return <div className="px-4 py-12 text-center text-[var(--text-muted)] font-terminal">Loading fundamentals...</div>;
  }

  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-terminal font-bold mb-1">QUANT FUNDAMENTALS</h1>
      <p className="text-xs text-[var(--text-muted)] mb-4 font-terminal">
        Multi-factor scores (0-100) — value, quality, growth, earnings quality, leverage — for systematic equity screening
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: "SHOWING", value: String(filtered.length) },
          { label: "COMPOSITE 70+", value: String(highComposite), color: "var(--accent-bull)" },
          { label: "AVG COMPOSITE", value: avgComposite > 0 ? String(avgComposite) : "—" },
          { label: "UNIVERSE", value: String(data.length) },
        ].map((c) => (
          <div key={c.label} className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
            <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">{c.label}</div>
            <div className="text-lg font-terminal font-bold mt-0.5" style={{ color: (c as { color?: string }).color }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={sector} onChange={(e) => setSector(e.target.value)}
          className="px-2 py-1.5 text-xs font-terminal rounded border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-primary)]">
          <option value="">All Sectors</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {([
          ["", "ALL"],
          ["multifactor", "MULTI-FACTOR"],
          ["value", "VALUE"],
          ["growth", "GROWTH"],
          ["quality", "QUALITY"],
        ] as const).map(([v, label]) => (
          <button key={v || "all"} onClick={() => setValTier(v)}
            className={`px-3 py-1.5 text-xs font-terminal rounded border transition-colors ${
              valTier === v ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}>{label}</button>
        ))}

        {([0, 60, 70, 80] as const).map((c) => (
          <button key={c} onClick={() => setMinComposite(c)}
            className={`px-3 py-1.5 text-xs font-terminal rounded border transition-colors ${
              minComposite === c ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                : "border-[var(--border)] text-[var(--text-muted)]"
            }`}>{c === 0 ? "Comp: Any" : `Comp >= ${c}`}</button>
        ))}

        {([0, 5, 6, 7] as const).map((f) => (
          <button key={f} onClick={() => setMinF(f)}
            className={`px-3 py-1.5 text-xs font-terminal rounded border transition-colors ${
              minF === f ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                : "border-[var(--border)] text-[var(--text-muted)]"
            }`}>{f === 0 ? "F: Any" : `F >= ${f}`}</button>
        ))}
      </div>

      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              {COLUMNS.map((col) => (
                <th key={col.key} onClick={() => handleSort(col.key)}
                  className={`text-left px-3 py-2 cursor-pointer hover:text-[var(--text-primary)] select-none ${col.key === "symbol" ? "" : "text-right"}`}>
                  {col.label}{sortKey === col.key && <span className="ml-1">{sortAsc ? "\u25B2" : "\u25BC"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-[var(--text-muted)]">No stocks match filters</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.symbol} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors">
                {COLUMNS.map((col) => {
                  if (col.key === "symbol") {
                    return (
                      <td key={col.key} className="px-3 py-2.5">
                        <Link href={`/ticker/${r.symbol}`} className="font-semibold text-[var(--accent-info)] hover:underline">{r.symbol}</Link>
                        <span className="ml-2 text-[10px] text-[var(--text-muted)]">{r.sector}</span>
                        {r.state != null && <span className="ml-1"><BiasChip state={r.state as 0 | 1 | -1} rank={r.rank ?? 0} /></span>}
                      </td>
                    );
                  }
                  const v = r[col.key] as number | null;
                  return (
                    <td key={col.key} className="px-3 py-2.5 text-right" style={{ color: valColor(v, col.fmt) || undefined }}>
                      {fmtVal(v, col.fmt)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-muted)] mt-3 font-terminal">
        Factor scores are cross-sectional percentile ranks (0-100). Composite = 25% value + 25% quality + 20% growth + 15% earnings quality + 15% leverage.
      </p>
    </div>
  );
}
