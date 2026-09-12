"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ModulePanel } from "@/components/ui/ModulePanel";
import { MetricCard } from "@/components/ui/MetricCard";
import { PostureGauge } from "@/components/ui/PostureGauge";
import { EmptyState } from "@/components/ui/EmptyState";

type DashData = {
  posture: number | null;
  postureLabel: string | null;
  briefText: string | null;
  breadth: { total: number; greens: number; reds: number; pctGreen: number; pctRed: number } | null;
  avgRank: number;
  bestSector: string | null;
  worstSector: string | null;
  asOfDate: string | null;
  regionBreadth: Record<string, number>;
  fundCount: number;
  highFScore: number;
  highComposite: number;
  avgComposite: number;
  pharmaLong: number;
  pharmaShort: number;
  pharmaWatch: number;
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
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/summary").then((r) => r.json()).catch(() => null),
      fetch("/api/fundamentals?limit=1000").then((r) => r.json()).catch(() => null),
      fetch("/api/pharma").then((r) => r.json()).catch(() => null),
      fetch("/api/earnings-news?days=30").then((r) => r.json()).catch(() => null),
      fetch("/api/skew").then((r) => r.json()).catch(() => null),
      fetch("/api/orb").then((r) => r.json()).catch(() => null),
      fetch("/api/analysis").then((r) => r.json()).catch(() => null),
      fetch("/api/quantropy").then((r) => r.json()).catch(() => null),
      fetch("/api/bias").then((r) => r.json()).catch(() => null),
      fetch("/api/perps").then((r) => r.json()).catch(() => null),
      fetch("/api/rotate").then((r) => r.json()).catch(() => null),
    ])
      .then(([summary, fund, pharma, earnings, skew, orb, analysis, quant, bias, perps, rotate]) => {
        if (!summary && !fund) {
          setError(true);
          return;
        }
        const rows = fund?.rows ?? [];
        const composites = rows.filter((r: { compositeScore: number | null }) => r.compositeScore != null);
        setD({
          posture: summary?.posture ?? null,
          postureLabel: summary?.postureLabel ?? null,
          briefText: summary?.briefText ?? null,
          breadth: summary?.breadth ?? null,
          avgRank: summary?.avgRank ?? 0,
          bestSector: summary?.bestSector ?? null,
          worstSector: summary?.worstSector ?? null,
          asOfDate: summary?.asOfDate ?? null,
          regionBreadth: summary?.regionBreadth ?? {},
          fundCount: rows.length,
          highFScore: rows.filter((r: { fScore?: number }) => (r.fScore ?? 0) >= 7).length,
          highComposite: composites.filter((r: { compositeScore: number }) => r.compositeScore >= 70).length,
          avgComposite: composites.length > 0
            ? Math.round(composites.reduce((s: number, r: { compositeScore: number }) => s + r.compositeScore, 0) / composites.length)
            : 0,
          pharmaLong: pharma?.summary?.long ?? 0,
          pharmaShort: pharma?.summary?.short ?? 0,
          pharmaWatch: pharma?.summary?.watch ?? 0,
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
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const postureColor =
    (d?.posture ?? 50) >= 55
      ? "var(--accent-bull)"
      : (d?.posture ?? 50) <= 45
        ? "var(--accent-bear)"
        : "var(--accent-info)";

  const regions = Object.entries(d?.regionBreadth ?? {});

  return (
    <div className="px-4 py-6 space-y-4">
      {/* Brand strip — keep first viewport focused */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1
            className="text-2xl md:text-3xl font-terminal font-bold tracking-wider"
            style={{ color: "var(--accent-info)" }}
          >
            ORBIS EQUITY
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Equity Swing Terminal — Free Data, Honest Signals, Global Coverage
          </p>
        </div>
        <div className="text-right font-terminal text-[10px] text-[var(--text-muted)] tracking-wider">
          <div>AS OF {d?.asOfDate ?? "—"} EOD</div>
          <div className="mt-0.5">PRESS ⌘K TO JUMP</div>
        </div>
      </div>

      {error && (
        <EmptyState
          title="Could not load cockpit data"
          detail="API routes returned an error. Check Supabase credentials and pipeline freshness."
        />
      )}

      {/* Market overview row — gauge + brief + pulse metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <ModulePanel
          title="EQUITY WEATHER"
          badge="OVERVIEW"
          accent="var(--module-1)"
          source="EOD"
          className="lg:col-span-3"
        >
          {loading ? (
            <div className="h-36 animate-pulse bg-[var(--surface-alt)] rounded" />
          ) : (
            <PostureGauge value={d?.posture ?? null} label={d?.postureLabel} />
          )}
        </ModulePanel>

        <ModulePanel
          title="TODAY'S BRIEF"
          badge="BRIEF"
          accent="var(--module-3)"
          source="RULE-BASED"
          className="lg:col-span-5"
        >
          {loading ? (
            <div className="space-y-2">
              <div className="h-3 bg-[var(--surface-alt)] rounded animate-pulse" />
              <div className="h-3 bg-[var(--surface-alt)] rounded animate-pulse w-5/6" />
              <div className="h-3 bg-[var(--surface-alt)] rounded animate-pulse w-4/6" />
            </div>
          ) : (
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed font-terminal">
              {d?.briefText ||
                "No brief available yet. Run the nightly pipeline to compose the morning read from posture, breadth, and sector leadership."}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="text-[10px] font-terminal">
              <span className="text-[var(--text-muted)]">BEST </span>
              <span style={{ color: "var(--accent-bull)" }}>{d?.bestSector ?? "—"}</span>
            </div>
            <div className="text-[10px] font-terminal">
              <span className="text-[var(--text-muted)]">WORST </span>
              <span style={{ color: "var(--accent-bear)" }}>{d?.worstSector ?? "—"}</span>
            </div>
          </div>
        </ModulePanel>

        <ModulePanel
          title="MARKET PULSE"
          badge="BREADTH"
          accent="var(--module-2)"
          source="TREND RADAR"
          className="lg:col-span-4"
        >
          <div className="grid grid-cols-2 gap-2">
            <MetricCard
              label="BREADTH GREEN"
              value={d?.breadth ? `${d.breadth.pctGreen}%` : "—"}
              sub={d?.breadth ? `${d.breadth.greens}/${d.breadth.total} names` : undefined}
              color="var(--accent-bull)"
              bar={d?.breadth?.pctGreen}
              barColor="var(--accent-bull)"
            />
            <MetricCard
              label="BREADTH RED"
              value={d?.breadth ? `${d.breadth.pctRed}%` : "—"}
              sub={d?.breadth ? `${d.breadth.reds} names` : undefined}
              color="var(--accent-bear)"
              bar={d?.breadth?.pctRed}
              barColor="var(--accent-bear)"
            />
            <MetricCard
              label="AVG QUALITY"
              value={d?.avgRank ?? "—"}
              sub="Universe rank"
              color={postureColor}
              bar={typeof d?.avgRank === "number" ? d.avgRank : undefined}
            />
            <MetricCard
              label="POSTURE"
              value={d?.posture ?? "—"}
              sub={d?.postureLabel ?? "Bias score"}
              color={postureColor}
              bar={typeof d?.posture === "number" ? d.posture : undefined}
              barColor={postureColor}
            />
          </div>
          {d?.breadth && (
            <div className="mt-3 h-2 rounded-full bg-[var(--gauge-track)] overflow-hidden flex">
              <div
                className="h-full"
                style={{ width: `${d.breadth.pctGreen}%`, background: "var(--accent-bull)" }}
              />
              <div
                className="h-full"
                style={{
                  width: `${Math.max(0, 100 - d.breadth.pctGreen - d.breadth.pctRed)}%`,
                  background: "var(--surface-alt)",
                }}
              />
              <div
                className="h-full"
                style={{ width: `${d.breadth.pctRed}%`, background: "var(--accent-bear)" }}
              />
            </div>
          )}
        </ModulePanel>
      </div>

      {/* Region / sector strip */}
      {(regions.length > 0 || d?.bestSector) && (
        <ModulePanel title="REGION & SECTOR PULSE" badge="MAP" accent="var(--module-4)" source="AGGREGATES">
          <div className="flex flex-wrap gap-2">
            {regions.length > 0
              ? regions.map(([region, val]) => (
                  <div
                    key={region}
                    className="px-3 py-2 rounded border border-[var(--panel-border)] font-terminal text-xs"
                  >
                    <span className="text-[var(--text-muted)] tracking-wider mr-2">
                      {region.toUpperCase()}
                    </span>
                    <span
                      style={{
                        color:
                          val >= 55
                            ? "var(--accent-bull)"
                            : val <= 45
                              ? "var(--accent-bear)"
                              : "var(--text-primary)",
                      }}
                    >
                      {typeof val === "number" ? val.toFixed(0) : val}
                    </span>
                  </div>
                ))
              : (
                <>
                  <div className="px-3 py-2 rounded border border-[var(--panel-border)] font-terminal text-xs">
                    <span className="text-[var(--text-muted)] mr-2">LEAD</span>
                    <span style={{ color: "var(--accent-bull)" }}>{d?.bestSector}</span>
                  </div>
                  <div className="px-3 py-2 rounded border border-[var(--panel-border)] font-terminal text-xs">
                    <span className="text-[var(--text-muted)] mr-2">LAG</span>
                    <span style={{ color: "var(--accent-bear)" }}>{d?.worstSector}</span>
                  </div>
                </>
              )}
          </div>
        </ModulePanel>
      )}

      {/* Module entry panels — Orbis cockpit + cloud desk stack */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {([
          {
            href: "/screener", title: "SWING SCREENER", badge: "MODULE 1",
            subtitle: "Momentum & technical bias board", accent: "var(--module-1)", source: "TREND RADAR",
            metrics: [
              { label: "POSTURE", value: d?.posture ?? "—", color: postureColor },
              { label: "GREEN", value: d?.breadth ? `${d.breadth.pctGreen}%` : "—", color: "var(--accent-bull)" },
              { label: "BEST", value: d?.bestSector ?? "—" },
            ],
          },
          {
            href: "/fundamentals", title: "QUANT FUNDAMENTALS", badge: "MODULE 2",
            subtitle: "Multi-factor scores & F-Score", accent: "var(--module-2)", source: "FUNDAMENTALS",
            metrics: [
              { label: "STOCKS", value: loading ? "…" : d?.fundCount ?? 0 },
              { label: "COMP 70+", value: loading ? "…" : d?.highComposite ?? 0, color: "var(--accent-bull)" },
              { label: "F-SCORE 7+", value: loading ? "…" : d?.highFScore ?? 0, color: "var(--accent-bull)" },
            ],
          },
          {
            href: "/pharma", title: "PHARMA PIPELINE", badge: "MODULE 3",
            subtitle: "Clinical trial catalysts", accent: "var(--module-3)", source: "CLINICALTRIALS.GOV",
            metrics: [
              { label: "LONG", value: loading ? "…" : d?.pharmaLong ?? 0, color: "var(--accent-bull)" },
              { label: "SHORT", value: loading ? "…" : d?.pharmaShort ?? 0, color: "var(--accent-bear)" },
              { label: "WATCH", value: loading ? "…" : d?.pharmaWatch ?? 0, color: "var(--accent-warning)" },
            ],
          },
          {
            href: "/loop", title: "LOOP TERMINAL", badge: "MODULE 4",
            subtitle: "Breakout portfolio harness", accent: "var(--module-1)", source: "PAPER BOOK",
            metrics: [
              { label: "POSTURE", value: d?.posture ?? "—", color: postureColor },
              { label: "GREEN", value: d?.breadth ? `${d.breadth.pctGreen}%` : "—", color: "var(--accent-bull)" },
              { label: "BEST", value: d?.bestSector ?? "—" },
            ],
          },
          {
            href: "/earnings-news", title: "EARNINGS & NEWS", badge: "MODULE 5",
            subtitle: "Calendar + GDELT sentiment", accent: "var(--module-4)", source: "LSE · GDELT",
            metrics: [
              { label: "BEATS", value: loading ? "…" : d?.earningsBeats ?? 0, color: "var(--accent-bull)" },
              { label: "MISSES", value: loading ? "…" : d?.earningsMisses ?? 0, color: "var(--accent-bear)" },
              { label: "UPCOMING", value: loading ? "…" : d?.earningsUpcoming ?? 0, color: "var(--accent-info)" },
            ],
          },
          {
            href: "/skew", title: "SKEW MAP", badge: "MODULE 6",
            subtitle: "Listed IV surface", accent: "var(--module-2)", source: "OPTIONS",
            metrics: [
              { label: "NAMES", value: d?.skewNames ? String(d.skewNames) : "—" },
              { label: "AVG ATM", value: d?.skewAtm == null ? "—" : `${(d.skewAtm * 100).toFixed(0)}%`, color: "var(--accent-info)" },
              { label: "WKND", value: d?.skewWeekend ?? "—", color: "var(--accent-warning)" },
            ],
          },
          {
            href: "/orb", title: "OPENING RANGE", badge: "MODULE 7",
            subtitle: "Gapper screen + OR breakout", accent: "var(--module-3)", source: "15M OR",
            metrics: [
              { label: "GAPPERS", value: d?.orbGappers ? String(d.orbGappers) : "—", color: "var(--accent-info)" },
              { label: "LONGS", value: String(d?.orbBreakouts ?? 0), color: "var(--accent-bull)" },
              { label: "OR", value: "15m" },
            ],
          },
          {
            href: "/analysis", title: "STOCK ANALYSIS", badge: "MODULE 8",
            subtitle: "Tech + fundamental stack", accent: "var(--module-1)", source: "ANALYZE",
            metrics: [
              { label: "BUY", value: String(d?.analysisBuys ?? 0), color: "var(--accent-bull)" },
              { label: "SELL", value: String(d?.analysisSells ?? 0), color: "var(--accent-bear)" },
              { label: "STACK", value: "6" },
            ],
          },
          {
            href: "/quantropy", title: "QUANTROPY", badge: "MODULE 9",
            subtitle: "Risk, CAPM, Markowitz", accent: "var(--module-4)", source: "QUANT",
            metrics: [
              { label: "NAMES", value: d?.quantNames ? String(d.quantNames) : "—" },
              { label: "MAX SH", value: d?.quantSharpe == null ? "—" : d.quantSharpe.toFixed(2), color: "var(--accent-warning)" },
              { label: "MPT", value: "on", color: "var(--accent-info)" },
            ],
          },
          {
            href: "/bias", title: "DAILY BIAS", badge: "MODULE 10",
            subtitle: "Tape, levels, paper ideas", accent: "var(--module-2)", source: "BIAS",
            metrics: [
              { label: "LONG", value: String(d?.biasLongs ?? 0), color: "var(--accent-bull)" },
              { label: "SHORT", value: String(d?.biasShorts ?? 0), color: "var(--accent-bear)" },
              { label: "CHART", value: "TV", color: "var(--accent-info)" },
            ],
          },
          {
            href: "/cash", title: "TEMA + CARVER CASH", badge: "MODULE 11",
            subtitle: "Cash-sized TEMA & Carver", accent: "var(--module-3)", source: "CASH",
            metrics: [
              { label: "TEMA", value: String(d?.perpsTema ?? 0), color: "var(--accent-info)" },
              { label: "CARVER", value: String(d?.perpsCarver ?? 0), color: "var(--accent-warning)" },
              { label: "VENUE", value: "CASH", color: "var(--accent-bull)" },
            ],
          },
          {
            href: "/rotate", title: "BETA ROTATION", badge: "MODULE 12",
            subtitle: "Macro → sector → Carver DCA", accent: "var(--module-4)", source: "ROTATE",
            metrics: [
              { label: "REGIME", value: d?.rotateRegime ?? "—", color: d?.rotateRegime === "RISK-ON" ? "var(--accent-bull)" : d?.rotateRegime === "RISK-OFF" ? "var(--accent-bear)" : "var(--accent-warning)" },
              { label: "LEADING", value: String(d?.rotateLeading ?? 0), color: "var(--accent-bull)" },
              { label: "TAPE", value: "Carver", color: "var(--accent-info)" },
            ],
          },
          {
            href: "/health", title: "HEALTH CATALYST", badge: "MODULE 13",
            subtitle: "Health & catalyst desk", accent: "var(--module-1)", source: "HEALTH",
            metrics: [
              { label: "DESK", value: "ON", color: "var(--accent-info)" },
              { label: "NEWS", value: loading ? "…" : d?.newsCount ?? 0 },
              { label: "EOD", value: d?.asOfDate ?? "—" },
            ],
          },
          {
            href: "/perps", title: "PERPS DESK", badge: "MODULE 14",
            subtitle: "TEMA / Carver perps book", accent: "var(--module-2)", source: "PERPS",
            metrics: [
              { label: "TEMA", value: String(d?.perpsTema ?? 0), color: "var(--accent-info)" },
              { label: "CARVER", value: String(d?.perpsCarver ?? 0), color: "var(--accent-warning)" },
              { label: "BOOK", value: "QMIE", color: "var(--accent-bull)" },
            ],
          },
        ] as const).map((m) => (
          <Link key={m.badge} href={m.href} className="block group">
            <ModulePanel
              title={m.title}
              badge={m.badge}
              subtitle={m.subtitle}
              accent={m.accent}
              source={m.source}
              className="h-full transition-opacity group-hover:opacity-95"
            >
              <div className="grid grid-cols-3 gap-2">
                {m.metrics.map((metric) => (
                  <MetricCard
                    key={metric.label}
                    label={metric.label}
                    value={metric.value}
                    color={"color" in metric ? metric.color : undefined}
                  />
                ))}
              </div>
            </ModulePanel>
          </Link>
        ))}
      </div>
    </div>
  );
}
