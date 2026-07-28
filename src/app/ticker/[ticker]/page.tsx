"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { BiasChip } from "@/components/scoreboard/BiasChip";
import { AgreementDots } from "@/components/scoreboard/AgreementDots";

type TickerData = {
  radar: any;
  fundamentals: any;
  universe: any;
  earnings: any[];
  insiderTrades: any[];
};

function formatVal(v: number | null | undefined, suffix = ""): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 }) + suffix;
}

function FundamentalsGrid({ f }: { f: any }) {
  if (!f) return <p className="text-[var(--text-muted)] py-4">No fundamentals data</p>;

  const groups = [
    { title: "VALUATION", items: [
      ["P/E", f.pe_ratio], ["P/B", f.pb_ratio], ["P/S", f.ps_ratio],
      ["EV/EBITDA", f.ev_ebitda], ["P/FCF", f.p_fcf_ratio],
    ]},
    { title: "PROFITABILITY", items: [
      ["Gross Margin", f.gross_margin, "%"], ["Op Margin", f.operating_margin, "%"],
      ["Net Margin", f.net_margin, "%"], ["ROE", f.roe, "%"], ["ROA", f.roa, "%"],
    ]},
    { title: "GROWTH", items: [
      ["Rev 1Y", f.revenue_growth_1y, "%"], ["Rev 3Y", f.revenue_growth_3y, "%"],
      ["NI 1Y", f.net_income_growth_1y, "%"], ["EPS 1Y", f.eps_growth_1y, "%"],
    ]},
    { title: "HEALTH", items: [
      ["Current", f.current_ratio], ["Quick", f.quick_ratio],
      ["D/E", f.debt_to_equity], ["Div Yield", f.dividend_yield, "%"],
    ]},
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {groups.map((g) => (
        <div key={g.title} className="rounded border border-[var(--border)] bg-[var(--card-bg)]">
          <div className="px-3 py-2 border-b border-[var(--border)] text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">
            {g.title}
          </div>
          <div className="p-3 space-y-1.5">
            {g.items.map(([label, val, suf]) => (
              <div key={label as string} className="flex justify-between text-xs font-terminal">
                <span className="text-[var(--text-secondary)]">{label as string}</span>
                <span className={
                  typeof val === "number" && (suf === "%")
                    ? val > 0 ? "text-[var(--accent-bull)]" : val < 0 ? "text-[var(--accent-bear)]" : ""
                    : ""
                }>
                  {typeof val === "number"
                    ? suf === "%"
                      ? (val * 100).toFixed(1) + "%"
                      : val.toFixed(2)
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TickerPage() {
  const params = useParams();
  const ticker = params.ticker as string;
  const [data, setData] = useState<TickerData | null>(null);
  const [tab, setTab] = useState<"swing" | "fundamentals" | "earnings" | "insider">("swing");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/ticker/${ticker}`)
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return <div className="px-4 py-12 text-center text-[var(--text-muted)] font-terminal">Loading {ticker}...</div>;
  }

  const r = data?.radar;
  const f = data?.fundamentals;
  const u = data?.universe;

  const signals = r
    ? [r.z_mom > 0, r.f_ewmac > 0, r.z_52 > -0.10, r.breakout_active, r.volume_confirmed]
    : [false, false, false, false, false];

  const tabs = [
    { key: "swing", label: "SWING" },
    { key: "fundamentals", label: "FUNDAMENTALS" },
    { key: "earnings", label: "EARNINGS" },
    { key: "insider", label: "INSIDER" },
  ] as const;

  return (
    <div className="px-4 py-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-terminal font-bold">{ticker}</h1>
            {r && <BiasChip state={r.state} rank={r.quality_rank} />}
            {r && <AgreementDots signals={signals} />}
          </div>
          <p className="text-sm text-[var(--text-secondary)]">
            {u?.company_name ?? ""} &middot; {u?.sector ?? ""} &middot; {u?.exchange ?? ""} &middot;
            <span className="text-[var(--text-muted)]"> Tier: {u?.tier ?? "—"} | {u?.country ?? ""}</span>
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-terminal font-bold">{formatVal(f?.price)}</div>
          <div className="text-xs text-[var(--text-muted)]">
            MktCap: {f?.market_cap ? `${(f.market_cap / 1e9).toFixed(0)}B` : "—"}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-[var(--border)]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-terminal transition-colors border-b-2 ${
              tab === t.key
                ? "border-[var(--accent-info)] text-[var(--accent-info)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "swing" && r && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "QUALITY RANK", value: r.quality_rank, color: r.quality_rank >= 70 ? "var(--accent-bull)" : r.quality_rank <= 30 ? "var(--accent-bear)" : "" },
            { label: "Z-MOM", value: r.z_mom?.toFixed(2), color: r.z_mom > 0 ? "var(--accent-bull)" : "var(--accent-bear)" },
            { label: "EWMAC", value: r.f_ewmac?.toFixed(2), color: r.f_ewmac > 0 ? "var(--accent-bull)" : "var(--accent-bear)" },
            { label: "52W PROX", value: `${((r.z_52 + 1) * 100).toFixed(1)}%`, color: r.z_52 > -0.05 ? "var(--accent-bull)" : "var(--accent-bear)" },
            { label: "CONVERGENCE", value: `${r.convergence_count}/5`, color: r.convergence_count >= 4 ? "var(--accent-bull)" : "" },
          ].map((c) => (
            <div key={c.label} className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
              <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">{c.label}</div>
              <div className="text-xl font-terminal font-bold mt-1" style={{ color: c.color || undefined }}>{c.value}</div>
            </div>
          ))}
          <div className="col-span-full mt-2 flex gap-2">
            {r.breakout_active && <span className="text-xs px-2 py-1 rounded bg-[var(--badge-bg)] text-[var(--accent-warning)] font-terminal">BREAKOUT</span>}
            {r.volume_confirmed && <span className="text-xs px-2 py-1 rounded bg-[var(--badge-bg)] text-[var(--accent-bull)] font-terminal">VOL CONFIRMED</span>}
            {r.state_changed_at && <span className="text-xs text-[var(--text-muted)] font-terminal">State changed: {r.state_changed_at}</span>}
          </div>
        </div>
      )}

      {tab === "fundamentals" && <FundamentalsGrid f={f} />}

      {tab === "earnings" && (
        <div className="rounded border border-[var(--border)]">
          <table className="w-full text-sm font-terminal">
            <thead>
              <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
                <th className="text-left px-3 py-2">DATE</th>
                <th className="text-right px-3 py-2">EPS EST</th>
                <th className="text-right px-3 py-2">EPS ACT</th>
                <th className="text-right px-3 py-2">SURPRISE</th>
              </tr>
            </thead>
            <tbody>
              {(data?.earnings ?? []).length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-4 text-center text-[var(--text-muted)]">No earnings data</td></tr>
              ) : (
                data!.earnings.map((e: any, i: number) => (
                  <tr key={i} className="border-b border-[var(--border)]">
                    <td className="px-3 py-2">{e.event_date}</td>
                    <td className="px-3 py-2 text-right">{formatVal(e.eps_est)}</td>
                    <td className="px-3 py-2 text-right">{formatVal(e.eps_actual)}</td>
                    <td className="px-3 py-2 text-right" style={{
                      color: e.surprise_pct > 0 ? "var(--accent-bull)" : e.surprise_pct < 0 ? "var(--accent-bear)" : undefined,
                    }}>
                      {e.surprise_pct != null ? `${e.surprise_pct > 0 ? "+" : ""}${e.surprise_pct.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "insider" && (
        <div className="rounded border border-[var(--border)]">
          <table className="w-full text-sm font-terminal">
            <thead>
              <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
                <th className="text-left px-3 py-2">DATE</th>
                <th className="text-left px-3 py-2">NAME</th>
                <th className="text-left px-3 py-2">TYPE</th>
                <th className="text-right px-3 py-2">SHARES</th>
                <th className="text-right px-3 py-2">PRICE</th>
              </tr>
            </thead>
            <tbody>
              {(data?.insiderTrades ?? []).length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-[var(--text-muted)]">No insider trade data</td></tr>
              ) : (
                data!.insiderTrades.map((t: any, i: number) => (
                  <tr key={i} className="border-b border-[var(--border)]">
                    <td className="px-3 py-2">{t.filing_date}</td>
                    <td className="px-3 py-2 text-xs">{t.reporting_name}</td>
                    <td className="px-3 py-2">
                      <span style={{ color: t.transaction_type?.startsWith("P") ? "var(--accent-bull)" : "var(--accent-bear)" }}>
                        {t.transaction_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{formatVal(t.securities_transacted)}</td>
                    <td className="px-3 py-2 text-right">{formatVal(t.price)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Cross-module links */}
      <div className="flex gap-3 mt-6 pt-4 border-t border-[var(--border)]">
        <Link href={`/pharma?ticker=${ticker}`} className="text-xs font-terminal text-[var(--accent-info)] hover:underline">
          Pharma Pipeline
        </Link>
        <Link href={`/earnings-news?ticker=${ticker}`} className="text-xs font-terminal text-[var(--accent-info)] hover:underline">
          Earnings & News
        </Link>
      </div>
    </div>
  );
}
