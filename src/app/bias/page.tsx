"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TradingChart, type Candle, type ChartLevel } from "@/components/chart/TradingChart";

type Idea = { id: number; side: string; entry: number; target: number; stop: number; rr: number; kind: string; label: string };
type Level = { price: number; label: string; kind: string };
type Scenario = { dir: string; text: string };
type Name = {
  ticker: string;
  companyName: string;
  last: number | null;
  bias: string | null;
  confidence: string | null;
  vote: string | null;
  buyCount: number | null;
  sellCount: number | null;
  atr: number | null;
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  rangeLo: number | null;
  rangeHi: number | null;
  levels: Level[];
  ideas: Idea[];
  scenarios: Scenario[];
  rationale: string | null;
};

type Data = {
  summary: { names: number | null; longs: number | null; shorts: number | null; asOfDate: string | null } | null;
  names: Name[];
  headline: string | null;
};

const fmt = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

function biasColor(b: string | null) {
  if (b === "LONG") return "var(--accent-bull)";
  if (b === "SHORT") return "var(--accent-bear)";
  return "var(--text-muted)";
}

function ideaLevels(n: Name | null): ChartLevel[] {
  if (!n) return [];
  const out: ChartLevel[] = [];
  for (const lv of n.levels) {
    const dashed = lv.kind === "ma" || lv.kind === "pivot";
    const color = lv.kind === "or" ? "var(--accent-info)" : "var(--text-muted)";
    out.push({ price: lv.price, title: lv.label, color, dashed });
  }
  for (const idea of n.ideas) {
    const entryC = "var(--accent-warning)";
    const tgt = idea.side === "LONG" ? "var(--accent-bull)" : "var(--accent-bear)";
    const stp = idea.side === "LONG" ? "var(--accent-bear)" : "var(--accent-bull)";
    out.push({ price: idea.entry, title: `idea ${idea.id} ${idea.side} @ ${idea.entry}`, color: entryC });
    out.push({ price: idea.target, title: `idea ${idea.id} target ${idea.target}`, color: tgt });
    out.push({ price: idea.stop, title: `idea ${idea.id} stop ${idea.stop}`, color: stp });
  }
  return out;
}

export default function BiasPage() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [interval, setInterval] = useState<"1d" | "5m">("1d");
  const [chart, setChart] = useState<{ candles: Candle[]; sma20: (number | null)[]; source: string; interval: string } | null>(null);

  useEffect(() => {
    fetch("/api/bias")
      .then((r) => r.json())
      .then((x) => {
        setD(x);
        setSel((prev) => prev || x?.names?.[0]?.ticker || null);
      })
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  const name = d?.names.find((n) => n.ticker === sel) ?? d?.names[0] ?? null;

  useEffect(() => {
    if (!name?.ticker) return;
    setChart(null);
    fetch(`/api/chart/${name.ticker}?interval=${interval}`)
      .then((r) => r.json())
      .then(setChart)
      .catch(() => setChart(null));
  }, [name?.ticker, interval]);

  const levels = useMemo(() => ideaLevels(name), [name]);
  const s = d?.summary;

  return (
    <div className="px-4 py-6">
      <div className="mb-4">
        <h1 className="text-lg font-terminal font-bold tracking-wider" style={{ color: "var(--accent-info)" }}>
          DAILY BIAS
        </h1>
        <p className="text-xs text-[var(--text-secondary)]">
          TradingView-style tape, ANALYZE vote, classic pivots / ATR — paper ideas, not GEX or order flow
        </p>
      </div>

      {d?.headline && (
        <div className="px-4 py-2 mb-4 rounded border border-[var(--border)] bg-[var(--badge-bg)] text-sm text-[var(--text-secondary)] font-terminal">
          <span style={{ color: "var(--accent-info)" }}>B:</span> {d.headline}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: "NAMES", value: s?.names ?? "—" },
          { label: "LONG", value: s?.longs ?? "—", color: "var(--accent-bull)" },
          { label: "SHORT", value: s?.shorts ?? "—", color: "var(--accent-bear)" },
          { label: "RANGE", value: "0.75×ATR", color: "var(--accent-info)" },
        ].map((c) => (
          <div key={c.label} className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
            <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">{c.label}</div>
            <div className="text-lg font-terminal font-bold mt-1" style={{ color: c.color }}>{loading ? "…" : c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] max-h-[640px] overflow-y-auto">
          <table className="w-full text-sm font-terminal">
            <thead>
              <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
                <th className="text-left px-3 py-2">TICKER</th>
                <th className="text-left px-3 py-2">BIAS</th>
                <th className="text-right px-3 py-2">LAST</th>
                <th className="text-right px-3 py-2">IDEAS</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
              ) : !d?.names?.length ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-[var(--text-muted)]">No snapshot. Run: python -m pipeline.compute.daily_bias</td></tr>
              ) : (
                d.names.map((n) => (
                  <tr
                    key={n.ticker}
                    onClick={() => setSel(n.ticker)}
                    className="border-b border-[var(--border)] cursor-pointer hover:bg-[var(--surface-alt)]"
                    style={{ background: sel === n.ticker ? "var(--badge-bg)" : undefined }}
                  >
                    <td className="px-3 py-2 font-bold">{n.ticker}</td>
                    <td className="px-3 py-2 font-bold" style={{ color: biasColor(n.bias) }}>
                      {n.bias} <span className="text-[10px] text-[var(--text-muted)]">{n.confidence}</span>
                    </td>
                    <td className="px-3 py-2 text-right">{fmt(n.last)}</td>
                    <td className="px-3 py-2 text-right">{n.ideas.length}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="lg:col-span-2 space-y-3">
          {name && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <Link href={`/ticker/${name.ticker}`} className="text-lg font-terminal font-bold hover:text-[var(--accent-info)]">
                    {name.ticker}
                  </Link>
                  <span className="ml-2 text-xs text-[var(--text-secondary)]">{name.companyName}</span>
                  <div className="text-sm font-terminal mt-1" style={{ color: biasColor(name.bias) }}>
                    Bias: {name.bias} · Confidence: {name.confidence} · last {fmt(name.last)}
                  </div>
                </div>
                <div className="flex gap-1">
                  {(["1d", "5m"] as const).map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setInterval(tf)}
                      className={`px-2 py-1 text-[10px] font-terminal rounded border ${
                        interval === tf
                          ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                          : "border-[var(--border)] text-[var(--text-muted)]"
                      }`}
                    >
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] overflow-hidden">
                <div className="px-3 py-1 text-[10px] font-terminal text-[var(--text-muted)] tracking-widest border-b border-[var(--border)]">
                  {name.ticker} · Daily Bias · {chart?.interval ?? interval} · {chart?.source ?? "…"}
                </div>
                <TradingChart candles={chart?.candles ?? []} sma={chart?.sma20} levels={levels} />
              </div>

              <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3">
                <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">TRADE IDEAS</h2>
                {name.ideas.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] font-terminal">No idea cleared the 1.2R / 2×ATR proximity filter.</p>
                ) : (
                  <ul className="space-y-1 text-sm font-terminal">
                    {name.ideas.map((i) => (
                      <li key={i.id} style={{ color: i.side === "LONG" ? "var(--accent-bull)" : "var(--accent-bear)" }}>
                        {i.label} <span className="text-[var(--text-muted)]">({i.kind} · {i.rr.toFixed(1)}R)</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs font-terminal text-[var(--text-secondary)] mt-3">
                  Expected range {fmt(name.rangeLo)} – {fmt(name.rangeHi)}
                </p>
                <ul className="text-xs font-terminal text-[var(--text-secondary)] mt-1 space-y-0.5">
                  {name.scenarios.map((sc) => (
                    <li key={sc.text}>{sc.dir === "up" ? "↑" : "↓"} {sc.text}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3">
                <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">RATIONALE</h2>
                <p className="text-xs font-terminal text-[var(--text-secondary)] leading-relaxed">{name.rationale}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
