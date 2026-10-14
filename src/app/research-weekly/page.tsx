"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Setup = {
  rank: number;
  ticker: string;
  companyName: string;
  theme: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  last: number | null;
  qualityRank: number | null;
  factorScore: number | null;
  rationale: string | null;
};

type Macro = {
  symbol?: string;
  headline?: string;
  close?: number;
  sma200?: number;
  above_sma200?: boolean;
  narrative?: string[];
};

type Data = {
  summary: { weekEnding: string; setupCount: number } | null;
  macro: Macro | null;
  sectors: unknown[];
  riskNotes: string[];
  setups: Setup[];
  headline: string | null;
  stale?: boolean;
};

const fmt = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

export default function ResearchWeeklyPage() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/research-weekly")
      .then(async (r) => {
        if (!r.ok) throw new Error("research-weekly");
        return r.json();
      })
      .then(setD)
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  const macro = d?.macro as Macro | null;

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 space-y-8">
      <header>
        <p className="text-xs font-terminal text-[var(--text-muted)] uppercase tracking-widest">Weekly research pack</p>
        <h1 className="text-2xl font-bold font-terminal mt-1" style={{ color: "var(--accent-info)" }}>
          RESEARCH WEEKLY
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-2 max-w-3xl">
          Money Machine–style workflow on ORBIS data: macro context, sector rotation, and up to five transparent setups
          (entry, stop, target). Paper research only — valid only if price reaches entry.
        </p>
        {d?.headline && <p className="mt-3 text-sm text-[var(--text-primary)] border-l-2 border-[var(--accent-info)] pl-3">{d.headline}</p>}
        {d?.stale && (
          <p className="mt-2 text-xs text-[var(--accent-warning)]">Data may be stale — run pipeline/research_framework weekly job.</p>
        )}
      </header>

      {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
      {!loading && !d?.summary && (
        <p className="text-sm text-[var(--text-muted)]">
          No pack yet. Run{" "}
          <code className="text-xs bg-[var(--surface-alt)] px-1 rounded">python -m pipeline.research_framework.jobs.weekly</code> after
          migrations.
        </p>
      )}

      {macro && (
        <section className="rounded border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2">
          <h2 className="text-sm font-terminal uppercase text-[var(--accent-info)]">Macro · {macro.symbol ?? "SPY"}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-[var(--text-muted)] text-xs block">Last</span>
              {fmt(macro.close)}
            </div>
            <div>
              <span className="text-[var(--text-muted)] text-xs block">SMA200</span>
              {fmt(macro.sma200)}
            </div>
            <div>
              <span className="text-[var(--text-muted)] text-xs block">Regime</span>
              {macro.above_sma200 ? "Above MA200" : "Below MA200"}
            </div>
            <div>
              <span className="text-[var(--text-muted)] text-xs block">Week ending</span>
              {d?.summary?.weekEnding ?? "—"}
            </div>
          </div>
          {(macro.narrative ?? []).map((line) => (
            <p key={line} className="text-sm text-[var(--text-secondary)]">
              {line}
            </p>
          ))}
        </section>
      )}

      {Array.isArray(d?.riskNotes) && d!.riskNotes.length > 0 && (
        <section className="rounded border border-[var(--border)] bg-[var(--surface-alt)] p-4">
          <h2 className="text-sm font-terminal uppercase mb-2">Risk &amp; process</h2>
          <ul className="list-disc pl-5 text-sm text-[var(--text-secondary)] space-y-1">
            {d!.riskNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-terminal uppercase text-[var(--accent-info)] mb-3">Setups ({d?.setups?.length ?? 0})</h2>
        <div className="space-y-4">
          {(d?.setups ?? []).map((s) => (
            <article
              key={s.rank}
              className="rounded border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-lg font-terminal font-bold">
                  <Link href={`/ticker/${s.ticker}`} className="hover:underline" style={{ color: "var(--accent-info)" }}>
                    {s.ticker}
                  </Link>
                </span>
                <span className="text-sm text-[var(--text-muted)]">{s.companyName}</span>
                {s.theme && <span className="text-xs px-2 py-0.5 rounded bg-[var(--badge-bg)]">{s.theme}</span>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-3 text-sm">
                <div>
                  <span className="text-xs text-[var(--text-muted)]">Entry</span>
                  <div className="font-mono">{fmt(s.entry)}</div>
                </div>
                <div>
                  <span className="text-xs text-[var(--text-muted)]">Stop</span>
                  <div className="font-mono text-[var(--accent-bear)]">{fmt(s.stop)}</div>
                </div>
                <div>
                  <span className="text-xs text-[var(--text-muted)]">Target</span>
                  <div className="font-mono text-[var(--accent-bull)]">{fmt(s.target)}</div>
                </div>
                <div>
                  <span className="text-xs text-[var(--text-muted)]">R:R</span>
                  <div>{fmt(s.rr, 1)}</div>
                </div>
                <div>
                  <span className="text-xs text-[var(--text-muted)]">Quality / factor</span>
                  <div>
                    {s.qualityRank ?? "—"} / {s.factorScore ?? "—"}
                  </div>
                </div>
              </div>
              {s.rationale && <p className="mt-3 text-sm text-[var(--text-secondary)]">{s.rationale}</p>}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
