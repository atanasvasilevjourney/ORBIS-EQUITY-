"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type EarningsRow = {
  ticker: string;
  eventDate: string;
  confirmed: boolean;
  epsEst: number | null;
  epsActual: number | null;
  surprisePct: number | null;
  revenueEst: number | null;
  revenueActual: number | null;
};

type NewsRow = {
  id: number;
  ticker: string;
  publishedAt: string;
  source: string;
  headline: string;
  url: string;
  tone: number | null;
  badge: string | null;
};

type Summary = {
  totalEarnings: number;
  reported: number;
  upcoming: number;
  beats: number;
  misses: number;
  avgSurprise: number;
  totalNews: number;
};

function formatRev(v: number | null): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(0) + "M";
  return v.toLocaleString();
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffH = Math.floor((now - then) / (1000 * 60 * 60));
  if (diffH < 1) return "now";
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

export default function EarningsNewsPage() {
  const [earnings, setEarnings] = useState<EarningsRow[]>([]);
  const [news, setNews] = useState<NewsRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [view, setView] = useState<"all" | "upcoming" | "reported">("all");
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/earnings-news?view=${view}&days=${days}&limit=200`)
      .then((r) => r.json())
      .then((d) => {
        setEarnings(d.earnings ?? []);
        setNews(d.news ?? []);
        setSummary(d.summary ?? null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [view, days]);

  if (loading) {
    return (
      <div className="px-4 py-12 text-center text-[var(--text-muted)] font-terminal">
        Loading earnings & news...
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-terminal font-bold mb-1">EARNINGS & NEWS</h1>
      <p className="text-xs text-[var(--text-muted)] mb-4 font-terminal">
        Earnings calendar with surprise tracking — GDELT news feed with tone scores
      </p>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
          {[
            { label: "EARNINGS", value: String(summary.totalEarnings), color: "" },
            { label: "REPORTED", value: String(summary.reported), color: "" },
            { label: "UPCOMING", value: String(summary.upcoming), color: "var(--accent-info)" },
            { label: "BEATS", value: String(summary.beats), color: "var(--accent-bull)" },
            { label: "MISSES", value: String(summary.misses), color: "var(--accent-bear)" },
            { label: "AVG SURPRISE", value: summary.avgSurprise !== 0 ? `${summary.avgSurprise > 0 ? "+" : ""}${summary.avgSurprise}%` : "—", color: summary.avgSurprise > 0 ? "var(--accent-bull)" : summary.avgSurprise < 0 ? "var(--accent-bear)" : "" },
          ].map((c) => (
            <div key={c.label} className="p-2.5 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
              <div className="text-[9px] font-terminal text-[var(--text-muted)] tracking-widest">{c.label}</div>
              <div className="text-lg font-terminal font-bold mt-0.5" style={{ color: c.color || undefined }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(["all", "upcoming", "reported"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 text-xs font-terminal rounded border transition-colors ${
              view === v
                ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {v.toUpperCase()}
          </button>
        ))}

        <span className="border-l border-[var(--border)] mx-1" />

        {([7, 30, 90] as const).map((d) => (
          <button
            key={`d${d}`}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 text-xs font-terminal rounded border transition-colors ${
              days === d
                ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {d}D
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Earnings Calendar */}
        <div className="rounded border border-[var(--border)] bg-[var(--card-bg)]">
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <h2 className="text-sm font-terminal font-semibold tracking-wider">EARNINGS CALENDAR</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-terminal">
              <thead>
                <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
                  <th className="text-left px-3 py-2">TICKER</th>
                  <th className="text-left px-3 py-2">DATE</th>
                  <th className="text-right px-3 py-2">EPS EST</th>
                  <th className="text-right px-3 py-2">EPS ACT</th>
                  <th className="text-right px-3 py-2">SURPRISE</th>
                  <th className="text-right px-3 py-2">REV ACT</th>
                </tr>
              </thead>
              <tbody>
                {earnings.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-[var(--text-muted)]">
                      No earnings data. Run pipeline to populate.
                    </td>
                  </tr>
                ) : (
                  earnings.map((e, i) => (
                    <tr key={`${e.ticker}-${e.eventDate}-${i}`} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors">
                      <td className="px-3 py-2">
                        <Link
                          href={`/ticker/${e.ticker}`}
                          className="font-semibold text-[var(--accent-info)] hover:underline"
                        >
                          {e.ticker}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">{e.eventDate}</td>
                      <td className="px-3 py-2 text-right">{e.epsEst != null ? e.epsEst.toFixed(2) : "—"}</td>
                      <td className="px-3 py-2 text-right">{e.epsActual != null ? e.epsActual.toFixed(2) : "—"}</td>
                      <td className="px-3 py-2 text-right" style={{
                        color: e.surprisePct != null
                          ? e.surprisePct > 0 ? "var(--accent-bull)" : e.surprisePct < 0 ? "var(--accent-bear)" : undefined
                          : undefined,
                      }}>
                        {e.surprisePct != null ? `${e.surprisePct > 0 ? "+" : ""}${e.surprisePct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--text-muted)]">{formatRev(e.revenueActual)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* News Feed */}
        <div className="rounded border border-[var(--border)] bg-[var(--card-bg)]">
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <h2 className="text-sm font-terminal font-semibold tracking-wider">NEWS FEED</h2>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">GDELT — last 7 days</p>
          </div>
          <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto">
            {news.length === 0 ? (
              <p className="text-center text-[var(--text-muted)] py-8">
                No news data. Run pipeline to populate.
              </p>
            ) : (
              news.map((n) => (
                <div key={n.id} className="text-sm py-2 border-b border-[var(--border)] last:border-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Link
                      href={`/ticker/${n.ticker}`}
                      className="text-xs font-terminal font-semibold text-[var(--accent-info)] hover:underline"
                    >
                      {n.ticker}
                    </Link>
                    <span className="text-[10px] text-[var(--text-muted)]">{timeAgo(n.publishedAt)}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">{n.source}</span>
                    {n.tone != null && (
                      <span
                        className="text-[10px] px-1 rounded"
                        style={{
                          color: n.tone > 2 ? "var(--accent-bull)" : n.tone < -2 ? "var(--accent-bear)" : "var(--text-muted)",
                          backgroundColor: "var(--badge-bg)",
                        }}
                      >
                        {n.tone > 0 ? "+" : ""}{n.tone.toFixed(1)}
                      </span>
                    )}
                    {n.badge && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-warning)] text-[var(--surface)] font-bold">
                        {n.badge}
                      </span>
                    )}
                  </div>
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--text-secondary)] text-xs leading-relaxed hover:text-[var(--text-primary)] transition-colors"
                  >
                    {n.headline}
                  </a>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-[var(--text-muted)] mt-3 font-terminal">
        Earnings: LSE Company Calendar. News: GDELT DOC API (tone = sentiment score).
      </p>
    </div>
  );
}
