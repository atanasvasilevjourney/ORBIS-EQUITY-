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
  fundCount: number;
  highFScore: number;
  highComposite: number;
  avgComposite: number;
  earningsBeats: number;
  earningsMisses: number;
  earningsUpcoming: number;
  newsCount: number;
  skewNames: number;
  skewAtm: number | null;
  skewWeekend: string | null;
  orbGappers: number;
  orbBreakouts: number;
  analysisBuys: number;
  analysisSells: number;
  quantNames: number;
  quantSharpe: number | null;
  biasLongs: number;
  biasShorts: number;
  perpsTema: number;
  perpsCarver: number;
  rotateRegime: string | null;
  rotateLeading: number;
};

export default function Home() {
  const [d, setD] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/summary").then((r) => r.json()).catch(() => null),
      fetch("/api/fundamentals?limit=1000").then((r) => r.json()).catch(() => null),
      fetch("/api/earnings-news?days=30").then((r) => r.json()).catch(() => null),
      fetch("/api/skew").then((r) => r.json()).catch(() => null),
      fetch("/api/orb").then((r) => r.json()).catch(() => null),
      fetch("/api/analysis").then((r) => r.json()).catch(() => null),
      fetch("/api/quantropy").then((r) => r.json()).catch(() => null),
      fetch("/api/bias").then((r) => r.json()).catch(() => null),
      fetch("/api/perps").then((r) => r.json()).catch(() => null),
      fetch("/api/rotate").then((r) => r.json()).catch(() => null),
    ]).then(([summary, fund, earnings, skew, orb, analysis, quant, bias, perps, rotate]) => {
      const rows = fund?.rows ?? [];
      const composites = rows.filter((r: { compositeScore: number | null }) => r.compositeScore != null);
      setD({
        posture: summary?.posture ?? null,
        postureLabel: summary?.postureLabel ?? null,
        breadth: summary?.breadth ?? null,
        avgRank: summary?.avgRank ?? 0,
        bestSector: summary?.bestSector ?? null,
        worstSector: summary?.worstSector ?? null,
        asOfDate: summary?.asOfDate ?? null,
        fundCount: rows.length,
        highFScore: rows.filter((r: { fScore: number | null }) => (r.fScore ?? 0) >= 7).length,
        highComposite: composites.filter((r: { compositeScore: number }) => r.compositeScore >= 70).length,
        avgComposite: composites.length > 0
          ? Math.round(composites.reduce((s: number, r: { compositeScore: number }) => s + r.compositeScore, 0) / composites.length)
          : 0,
        earningsBeats: earnings?.summary?.beats ?? 0,
        earningsMisses: earnings?.summary?.misses ?? 0,
        earningsUpcoming: earnings?.summary?.upcoming ?? 0,
        newsCount: earnings?.summary?.totalNews ?? 0,
        skewNames: skew?.summary?.names ?? 0,
        skewAtm: skew?.summary?.avgAtmIv ?? null,
        skewWeekend: skew?.summary?.weekendRichest ?? null,
        orbGappers: orb?.summary?.names ?? 0,
        orbBreakouts: orb?.summary?.breakouts ?? 0,
        analysisBuys: analysis?.summary?.buys ?? 0,
        analysisSells: analysis?.summary?.sells ?? 0,
        quantNames: quant?.summary?.names ?? 0,
        quantSharpe: quant?.summary?.maxSharpe ?? null,
        biasLongs: bias?.summary?.longs ?? 0,
        biasShorts: bias?.summary?.shorts ?? 0,
        perpsTema: perps?.summary?.temaSlots ?? 0,
        perpsCarver: perps?.summary?.carverSlots ?? 0,
        rotateRegime: rotate?.summary?.regime ?? null,
        rotateLeading: rotate?.summary?.leading ?? 0,
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
      title: "QUANT FUNDAMENTALS",
      badge: "MODULE 2",
      desc: "Multi-factor scores — value, quality, growth, earnings quality, leverage",
      stats: d ? [
        { label: "Universe", value: String(d.fundCount), color: "" },
        { label: "Composite 70+", value: String(d.highComposite), color: "var(--accent-bull)" },
        { label: "Avg Factor", value: d.avgComposite > 0 ? String(d.avgComposite) : "—", color: "" },
      ] : null,
    },
    {
      href: "/fundamentals",
      title: "F-SCORE & VALUATION",
      badge: "MODULE 3",
      desc: "Piotroski F-Score, 50+ valuation ratios, sector-relative ranks",
      stats: d ? [
        { label: "F-Score 7+", value: String(d.highFScore), color: "var(--accent-bull)" },
        { label: "Avg Rank", value: String(d.avgRank), color: "" },
        { label: "Sectors", value: "50+", color: "" },
      ] : null,
    },
    {
      href: "/loop",
      title: "LOOP TERMINAL",
      badge: "MODULE 4",
      desc: "Breakout portfolio harness — 2N ATR sizing, sector caps, paper book",
      stats: d ? [
        { label: "Posture", value: d.posture ?? "—", color: postureColor },
        { label: "Breadth", value: d.breadth ? `${d.breadth.pctGreen}% green` : "—", color: "var(--accent-bull)" },
        { label: "Best", value: d.bestSector ?? "—", color: "" },
      ] : null,
    },
    {
      href: "/earnings-news",
      title: "EARNINGS & NEWS",
      badge: "MODULE 5",
      desc: "Earnings calendar + GDELT news feed",
      stats: d ? [
        { label: "Beats", value: String(d.earningsBeats), color: "var(--accent-bull)" },
        { label: "Misses", value: String(d.earningsMisses), color: "var(--accent-bear)" },
        { label: "Upcoming", value: String(d.earningsUpcoming), color: "var(--accent-info)" },
      ] : null,
    },
    {
      href: "/skew",
      title: "SKEW MAP",
      badge: "MODULE 6",
      desc: "Listed IV surface — skew, term, weekend vol from option chains",
      stats: d ? [
        { label: "Names", value: d.skewNames ? String(d.skewNames) : "—", color: "" },
        { label: "Avg ATM", value: d.skewAtm == null ? "—" : `${(d.skewAtm * 100).toFixed(0)}%`, color: "var(--accent-info)" },
        { label: "Wknd", value: d.skewWeekend ?? "—", color: "var(--accent-warning)" },
      ] : null,
    },
    {
      href: "/orb",
      title: "OPENING RANGE",
      badge: "MODULE 7",
      desc: "Gapper screen + 15-minute OR breakout, long-only 1R paper brackets",
      stats: d ? [
        { label: "Gappers", value: d.orbGappers ? String(d.orbGappers) : "—", color: "var(--accent-info)" },
        { label: "Longs", value: String(d.orbBreakouts), color: "var(--accent-bull)" },
        { label: "OR", value: "15m", color: "" },
      ] : null,
    },
    {
      href: "/analysis",
      title: "STOCK ANALYSIS",
      badge: "MODULE 8",
      desc: "Technical MA/MACD/RSI/regression plus fundamental composite & F-Score",
      stats: d ? [
        { label: "Buy", value: String(d.analysisBuys), color: "var(--accent-bull)" },
        { label: "Sell", value: String(d.analysisSells), color: "var(--accent-bear)" },
        { label: "Stack", value: "6", color: "" },
      ] : null,
    },
    {
      href: "/quantropy",
      title: "QUANTROPY",
      badge: "MODULE 9",
      desc: "Risk, CAPM, Altman Z, Markowitz allocation from the Quantropy library",
      stats: d ? [
        { label: "Names", value: d.quantNames ? String(d.quantNames) : "—", color: "" },
        { label: "Max Sh", value: d.quantSharpe == null ? "—" : d.quantSharpe.toFixed(2), color: "var(--accent-warning)" },
        { label: "MPT", value: "on", color: "var(--accent-info)" },
      ] : null,
    },
    {
      href: "/bias",
      title: "DAILY BIAS",
      badge: "MODULE 10",
      desc: "TradingView-style tape, key levels, and paper trade ideas from ANALYZE + ATR pivots",
      stats: d ? [
        { label: "Long", value: String(d.biasLongs), color: "var(--accent-bull)" },
        { label: "Short", value: String(d.biasShorts), color: "var(--accent-bear)" },
        { label: "Chart", value: "TV", color: "var(--accent-info)" },
      ] : null,
    },
    {
      href: "/cash",
      title: "TEMA + CARVER CASH",
      badge: "MODULE 11",
      desc: "TEMA 9/99/199 and Carver EWMAC sized as fully funded cash shares at the listed close",
      stats: d ? [
        { label: "TEMA", value: String(d.perpsTema), color: "var(--accent-info)" },
        { label: "Carver", value: String(d.perpsCarver), color: "var(--accent-warning)" },
        { label: "Venue", value: "CASH", color: "var(--accent-bull)" },
      ] : null,
    },
    {
      href: "/rotate",
      title: "BETA ROTATION",
      badge: "MODULE 12",
      desc: "Macro → sector → sub-sector → asset. Carver D-rungs DCA on the bigger trend and rotate into the sleeve",
      stats: d ? [
        { label: "Regime", value: d.rotateRegime ?? "—", color: d.rotateRegime === "RISK-ON" ? "var(--accent-bull)" : d.rotateRegime === "RISK-OFF" ? "var(--accent-bear)" : "var(--accent-warning)" },
        { label: "Leading", value: String(d.rotateLeading), color: "var(--accent-bull)" },
        { label: "Tape", value: "Carver", color: "var(--accent-info)" },
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
          Systematic Equity Terminal — Momentum, Multi-Factor Fundamentals, Earnings
        </p>
        {d?.asOfDate && (
          <p className="text-xs text-[var(--text-muted)] mt-1 font-terminal">
            Last refresh: {d.asOfDate} EOD
          </p>
        )}
      </div>

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
                <div className="h-full rounded-l-full" style={{ width: `${d.breadth.pctGreen}%`, backgroundColor: "var(--accent-bull)" }} />
                <div className="h-full" style={{ width: `${100 - d.breadth.pctGreen - d.breadth.pctRed}%`, backgroundColor: "var(--surface-alt)" }} />
                <div className="h-full rounded-r-full" style={{ width: `${d.breadth.pctRed}%`, backgroundColor: "var(--accent-bear)" }} />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto">
        {modules.map((m) => (
          <Link
            key={m.badge}
            href={m.href}
            className="block p-5 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] hover:border-[var(--accent-info)] transition-colors group"
          >
            <span className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">{m.badge}</span>
            <h2 className="text-lg font-terminal font-semibold mt-1 mb-1 group-hover:text-[var(--accent-info)] transition-colors">{m.title}</h2>
            <p className="text-xs text-[var(--text-secondary)] mb-3">{m.desc}</p>
            {m.stats && !loading && (
              <div className="flex gap-4 pt-2 border-t border-[var(--border)]">
                {m.stats.map((s) => (
                  <div key={s.label} className="text-center">
                    <div className="text-[9px] font-terminal text-[var(--text-muted)] tracking-widest">{s.label}</div>
                    <div className="text-sm font-terminal font-bold" style={{ color: s.color || undefined }}>{s.value}</div>
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
