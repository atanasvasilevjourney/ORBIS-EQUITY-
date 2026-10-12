"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ModulePanel } from "@/components/ui/ModulePanel";
import { MetricCard } from "@/components/ui/MetricCard";
import { PostureGauge } from "@/components/ui/PostureGauge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PostureBreakdown, type PosturePillars } from "@/components/ui/PostureBreakdown";
import { CrossAssetStrip, type CrossAssetTile } from "@/components/dashboard/CrossAssetStrip";

type DashData = {
  posture: number | null;
  postureLabel: string | null;
  briefText: string | null;
  posturePillars?: PosturePillars | null;
  breadth: {
    total: number;
    onList?: number;
    onListPct?: number;
    advancersPct?: number;
    downDay?: number;
    downDayPct?: number;
    greens: number;
    reds: number;
    pctGreen: number;
    pctRed: number;
  } | null;
  avgRank: number;
  bestSector: string | null;
  worstSector: string | null;
  asOfDate: string | null;
  regionBreadth: Record<string, number>;
  crossAsset: CrossAssetTile[];
  rotation: {
    regime: string | null;
    headline: string | null;
    leading: number;
    sectors: { name: string; rs4w: number | null; impulse: number | null; label: string | null; nNames: number }[];
  };
  watchlistMovers: { symbol: string; rank: number; dayPct: number | null; orbisScore: number | null }[];
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
  const [error, setError] = useState(false);
  const [showDesks, setShowDesks] = useState(false);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((dash) => {
        if (dash?.error) {
          setError(true);
          return;
        }
        const f = dash.fundamentals ?? {};
        setD({
          posture: dash.posture ?? null,
          postureLabel: dash.postureLabel ?? null,
          briefText: dash.briefText ?? null,
          posturePillars: dash.posturePillars ?? null,
          breadth: dash.breadth ?? null,
          avgRank: dash.avgRank ?? 0,
          bestSector: dash.bestSector ?? null,
          worstSector: dash.worstSector ?? null,
          asOfDate: dash.asOfDate ?? null,
          regionBreadth: dash.regionBreadth ?? {},
          crossAsset: dash.crossAsset ?? [],
          rotation: dash.rotation ?? { regime: null, headline: null, leading: 0, sectors: [] },
          watchlistMovers: dash.watchlistMovers ?? [],
          fundCount: f.count ?? 0,
          highFScore: f.highFScore ?? 0,
          highComposite: f.highComposite ?? 0,
          avgComposite: f.avgComposite ?? 0,
          earningsBeats: 0,
          earningsMisses: 0,
          earningsUpcoming: 0,
          newsCount: 0,
          skewNames: 0,
          skewAtm: null,
          skewWeekend: null,
          orbGappers: 0,
          orbBreakouts: 0,
          analysisBuys: 0,
          analysisSells: 0,
          quantNames: 0,
          quantSharpe: null,
          biasLongs: 0,
          biasShorts: 0,
          perpsTema: 0,
          perpsCarver: 0,
          rotateRegime: dash.rotation?.regime ?? null,
          rotateLeading: dash.rotation?.leading ?? 0,
        });
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!showDesks || !d) return;
    Promise.all([
      fetch("/api/earnings-news?days=30").then((r) => r.json()).catch(() => null),
      fetch("/api/skew").then((r) => r.json()).catch(() => null),
      fetch("/api/orb").then((r) => r.json()).catch(() => null),
      fetch("/api/analysis").then((r) => r.json()).catch(() => null),
      fetch("/api/quantropy").then((r) => r.json()).catch(() => null),
      fetch("/api/bias").then((r) => r.json()).catch(() => null),
      fetch("/api/perps").then((r) => r.json()).catch(() => null),
    ]).then(([earnings, skew, orb, analysis, quant, bias, perps]) => {
      setD((prev) =>
        prev
          ? {
              ...prev,
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
            }
          : prev
      );
    });
  }, [showDesks, d?.asOfDate]);

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
            <>
              <PostureGauge value={d?.posture ?? null} label={d?.postureLabel} />
              <PostureBreakdown pillars={d?.posturePillars} />
            </>
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
          badge="TAPE"
          accent="var(--module-2)"
          source="WATCHLIST · EOD"
          className="lg:col-span-4"
        >
          <div className="grid grid-cols-2 gap-2">
            <MetricCard
              label="ADVANCERS"
              value={
                d?.breadth?.advancersPct != null ? `${d.breadth.advancersPct}%` : "—"
              }
              sub={d?.breadth ? `${d.breadth.total} names · drives POSTURE` : undefined}
              color="var(--accent-bull)"
              bar={d?.breadth?.advancersPct}
              barColor="var(--accent-bull)"
            />
            <MetricCard
              label="ON LIST"
              value={
                d?.breadth?.onListPct != null
                  ? `${d.breadth.onListPct}%`
                  : d?.breadth
                    ? `${d.breadth.pctGreen}%`
                    : "—"
              }
              sub={
                d?.breadth
                  ? `${d.breadth.onList ?? d.breadth.greens} watchlist · +4% & 2× vol`
                  : undefined
              }
              color="var(--accent-info)"
              bar={d?.breadth?.onListPct ?? d?.breadth?.pctGreen}
              barColor="var(--accent-info)"
            />
            <MetricCard
              label="DOWN DAY"
              value={
                d?.breadth?.downDayPct != null
                  ? `${d.breadth.downDayPct}%`
                  : d?.breadth
                    ? `${d.breadth.pctRed}%`
                    : "—"
              }
              sub={d?.breadth ? `${d.breadth.downDay ?? d.breadth.reds} names` : undefined}
              color="var(--accent-bear)"
              bar={d?.breadth?.downDayPct ?? d?.breadth?.pctRed}
              barColor="var(--accent-bear)"
            />
            <MetricCard
              label="POSTURE"
              value={d?.posture ?? "—"}
              sub={d?.postureLabel ?? "≈ advancers %"}
              color={postureColor}
              bar={typeof d?.posture === "number" ? d.posture : undefined}
              barColor={postureColor}
            />
          </div>
          {d?.breadth && d.breadth.advancersPct != null && (
            <div className="mt-3 h-2 rounded-full bg-[var(--gauge-track)] overflow-hidden flex">
              <div
                className="h-full"
                title="Advancers"
                style={{
                  width: `${d.breadth.advancersPct}%`,
                  background: "var(--accent-bull)",
                }}
              />
              <div
                className="h-full"
                style={{
                  width: `${Math.max(
                    0,
                    100 - d.breadth.advancersPct - (d.breadth.downDayPct ?? d.breadth.pctRed)
                  )}%`,
                  background: "var(--surface-alt)",
                }}
              />
              <div
                className="h-full"
                title="Down day"
                style={{
                  width: `${d.breadth.downDayPct ?? d.breadth.pctRed}%`,
                  background: "var(--accent-bear)",
                }}
              />
            </div>
          )}
        </ModulePanel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <ModulePanel
          title="CROSS-ASSET"
          badge="TAPE"
          accent="var(--module-4)"
          source="PRICES · EOD"
          className="xl:col-span-5"
        >
          <CrossAssetStrip tiles={d?.crossAsset ?? []} />
        </ModulePanel>
        <ModulePanel
          title="LEADERSHIP & ROTATION"
          badge="SECTORS"
          accent="var(--module-2)"
          source={d?.rotation?.regime ?? "ROTATE"}
          className="xl:col-span-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-xs font-terminal text-[var(--text-secondary)]">
              {d?.rotation?.headline ?? "Sector tape from latest rotation run"}
            </span>
            <Link href="/rotate" className="text-[10px] font-terminal text-[var(--accent-info)] hover:underline">
              Open rotation desk →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-terminal">
              <thead>
                <tr className="text-[10px] text-[var(--text-muted)] border-b border-[var(--border)]">
                  <th className="text-left py-1">SECTOR</th>
                  <th className="text-left py-1">LABEL</th>
                  <th className="text-right py-1">RS 4W</th>
                  <th className="text-right py-1">IMPULSE</th>
                </tr>
              </thead>
              <tbody>
                {(d?.rotation?.sectors ?? []).slice(0, 8).map((s) => (
                  <tr key={s.name} className="border-b border-[var(--border)]">
                    <td className="py-1.5">{s.name}</td>
                    <td className="py-1.5 text-[var(--text-muted)]">{s.label ?? "—"}</td>
                    <td className="py-1.5 text-right">{s.rs4w == null ? "—" : `${(s.rs4w * 100).toFixed(1)}%`}</td>
                    <td className="py-1.5 text-right">{s.impulse == null ? "—" : `${(s.impulse * 100).toFixed(1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ModulePanel>
      </div>

      {(d?.watchlistMovers?.length ?? 0) > 0 && (
        <ModulePanel title="WATCHLIST MOVERS" badge="HOT" accent="var(--module-1)" source="MODULE 1">
          <div className="flex flex-wrap gap-2">
            {d!.watchlistMovers.map((m) => (
              <Link
                key={m.symbol}
                href={`/ticker/${m.symbol}`}
                className="px-2 py-1 rounded border border-[var(--panel-border)] text-xs font-terminal hover:border-[var(--accent-info)]"
              >
                <span className="font-bold">{m.symbol}</span>
                <span className="text-[var(--text-muted)] ml-2">O {m.orbisScore ?? "—"}</span>
                <span className="ml-2" style={{ color: "var(--accent-bull)" }}>
                  {m.dayPct != null ? `+${m.dayPct.toFixed(1)}%` : ""}
                </span>
              </Link>
            ))}
          </div>
        </ModulePanel>
      )}

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

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowDesks((v) => !v)}
          className="text-xs font-terminal px-3 py-1.5 rounded border border-[var(--panel-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {showDesks ? "Hide module desks" : "Show all module desks"}
        </button>
      </div>

      {showDesks && (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {([
          {
            href: "/screener", title: "WATCHLIST", badge: "MODULE 1",
            subtitle: "Day strength and relative volume — scan only", accent: "var(--module-1)", source: "EOD",
            metrics: [
              { label: "POSTURE", value: d?.posture ?? "—", color: postureColor },
              { label: "ON LIST", value: d?.breadth ? d.breadth.greens : "—", color: "var(--accent-bull)" },
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
            href: "/loop", title: "LOOP TERMINAL", badge: "MODULE 4",
            subtitle: "Breakout portfolio harness", accent: "var(--module-1)", source: "PAPER BOOK",
            metrics: [
              { label: "POSTURE", value: d?.posture ?? "—", color: postureColor },
              {
                label: "ADVANCERS",
                value:
                  d?.breadth?.advancersPct != null
                    ? `${d.breadth.advancersPct}%`
                    : "—",
                color: "var(--accent-bull)",
              },
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
            subtitle: "In-sample MPT · diagnostic only", accent: "var(--module-4)", source: "QUANT",
            metrics: [
              { label: "NAMES", value: d?.quantNames ? String(d.quantNames) : "—" },
              { label: "MAX SH", value: d?.quantSharpe == null ? "—" : d.quantSharpe.toFixed(2), color: "var(--accent-warning)" },
              { label: "SAMPLE", value: "IS", color: "var(--accent-warning)" },
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
            href: "/health", title: "HEALTH SECTOR", badge: "MODULE 13",
            subtitle: "Health Care fundamentals desk", accent: "var(--module-1)", source: "FUNDAMENTALS",
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
      )}
    </div>
  );
}
