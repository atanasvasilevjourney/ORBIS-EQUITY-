"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DashData = {
  posture: number | null;
  postureLabel: string | null;
  breadth: { total: number; greens: number; reds: number; pctGreen: number; pctRed: number } | null;
  avgRank: number;
  bestSector: string | null;
  worstSector: string | null;
  asOfDate: string | null;
  // Fundamentals
  fundCount: number;
  highFScore: number;
  // Pharma
  pharmaLong: number;
  pharmaShort: number;
  pharmaWatch: number;
  // Earnings
  earningsBeats: number;
  earningsMisses: number;
  earningsUpcoming: number;
  newsCount: number;
};

export default function Home() {
  const [d, setD] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/summary").then((r) => r.json()).catch(() => null),
      fetch("/api/fundamentals?limit=1").then((r) => r.json()).catch(() => null),
      fetch("/api/pharma?limit=1").then((r) => r.json()).catch(() => null),
      fetch("/api/earnings-news?days=30&limit=1").then((r) => r.json()).catch(() => null),
    ]).then(([summary, fund, pharma, earnings]) => {
      setD({
        posture: summary?.posture ?? null,
        postureLabel: summary?.postureLabel ?? null,
        breadth: summary?.breadth ?? null,
        avgRank: summary?.avgRank ?? 0,
        bestSector: summary?.bestSector ?? null,
        worstSector: summary?.worstSector ?? null,
        asOfDate: summary?.asOfDate ?? null,
        fundCount: fund?.rows?.length ?? 0,
        highFScore: (fund?.rows ?? []).filter((r: any) => r.fScore >= 7).length,
        pharmaLong: pharma?.summary?.long ?? 0,
        pharmaShort: pharma?.summary?.short ?? 0,
        pharmaWatch: pharma?.summary?.watch ?? 0,
        earningsBeats: earnings?.summary?.beats ?? 0,
        earningsMisses: earnings?.summary?.misses ?? 0,
        earningsUpcoming: earnings?.summary?.upcoming ?? 0,
        newsCount: earnings?.summary?.totalNews ?? 0,
      });
    }).finally(() => setLoading(false));
  }, []);

  const postureColor = (d?.posture ?? 50) >= 55
    ? "var(--accent-bull)"
    : (d?.posture ?? 50) <= 45
      ? "var(--accent-bear)"
      : "var(--text-primary)";

  const modules = [
    {
      href: "/screener",
      title: "SWING SCREENER",
      badge: "MODULE 1",
      desc: "Momentum & technical bias board — bull/bear swing candidates",
      stats: d ? [
        { label: "Posture", value: d.posture ?? "—", color: postureColor },
        { label: "Breadth", value: d.breadth ? `${d.breadth.pctGreen}% green` : "—", color: "var(--accent-bull)" },
        { label: "Best", value: d.bestSector ?? "—", color: "" },
      ] : null,
    },
    {
      href: "/fundamentals",
      title: "FUNDAMENTALS & VALUATION",
      badge: "MODULE 2",
      desc: "Financial ratios, Piotroski F-Score, 50+ metrics",
      stats: d ? [
        { label: "Stocks", value: String(d.fundCount), color: "" },
        { label: "F-Score 7+", value: String(d.highFScore), color: "var(--accent-bull)" },
        { label: "Avg Rank", value: String(d.avgRank), color: "" },
      ] : null,
    },
    {
      href: "/pharma",
      title: "PHARMA PIPELINE",
      badge: "MODULE 3",
      desc: "Clinical trial catalysts, Phase 2/3 signals — ClinicalTrials.gov",
      stats: d ? [
        { label: "LONG", value: String(d.pharmaLong), color: "var(--accent-bull)" },
        { label: "SHORT", value: String(d.pharmaShort), color: "var(--accent-bear)" },
        { label: "WATCH", value: String(d.pharmaWatch), color: "var(--accent-warning)" },
      ] : null,
    },
    {
      href: "/earnings-news",
      title: "EARNINGS & NEWS",
      badge: "MODULE 4",
      desc: "Earnings calendar + GDELT news feed with sentiment",
      stats: d ? [
        { label: "Beats", value: String(d.earningsBeats), color: "var(--accent-bull)" },
        { label: "Misses", value: String(d.earningsMisses), color: "var(--accent-bear)" },
        { label: "Upcoming", value: String(d.earningsUpcoming), color: "var(--accent-info)" },
      ] : null,
    },
  ];

  return (
    <div className="px-4 py-12">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-terminal font-bold tracking-wider mb-2" style={{ color: "var(--accent-info)" }}>
          KOVAVIEW TERMINAL
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Equity Swing Terminal — Free Data, Honest Signals, Global Coverage
        </p>
        {d?.asOfDate && (
          <p className="text-xs text-[var(--text-muted)] mt-1 font-terminal">
            Last refresh: {d.asOfDate} EOD
          </p>
        )}
      </div>

      {/* Quick posture bar */}
      {d?.breadth && (
        <div className="max-w-4xl mx-auto mb-6">
          <div className="flex items-center gap-4 p-3 rounded border border-[var(--border)] bg-[var(--card-bg)]">
            <div className="text-center px-4 border-r border-[var(--border)]">
              <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">POSTURE</div>
              <div className="text-2xl font-terminal font-bold" style={{ color: postureColor }}>
                {d.posture ?? "—"}
              </div>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-terminal text-[var(--text-muted)]">MARKET BREADTH</span>
                <span className="text-xs font-terminal text-[var(--accent-bull)]">{d.breadth.pctGreen}% green</span>
                <span className="text-xs font-terminal text-[var(--accent-bear)]">{d.breadth.pctRed}% red</span>
              </div>
              <div className="w-full h-2 rounded-full bg-[var(--surface-alt)] overflow-hidden flex">
                <div
                  className="h-full rounded-l-full"
                  style={{ width: `${d.breadth.pctGreen}%`, backgroundColor: "var(--accent-bull)" }}
                />
                <div
                  className="h-full"
                  style={{ width: `${100 - d.breadth.pctGreen - d.breadth.pctRed}%`, backgroundColor: "var(--surface-alt)" }}
                />
                <div
                  className="h-full rounded-r-full"
                  style={{ width: `${d.breadth.pctRed}%`, backgroundColor: "var(--accent-bear)" }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Module cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto">
        {modules.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="block p-5 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] hover:border-[var(--accent-info)] transition-colors group"
          >
            <span className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">
              {m.badge}
            </span>
            <h2 className="text-lg font-terminal font-semibold mt-1 mb-1 group-hover:text-[var(--accent-info)] transition-colors">
              {m.title}
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mb-3">{m.desc}</p>
            {m.stats && !loading && (
              <div className="flex gap-4 pt-2 border-t border-[var(--border)]">
                {m.stats.map((s) => (
                  <div key={s.label} className="text-center">
                    <div className="text-[9px] font-terminal text-[var(--text-muted)] tracking-widest">{s.label}</div>
                    <div className="text-sm font-terminal font-bold" style={{ color: s.color || undefined }}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
