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
  pharmaLong: number;
  pharmaShort: number;
  pharmaWatch: number;
  earningsBeats: number;
  earningsMisses: number;
  earningsUpcoming: number;
  newsCount: number;
};

export default function Home() {
  const [d, setD] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/summary").then((r) => r.json()),
      fetch("/api/fundamentals").then((r) => r.json()),
      fetch("/api/pharma").then((r) => r.json()),
      fetch("/api/earnings-news?days=30").then((r) => r.json()),
    ])
      .then(([summary, fund, pharma, earnings]) => {
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
          fundCount: fund?.rows?.length ?? 0,
          highFScore: (fund?.rows ?? []).filter((r: { fScore?: number }) => (r.fScore ?? 0) >= 7).length,
          pharmaLong: pharma?.summary?.long ?? 0,
          pharmaShort: pharma?.summary?.short ?? 0,
          pharmaWatch: pharma?.summary?.watch ?? 0,
          earningsBeats: earnings?.summary?.beats ?? 0,
          earningsMisses: earnings?.summary?.misses ?? 0,
          earningsUpcoming: earnings?.summary?.upcoming ?? 0,
          newsCount: earnings?.summary?.totalNews ?? 0,
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

      {/* Four module entry panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Link href="/screener" className="block group">
          <ModulePanel
            title="SWING SCREENER"
            badge="MODULE 1"
            subtitle="Momentum & technical bias board"
            accent="var(--module-1)"
            source="TREND RADAR"
            className="h-full transition-opacity group-hover:opacity-95"
          >
            <div className="grid grid-cols-3 gap-2">
              <MetricCard label="POSTURE" value={d?.posture ?? "—"} color={postureColor} />
              <MetricCard
                label="GREEN"
                value={d?.breadth ? `${d.breadth.pctGreen}%` : "—"}
                color="var(--accent-bull)"
              />
              <MetricCard label="BEST" value={d?.bestSector ?? "—"} />
            </div>
          </ModulePanel>
        </Link>

        <Link href="/fundamentals" className="block group">
          <ModulePanel
            title="FUNDAMENTALS"
            badge="MODULE 2"
            subtitle="Ratios, F-Score, valuation"
            accent="var(--module-2)"
            source="FUNDAMENTALS"
            className="h-full transition-opacity group-hover:opacity-95"
          >
            <div className="grid grid-cols-3 gap-2">
              <MetricCard label="STOCKS" value={loading ? "…" : d?.fundCount ?? 0} />
              <MetricCard
                label="F-SCORE 7+"
                value={loading ? "…" : d?.highFScore ?? 0}
                color="var(--accent-bull)"
              />
              <MetricCard label="AVG RANK" value={d?.avgRank ?? "—"} />
            </div>
          </ModulePanel>
        </Link>

        <Link href="/pharma" className="block group">
          <ModulePanel
            title="PHARMA PIPELINE"
            badge="MODULE 3"
            subtitle="Clinical trial catalysts"
            accent="var(--module-3)"
            source="CLINICALTRIALS.GOV"
            className="h-full transition-opacity group-hover:opacity-95"
          >
            <div className="grid grid-cols-3 gap-2">
              <MetricCard
                label="LONG"
                value={loading ? "…" : d?.pharmaLong ?? 0}
                color="var(--accent-bull)"
              />
              <MetricCard
                label="SHORT"
                value={loading ? "…" : d?.pharmaShort ?? 0}
                color="var(--accent-bear)"
              />
              <MetricCard
                label="WATCH"
                value={loading ? "…" : d?.pharmaWatch ?? 0}
                color="var(--accent-warning)"
              />
            </div>
          </ModulePanel>
        </Link>

        <Link href="/earnings-news" className="block group">
          <ModulePanel
            title="EARNINGS & NEWS"
            badge="MODULE 4"
            subtitle="Calendar + GDELT sentiment"
            accent="var(--module-4)"
            source="LSE · GDELT"
            className="h-full transition-opacity group-hover:opacity-95"
          >
            <div className="grid grid-cols-3 gap-2">
              <MetricCard
                label="BEATS"
                value={loading ? "…" : d?.earningsBeats ?? 0}
                color="var(--accent-bull)"
              />
              <MetricCard
                label="MISSES"
                value={loading ? "…" : d?.earningsMisses ?? 0}
                color="var(--accent-bear)"
              />
              <MetricCard
                label="UPCOMING"
                value={loading ? "…" : d?.earningsUpcoming ?? 0}
                color="var(--accent-info)"
              />
            </div>
          </ModulePanel>
        </Link>
      </div>
    </div>
  );
}
