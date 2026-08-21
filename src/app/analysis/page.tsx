"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Spark = { close: number[]; sma50: (number | null)[]; ema20: (number | null)[] };

type Name = {
  ticker: string;
  companyName: string;
  last: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  macd: number | null;
  rsi: number | null;
  lrM: number | null;
  lrCode: number | null;
  lrDesc: string | null;
  mavgLongCode: number | null;
  mavgLongDesc: string | null;
  mavgMidCode: number | null;
  mavgMidDesc: string | null;
  dtCode: number | null;
  dtDesc: string | null;
  macdCode: number | null;
  macdDesc: string | null;
  rsiCode: number | null;
  rsiDesc: string | null;
  vote: string | null;
  buyCount: number | null;
  sellCount: number | null;
  holdCount: number | null;
  compositeScore: number | null;
  fScore: number | null;
  pe: number | null;
  spark: Spark | null;
};

type AnalysisData = {
  summary: {
    names: number | null;
    buys: number | null;
    sells: number | null;
    asOfDate: string | null;
    runId: string;
    lastRunAt: string | null;
  } | null;
  names: Name[];
  headline: string | null;
  stale: boolean;
};

const px = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));
const codeColor = (c: number | null | undefined) =>
  c === 2 ? "var(--accent-bull)" : c === 1 ? "var(--accent-bear)" : "var(--accent-warning)";
const codeLabel = (c: number | null | undefined) => (c === 2 ? "BUY" : c === 1 ? "SELL" : "HOLD");
const voteColor = (v: string | null | undefined) =>
  v === "BUY" ? "var(--accent-bull)" : v === "SELL" ? "var(--accent-bear)" : "var(--accent-warning)";

function Sparkline({ spark }: { spark: Spark | null }) {
  const close = spark?.close ?? [];
  if (close.length < 2) return <div className="h-24 text-[var(--text-muted)] text-xs font-terminal">No series</div>;
  const w = 520, h = 120, pad = 8;
  const sma = spark?.sma50 ?? [];
  const ema = spark?.ema20 ?? [];
  const nums = close.concat(sma.filter((x): x is number => x != null), ema.filter((x): x is number => x != null));
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const ys = hi - lo || 1;
  const path = (arr: (number | null)[]) =>
    arr
      .map((v, i) => {
        if (v == null) return null;
        const x = pad + (i / (close.length - 1)) * (w - pad * 2);
        const y = h - pad - ((v - lo) / ys) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-28">
      <polyline points={path(close)} fill="none" stroke="var(--accent-info)" strokeWidth="1.6" />
      <polyline points={path(sma)} fill="none" stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3 3" />
      <polyline points={path(ema)} fill="none" stroke="var(--accent-warning)" strokeWidth="1" />
    </svg>
  );
}

export default function AnalysisPage() {
  const [d, setD] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [ticker, setTicker] = useState("");

  useEffect(() => {
    fetch("/api/analysis")
      .then((r) => r.json())
      .then((data: AnalysisData) => {
        setD(data);
        const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("ticker") : null;
        const pick = (q && data.names?.find((n) => n.ticker === q.toUpperCase())?.ticker) || data.names?.[0]?.ticker;
        if (pick) setTicker(pick);
      })
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  const name = d?.names.find((n) => n.ticker === ticker) ?? d?.names[0] ?? null;
  const s = d?.summary;
  const cards = [
    { label: "NAMES", value: s?.names ?? "—", color: "" },
    { label: "BUY VOTES", value: s?.buys ?? "—", color: "var(--accent-bull)" },
    { label: "SELL VOTES", value: s?.sells ?? "—", color: "var(--accent-bear)" },
    { label: "AS OF", value: s?.asOfDate ?? "—", color: d?.stale ? "var(--accent-warning)" : "" },
  ];

  const signals = useMemo(() => {
    if (!name) return [];
    return [
      { k: "REGRESSION", code: name.lrCode, desc: name.lrDesc, extra: name.lrM == null ? "" : `m=${name.lrM.toFixed(4)}` },
      { k: "MA LONG", code: name.mavgLongCode, desc: name.mavgLongDesc, extra: "" },
      { k: "MA MID", code: name.mavgMidCode, desc: name.mavgMidDesc, extra: "" },
      { k: "P/V TREE", code: name.dtCode, desc: name.dtDesc, extra: "" },
      { k: "MACD", code: name.macdCode, desc: name.macdDesc, extra: px(name.macd, 3) },
      { k: "RSI", code: name.rsiCode, desc: name.rsiDesc, extra: px(name.rsi, 1) },
    ];
  }, [name]);

  return (
    <div className="px-4 py-6">
      <div className="mb-4">
        <h1 className="text-lg font-terminal font-bold tracking-wider" style={{ color: "var(--accent-info)" }}>
          STOCK ANALYSIS
        </h1>
        <p className="text-xs text-[var(--text-secondary)]">
          Technical (MA / MACD / RSI / regression) + fundamental overlay (composite, F-Score)
        </p>
      </div>

      {d?.headline && (
        <div className="px-4 py-2 mb-4 rounded border border-[var(--border)] bg-[var(--badge-bg)] text-sm text-[var(--text-secondary)] font-terminal">
          <span style={{ color: "var(--accent-info)" }}>ANALYZE:</span> {d.headline}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {cards.map((c) => (
          <div key={c.label} className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
            <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">{c.label}</div>
            <div className="text-lg font-terminal font-bold mt-1" style={{ color: c.color || undefined }}>
              {loading ? "…" : c.value}
            </div>
          </div>
        ))}
      </div>

      {name && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest">
                {name.ticker} · PRICE / SMA50 / EMA20
              </h2>
              <span className="text-sm font-terminal font-bold" style={{ color: voteColor(name.vote) }}>{name.vote}</span>
            </div>
            <Sparkline spark={name.spark} />
            <div className="flex gap-3 text-[10px] font-terminal text-[var(--text-muted)] mt-1">
              <span style={{ color: "var(--accent-info)" }}>CLOSE</span>
              <span>SMA50</span>
              <span style={{ color: "var(--accent-warning)" }}>EMA20</span>
            </div>
            <div className="grid grid-cols-4 gap-2 mt-3">
              {[
                ["LAST", px(name.last)],
                ["SMA50", px(name.sma50)],
                ["SMA200", px(name.sma200)],
                ["EMA50", px(name.ema50)],
                ["RSI", px(name.rsi, 1)],
                ["MACD", px(name.macd, 3)],
                ["COMPOSITE", name.compositeScore == null ? "—" : String(Math.round(name.compositeScore))],
                ["F-SCORE", name.fScore == null ? "—" : String(name.fScore)],
              ].map(([l, v]) => (
                <div key={l} className="p-2 rounded border border-[var(--border)]">
                  <div className="text-[9px] font-terminal text-[var(--text-muted)]">{l}</div>
                  <div className="text-xs font-terminal font-bold">{v}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3">
            <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">SIGNAL STACK · 6 VOTES</h2>
            <table className="w-full text-sm font-terminal">
              <tbody>
                {signals.map((x) => (
                  <tr key={x.k} className="border-b border-[var(--border)]">
                    <td className="px-2 py-2 text-[10px] text-[var(--text-muted)] tracking-widest">{x.k}</td>
                    <td className="px-2 py-2 font-bold" style={{ color: codeColor(x.code) }}>{codeLabel(x.code)}</td>
                    <td className="px-2 py-2 text-xs text-[var(--text-secondary)]">{x.desc}</td>
                    <td className="px-2 py-2 text-right text-xs text-[var(--text-muted)]">{x.extra}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-3">
              Vote = majority of the six technical signals (min 2). Fundamentals (composite, F-Score, P/E {px(name.pe)}) sit beside the tape — they do not override the vote.
            </p>
          </div>
        </div>
      )}

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">UNIVERSE · TECH + FUND</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-4">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">VOTE</th>
              <th className="text-right px-3 py-2">B/S/H</th>
              <th className="text-right px-3 py-2">LAST</th>
              <th className="text-right px-3 py-2">RSI</th>
              <th className="text-right px-3 py-2">MACD</th>
              <th className="text-left px-3 py-2">MA LONG</th>
              <th className="text-right px-3 py-2">COMP</th>
              <th className="text-right px-3 py-2">F</th>
              <th className="text-right px-3 py-2">P/E</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.names?.length ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-[var(--text-muted)]">No analysis snapshot. Run: python -m pipeline.compute.stock_analysis</td></tr>
            ) : (
              d.names.map((r) => (
                <tr
                  key={r.ticker}
                  className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)] cursor-pointer"
                  onClick={() => setTicker(r.ticker)}
                >
                  <td className="px-3 py-2">
                    <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]" onClick={(e) => e.stopPropagation()}>{r.ticker}</Link>
                  </td>
                  <td className="px-3 py-2 font-bold" style={{ color: voteColor(r.vote) }}>{r.vote}</td>
                  <td className="px-3 py-2 text-right text-xs">{r.buyCount}/{r.sellCount}/{r.holdCount}</td>
                  <td className="px-3 py-2 text-right">{px(r.last)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: codeColor(r.rsiCode) }}>{px(r.rsi, 1)}</td>
                  <td className="px-3 py-2 text-right">{px(r.macd, 3)}</td>
                  <td className="px-3 py-2 text-xs" style={{ color: codeColor(r.mavgLongCode) }}>{r.mavgLongDesc}</td>
                  <td className="px-3 py-2 text-right">{r.compositeScore == null ? "—" : Math.round(r.compositeScore)}</td>
                  <td className="px-3 py-2 text-right">{r.fScore ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{px(r.pe, 1)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-3">
        Technical stack from MorcilloSanz/stockanalysis on daily bars. Fundamentals from the existing KovaView snapshot.
        Heuristic signals — not investment advice.
      </p>
    </div>
  );
}
