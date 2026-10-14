"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { orbisScoreColor } from "@/lib/orbisScore";

type Macro = {
  symbol: string;
  label: string;
  last: number;
  ma200: number;
  distMa200Pct: number | null;
  regime: string;
  swingHigh: number | null;
  swingLow: number | null;
  narrative: string;
};

type Setup = {
  rank: number;
  ticker: string;
  companyName: string;
  themeBucket: string | null;
  deskSource: string | null;
  side: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  orbisScore: number | null;
  status: string;
  rationale: string | null;
};

type PackData = {
  summary: {
    packId: string;
    weekStart: string;
    asOfDate: string;
    lastRunAt: string | null;
  } | null;
  macro: Macro[];
  internals: Record<string, unknown> | null;
  sectorRotation: {
    leaders?: { name: string; rs4w: number; label: string }[];
    laggards?: { name: string; rs4w: number; label: string }[];
    headline?: string;
  } | null;
  riskNotes: Record<string, unknown> | null;
  setups: Setup[];
  headline: string | null;
  stale: boolean;
};

const px = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

export default function ResearchWeeklyPage() {
  const [d, setD] = useState<PackData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/research-weekly")
      .then(async (r) => {
        if (!r.ok) throw new Error("research-weekly");
        return r.json() as Promise<PackData>;
      })
      .then(setD)
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  const s = d?.summary;
  const brief = (d?.internals?.dailyBrief ?? null) as Record<string, unknown> | null;
  const radar = (d?.internals?.trendRadar ?? null) as Record<string, unknown> | null;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-terminal tracking-wide text-[var(--accent-info)]">WEEKLY RESEARCH</h1>
          <p className="text-xs text-[var(--text-muted)] font-terminal mt-1">
            Money Machine-style macro + ORBIS transparent setups · paper only · no trade until entry
          </p>
        </div>
        {d?.stale && (
          <span className="text-xs font-terminal px-2 py-1 rounded bg-[var(--badge-bg)] text-[var(--accent-warning)]">
            STALE DATA
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-[var(--text-muted)]">Loading pack…</p>}

      {!loading && !d?.summary && (
        <p className="text-sm text-[var(--text-muted)]">
          No weekly pack yet. Run{" "}
          <code className="text-[var(--accent-info)]">python -m pipeline.research_framework.generate</code> after migrations.
        </p>
      )}

      {d?.headline && (
        <div className="border border-[var(--panel-border)] rounded-lg p-4 bg-[var(--surface-alt)]">
          <p className="text-sm font-terminal text-[var(--text-primary)]">{d.headline}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-2 font-terminal">
            Week {s?.weekStart ?? "—"} · as of {s?.asOfDate ?? "—"}
          </p>
        </div>
      )}

      {d?.macro && d.macro.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-terminal text-[var(--text-secondary)]">MACRO / INDEX</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {d.macro.map((m) => (
              <div key={m.symbol} className="border border-[var(--panel-border)] rounded-lg p-4 bg-[var(--surface)]">
                <div className="flex justify-between items-center">
                  <span className="font-terminal text-[var(--accent-info)]">{m.symbol}</span>
                  <span className="text-xs text-[var(--text-muted)]">{m.label}</span>
                </div>
                <p className="text-lg font-terminal mt-2">{px(m.last)}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  MA200 {px(m.ma200)} · {m.distMa200Pct != null ? `${m.distMa200Pct > 0 ? "+" : ""}${m.distMa200Pct}%` : "—"} ·{" "}
                  {m.regime.replace("_", " ")}
                </p>
                <p className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed">{m.narrative}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {(brief || radar) && (
        <section className="border border-[var(--panel-border)] rounded-lg p-4 bg-[var(--surface)]">
          <h2 className="text-sm font-terminal text-[var(--text-secondary)] mb-2">INTERNALS</h2>
          {brief && (
            <p className="text-sm text-[var(--text-primary)]">
              {(brief.postureLabel as string) ?? "—"} posture · {(brief.briefText as string)?.slice(0, 160) ?? ""}
            </p>
          )}
          {radar && (
            <p className="text-xs text-[var(--text-muted)] mt-2 font-terminal">
              Trend radar: {String(radar.onList ?? "—")}/{String(radar.universe ?? "—")} on list (
              {String(radar.onListPct ?? "—")}%) · advancers {String(radar.advancersPct ?? "—")}%
            </p>
          )}
        </section>
      )}

      {d?.sectorRotation?.leaders && d.sectorRotation.leaders.length > 0 && (
        <section className="border border-[var(--panel-border)] rounded-lg p-4 bg-[var(--surface)]">
          <h2 className="text-sm font-terminal text-[var(--text-secondary)] mb-2">SECTOR ROTATION</h2>
          <p className="text-xs text-[var(--text-muted)] mb-2">{d.sectorRotation.headline ?? ""}</p>
          <div className="flex flex-wrap gap-4 text-xs font-terminal">
            <div>
              <span className="text-[var(--accent-bull)]">Leaders</span>
              {d.sectorRotation.leaders.map((g) => (
                <div key={g.name}>{g.name} · RS4w {px(g.rs4w, 1)}</div>
              ))}
            </div>
            {d.sectorRotation.laggards && (
              <div>
                <span className="text-[var(--accent-bear)]">Laggards</span>
                {d.sectorRotation.laggards.map((g) => (
                  <div key={g.name}>{g.name} · RS4w {px(g.rs4w, 1)}</div>
                ))}
              </div>
            )}
          </div>
          <Link href="/rotate" className="text-[10px] text-[var(--accent-info)] mt-2 inline-block">
            Open ROTATE desk →
          </Link>
        </section>
      )}

      {d?.setups && d.setups.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-terminal text-[var(--text-secondary)]">ACTIONABLE SETUPS (PAPER)</h2>
          <p className="text-[10px] text-[var(--text-muted)] font-terminal">
            Status stays pending until price hits entry — derived from trend radar + ATR/swing rules in{" "}
            <code>pipeline/research_framework/config.yaml</code>.
          </p>
          <div className="overflow-x-auto border border-[var(--panel-border)] rounded-lg">
            <table className="w-full text-xs font-terminal">
              <thead className="bg-[var(--surface-alt)] text-[var(--text-muted)]">
                <tr>
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">Ticker</th>
                  <th className="text-left p-2">Theme</th>
                  <th className="text-right p-2">Score</th>
                  <th className="text-right p-2">Entry</th>
                  <th className="text-right p-2">Stop</th>
                  <th className="text-right p-2">Target</th>
                  <th className="text-right p-2">R:R</th>
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {d.setups.map((row) => (
                  <tr key={row.rank} className="border-t border-[var(--panel-border)] hover:bg-[var(--surface-alt)]">
                    <td className="p-2">{row.rank}</td>
                    <td className="p-2">
                      <Link href={`/ticker/${row.ticker}`} className="text-[var(--accent-info)]">
                        {row.ticker}
                      </Link>
                      <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[8rem]">{row.companyName}</div>
                    </td>
                    <td className="p-2 text-[var(--text-muted)]">{row.themeBucket ?? "—"}</td>
                    <td className="p-2 text-right" style={{ color: orbisScoreColor(row.orbisScore) }}>
                      {row.orbisScore ?? "—"}
                    </td>
                    <td className="p-2 text-right">{px(row.entry)}</td>
                    <td className="p-2 text-right text-[var(--accent-bear)]">{px(row.stop)}</td>
                    <td className="p-2 text-right text-[var(--accent-bull)]">{px(row.target)}</td>
                    <td className="p-2 text-right">{px(row.rr, 1)}</td>
                    <td className="p-2 uppercase text-[var(--accent-warning)]">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {d?.riskNotes && (
        <section className="text-[10px] text-[var(--text-muted)] font-terminal border-t border-[var(--panel-border)] pt-4">
          Risk: ~{String(d.riskNotes.riskPerTradePct ?? "1")}% per trade · max {String(d.riskNotes.maxConcurrent ?? "5")}{" "}
          concurrent · {String(d.riskNotes.trailingStopHint ?? "")}
        </section>
      )}
    </main>
  );
}
