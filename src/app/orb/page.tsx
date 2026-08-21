"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Bar = { t: string; o: number; h: number; l: number; c: number; tag: string };

type WatchRow = {
  ticker: string;
  companyName: string;
  gapPct: number | null;
  prevClose: number | null;
  open: number | null;
  orHigh: number | null;
  orLow: number | null;
  orRange: number | null;
  status: string;
  entry: number | null;
  stop: number | null;
  takeProfit: number | null;
  shares: number | null;
  breakoutAt: string | null;
  last: number | null;
  rMultiple: number | null;
  bars: Bar[];
};

type OrderRow = {
  id: string;
  ticker: string;
  action: string;
  type: string;
  shares: number;
  limitPrice: number | null;
  stopPrice: number | null;
  takeProfit: number | null;
  reason: string | null;
};

type OrbData = {
  summary: {
    names: number | null;
    breakouts: number | null;
    asOfDate: string | null;
    sessionDate: string | null;
    runId: string;
    lastRunAt: string | null;
  } | null;
  watch: WatchRow[];
  orders: OrderRow[];
  headline: string | null;
  stale: boolean;
};

const px = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));
const pct = (v: number | null | undefined) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

function statusColor(s: string) {
  if (s === "BREAKOUT") return "var(--accent-bull)";
  if (s === "NO_BREAK") return "var(--accent-warning)";
  if (s === "WATCH") return "var(--accent-info)";
  return "var(--text-muted)";
}

function RangeTape({ row }: { row: WatchRow }) {
  if (row.orHigh == null || row.orLow == null) {
    return <div className="text-[10px] text-[var(--text-muted)] font-terminal">no 5m OR bars</div>;
  }
  const lo = row.orLow;
  const hi = row.orHigh;
  const last = row.last ?? hi;
  const pad = (hi - lo) * 0.35 || 1;
  const min = Math.min(lo, last, row.stop ?? lo) - pad;
  const max = Math.max(hi, last, row.takeProfit ?? hi) + pad;
  const span = max - min || 1;
  const x = (v: number) => `${((v - min) / span) * 100}%`;
  return (
    <div className="relative h-6 rounded bg-[var(--surface-alt)] overflow-hidden">
      <div
        className="absolute top-0 bottom-0"
        style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})`, background: "var(--badge-bg)", borderLeft: "1px solid var(--accent-info)", borderRight: "1px solid var(--accent-info)" }}
      />
      {row.stop != null && <div className="absolute top-0 bottom-0 w-0.5" style={{ left: x(row.stop), background: "var(--accent-bear)" }} />}
      {row.takeProfit != null && <div className="absolute top-0 bottom-0 w-0.5" style={{ left: x(row.takeProfit), background: "var(--accent-bull)" }} />}
      <div className="absolute top-1 bottom-1 w-1 rounded" style={{ left: x(last), background: "var(--text-primary)" }} />
    </div>
  );
}

export default function OrbPage() {
  const [d, setD] = useState<OrbData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string>("");

  useEffect(() => {
    fetch("/api/orb")
      .then((r) => r.json())
      .then((data: OrbData) => {
        setD(data);
        if (data.watch?.[0]) setSel(data.watch[0].ticker);
      })
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  const s = d?.summary;
  const row = d?.watch.find((w) => w.ticker === sel) ?? d?.watch[0] ?? null;
  const cards = [
    { label: "SESSION", value: s?.sessionDate ?? "—", color: d?.stale ? "var(--accent-warning)" : "" },
    { label: "GAPPERS", value: s?.names ?? "—", color: "var(--accent-info)" },
    { label: "ORB LONGS", value: s?.breakouts ?? "—", color: "var(--accent-bull)" },
    { label: "GAP FILTER", value: "≥ 4%", color: "" },
    { label: "OR WINDOW", value: "09:30–09:45 ET", color: "" },
  ];

  return (
    <div className="px-4 py-6">
      <div className="mb-4">
        <h1 className="text-lg font-terminal font-bold tracking-wider" style={{ color: "var(--accent-warning)" }}>
          OPENING RANGE BREAKOUT
        </h1>
        <p className="text-xs text-[var(--text-secondary)]">
          Premarket/open gappers · 15-minute OR · long-only 1R bracket (paper)
        </p>
      </div>

      {d?.headline && (
        <div className="px-4 py-2 mb-4 rounded border border-[var(--border)] bg-[var(--badge-bg)] text-sm text-[var(--text-secondary)] font-terminal">
          <span style={{ color: "var(--accent-warning)" }}>ORB:</span> {d.headline}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {cards.map((c) => (
          <div key={c.label} className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
            <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">{c.label}</div>
            <div className="text-lg font-terminal font-bold mt-1" style={{ color: c.color || undefined }}>
              {loading ? "…" : c.value}
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">GAPPER WATCH · ORB STRATEGY</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-right px-3 py-2">GAP</th>
              <th className="text-right px-3 py-2">OPEN</th>
              <th className="text-right px-3 py-2">OR LO / HI</th>
              <th className="text-left px-3 py-2">RANGE</th>
              <th className="text-left px-3 py-2">STATUS</th>
              <th className="text-right px-3 py-2">ENTRY</th>
              <th className="text-right px-3 py-2">STOP / TP</th>
              <th className="text-right px-3 py-2">R</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.watch?.length ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-[var(--text-muted)]">No ≥4% gappers this session. Run: python -m pipeline.compute.opening_range</td></tr>
            ) : (
              d.watch.map((r) => (
                <tr
                  key={r.ticker}
                  className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)] cursor-pointer"
                  onClick={() => setSel(r.ticker)}
                >
                  <td className="px-3 py-2">
                    <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]" onClick={(e) => e.stopPropagation()}>{r.ticker}</Link>
                  </td>
                  <td className="px-3 py-2 text-right font-bold" style={{ color: (r.gapPct ?? 0) >= 0 ? "var(--accent-bull)" : "var(--accent-bear)" }}>{pct(r.gapPct)}</td>
                  <td className="px-3 py-2 text-right">{px(r.open)}</td>
                  <td className="px-3 py-2 text-right">{px(r.orLow)} / {px(r.orHigh)}</td>
                  <td className="px-3 py-2 min-w-[140px]"><RangeTape row={r} /></td>
                  <td className="px-3 py-2 font-bold" style={{ color: statusColor(r.status) }}>{r.status}</td>
                  <td className="px-3 py-2 text-right">{px(r.entry)}</td>
                  <td className="px-3 py-2 text-right text-xs">{px(r.stop)} · {px(r.takeProfit)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: (r.rMultiple ?? 0) >= 0 ? "var(--accent-bull)" : "var(--accent-bear)" }}>
                    {r.rMultiple == null ? "—" : r.rMultiple.toFixed(2)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {row && (
        <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3 mb-6 font-terminal text-xs">
          <div className="text-[10px] text-[var(--text-muted)] tracking-widest mb-2">
            {row.ticker} · 5m TAPE · OR then AFTER
          </div>
          <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
            {(row.bars ?? []).map((b, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded border border-[var(--border)]"
                style={{ color: b.tag === "OR" ? "var(--accent-info)" : b.c > (row.orHigh ?? 0) ? "var(--accent-bull)" : "var(--text-secondary)" }}
                title={b.t}
              >
                {b.c.toFixed(2)}
              </span>
            ))}
            {!row.bars?.length && <span className="text-[var(--text-muted)]">No intraday bars stored.</span>}
          </div>
        </div>
      )}

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">PAPER BRACKET ORDERS</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-4">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">ACTION</th>
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-right px-3 py-2">SHARES</th>
              <th className="text-right px-3 py-2">LIMIT</th>
              <th className="text-right px-3 py-2">STOP 1R</th>
              <th className="text-right px-3 py-2">TARGET 1R</th>
              <th className="text-left px-3 py-2">REASON</th>
            </tr>
          </thead>
          <tbody>
            {!d?.orders?.length ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-[var(--text-muted)]">No breakout fills this session.</td></tr>
            ) : (
              d.orders.map((o) => (
                <tr key={o.id} className="border-b border-[var(--border)]">
                  <td className="px-3 py-2 font-bold" style={{ color: "var(--accent-bull)" }}>{o.action}</td>
                  <td className="px-3 py-2 font-bold"><Link href={`/ticker/${o.ticker}`} className="hover:text-[var(--accent-info)]">{o.ticker}</Link></td>
                  <td className="px-3 py-2 text-right">{o.shares}</td>
                  <td className="px-3 py-2 text-right">{px(o.limitPrice)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--accent-bear)" }}>{px(o.stopPrice)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--accent-bull)" }}>{px(o.takeProfit)}</td>
                  <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{o.reason}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-3">
        Rules: |open/prev close| ≥ 4% → 09:30–09:45 ET range → buy first 5m close above OR high.
        Stop = entry − OR, target = entry + OR. Size = 5% of $100k paper equity. Long only. Not investment advice. No live broker.
      </p>
    </div>
  );
}
