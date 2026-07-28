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
  ps: number | null;
  pFcf: number | null;
  evEbitda: number | null;
  earningsYield: number | null;
  fcfYield: number | null;
  divYield: number | null;
  grossMargin: number | null;
  opMargin: number | null;
  netMargin: number | null;
  roe: number | null;
  roa: number | null;
  roic: number | null;
  currentRatio: number | null;
  debtToEquity: number | null;
  revGrowth1y: number | null;
  revGrowth3y: number | null;
  niGrowth1y: number | null;
  epsGrowth1y: number | null;
  fScore: number | null;
};

type SortKey = keyof FundRow;

const COLUMNS: { key: SortKey; label: string; fmt?: "pct" | "ratio" | "money" | "score" | "cap" }[] = [
  { key: "symbol", label: "TICKER" },
  { key: "pe", label: "P/E", fmt: "ratio" },
  { key: "pb", label: "P/B", fmt: "ratio" },
  { key: "evEbitda", label: "EV/EBITDA", fmt: "ratio" },
  { key: "roe", label: "ROE", fmt: "pct" },
  { key: "netMargin", label: "NET MGN", fmt: "pct" },
  { key: "debtToEquity", label: "D/E", fmt: "ratio" },
  { key: "revGrowth1y", label: "REV 1Y", fmt: "pct" },
  { key: "epsGrowth1y", label: "EPS 1Y", fmt: "pct" },
  { key: "divYield", label: "DIV%", fmt: "pct" },
  { key: "fScore", label: "F-SCORE", fmt: "score" },
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
  return v.toFixed(2);
}

function valColor(v: number | null, fmt?: string): string {
  if (v == null) return "";
  if (fmt === "pct") return v > 0 ? "var(--accent-bull)" : v < 0 ? "var(--accent-bear)" : "";
  if (fmt === "score") return v >= 7 ? "var(--accent-bull)" : v <= 3 ? "var(--accent-bear)" : "";
  return "";
}

export default function FundamentalsPage() {
  const [data, setData] = useState<FundRow[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [sector, setSector] = useState("");
  const [minF, setMinF] = useState(0);
  const [valTier, setValTier] = useState<"" | "value" | "growth" | "quality">("");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("marketCap");
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (minF > 0) params.set("min_f", String(minF));
    params.set("limit", "500");

    fetch(`/api/fundamentals?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d.rows ?? []);
        setSectors(d.sectors ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [minF]);

  // Client-side sort + filter
  const filtered = useMemo(() => {
    let rows = [...data];

    if (sector) {
      rows = rows.filter((r) => r.sector === sector);
    }

    if (valTier === "value") {
      rows = rows.filter((r) => r.pe != null && r.pe > 0 && r.pe < 15);
    } else if (valTier === "growth") {
      rows = rows.filter((r) => r.revGrowth1y != null && r.revGrowth1y > 0.15);
    } else if (valTier === "quality") {
      rows = rows.filter(
        (r) => r.roe != null && r.roe > 0.15 && r.fScore != null && r.fScore >= 6
      );
    }

    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string")
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });

    return rows;
  }, [data, sector, valTier, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  // Summary stats
  const avgPE = filtered.length > 0
    ? filtered.reduce((s, r) => s + (r.pe && r.pe > 0 ? r.pe : 0), 0) /
      filtered.filter((r) => r.pe && r.pe > 0).length
    : 0;
  const avgFScore = filtered.length > 0
    ? filtered.reduce((s, r) => s + (r.fScore ?? 0), 0) /
      filtered.filter((r) => r.fScore != null).length
    : 0;
  const highF = filtered.filter((r) => r.fScore != null && r.fScore >= 7).length;

  if (loading) {
    return (
      <div className="px-4 py-12 text-center text-[var(--text-muted)] font-terminal">
        Loading fundamentals...
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-terminal font-bold mb-1">FUNDAMENTALS & VALUATION</h1>
      <p className="text-xs text-[var(--text-muted)] mb-4 font-terminal">
        {data.length} stocks — 50+ metrics from LSE Screener — Piotroski F-Score
      </p>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: "SHOWING", value: String(filtered.length), color: "" },
          { label: "AVG P/E", value: avgPE > 0 ? avgPE.toFixed(1) : "—", color: "" },
          { label: "AVG F-SCORE", value: avgFScore > 0 ? avgFScore.toFixed(1) + "/9" : "—", color: avgFScore >= 6 ? "var(--accent-bull)" : "" },
          { label: "F-SCORE 7+", value: String(highF), color: "var(--accent-bull)" },
        ].map((c) => (
          <div key={c.label} className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
            <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">{c.label}</div>
            <div className="text-lg font-terminal font-bold mt-0.5" style={{ color: c.color || undefined }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {/* Sector */}
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="px-2 py-1.5 text-xs font-terminal rounded border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-primary)]"
        >
          <option value="">All Sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Valuation tier */}
        {(["", "value", "growth", "quality"] as const).map((v) => (
          <button
            key={v || "all"}
            onClick={() => setValTier(v)}
            className={`px-3 py-1.5 text-xs font-terminal rounded border transition-colors ${
              valTier === v
                ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {v === "" ? "ALL" : v === "value" ? "VALUE (P/E<15)" : v === "growth" ? "GROWTH (Rev>15%)" : "QUALITY (ROE>15%)"}
          </button>
        ))}

        {/* F-Score filter */}
        {([0, 5, 6, 7, 8] as const).map((f) => (
          <button
            key={`f${f}`}
            onClick={() => setMinF(f)}
            className={`px-3 py-1.5 text-xs font-terminal rounded border transition-colors ${
              minF === f
                ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {f === 0 ? "F: Any" : `F >= ${f}`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`text-left px-3 py-2 cursor-pointer hover:text-[var(--text-primary)] select-none ${
                    col.key === "symbol" ? "" : "text-right"
                  }`}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1">{sortAsc ? "\u25B2" : "\u25BC"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-[var(--text-muted)]">
                  No stocks match filters
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.symbol}
                  className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors"
                >
                  {COLUMNS.map((col) => {
                    if (col.key === "symbol") {
                      return (
                        <td key={col.key} className="px-3 py-2.5">
                          <Link
                            href={`/ticker/${r.symbol}`}
                            className="font-semibold text-[var(--accent-info)] hover:underline"
                          >
                            {r.symbol}
                          </Link>
                          <span className="ml-2 text-[10px] text-[var(--text-muted)]">
                            {r.companyName.length > 20 ? r.companyName.slice(0, 20) + "..." : r.companyName}
                          </span>
                          {r.state != null && (
                            <span className="ml-1">
                              <BiasChip state={r.state as 0 | 1 | -1} rank={r.rank ?? 0} />
                            </span>
                          )}
                        </td>
                      );
                    }
                    const v = r[col.key] as number | null;
                    return (
                      <td
                        key={col.key}
                        className="px-3 py-2.5 text-right"
                        style={{ color: valColor(v, col.fmt) || undefined }}
                      >
                        {fmtVal(v, col.fmt)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--text-muted)] mt-3 font-terminal">
        Showing {filtered.length} of {data.length} stocks. Click column headers to sort.
      </p>
    </div>
  );
}
