"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type BookRow = {
  ticker: string;
  companyName: string;
  side: string;
  shares: number;
  entry: number;
  last: number | null;
  stop: number | null;
  n: number | null;
  riskUsd: number | null;
  sector: string;
  reason: string;
  rank: number | null;
  breakout: boolean | null;
  green: boolean | null;
  unrealizedPnlUsd: number | null;
  daysHeld: number | null;
  openedAt: string | null;
  priceAsOfDate: string | null;
};

type OrderRow = {
  id: string;
  ticker: string;
  action: string;
  shares: number;
  type: string;
  limitPrice: number | null;
  reason: string | null;
  sector: string | null;
  riskUsd: number | null;
  createdAt: string | null;
};

type SectorExp = { sector: string; exposurePct: number; capPct: number; utilizationPct: number; names: number };
type Skipped = { ticker: string; sector: string; rank: number | null; reason: string; detail: string };
type LogEntry = { at: string; level: string; message: string };

type JournalRow = {
  id: string;
  ticker: string;
  side: string;
  shares: number;
  entry: number;
  exit: number;
  pnlUsd: number;
  returnPct: number | null;
  sector: string | null;
  entryReason: string | null;
  exitReason: string | null;
  enteredAt: string | null;
  exitedAt: string | null;
};

type LoopData = {
  summary: {
    equity: number;
    deployedPct: number | null;
    openRiskPct: number | null;
    names: number | null;
    lastLoopRunAt: string | null;
    asOfDate: string | null;
    runId: string;
    status: string | null;
    posture: number | null;
  } | null;
  book: BookRow[];
  orders: OrderRow[];
  harness: { sectorExposure: SectorExp[]; skipped: Skipped[]; config: Record<string, number> | null };
  log: LogEntry[];
  headline: string | null;
  stale: boolean;
  priceAsOfDate?: string | null;
  priceStaleDays?: number | null;
  loopRunStaleDays?: number | null;
  journal?: JournalRow[];
  journalSummary?: { closedTrades: number; realizedPnlUsd: number; winRatePct: number | null };
  strategy?: {
    donchianVwap?: {
      asOf: string | null;
      knownOn: string | null;
      entryCandidates: { symbol: string; score: number; reason: string }[];
      exitHints: { symbol: string; reason: string }[];
    };
  };
};

const usd = (v: number | null | undefined, d = 2) =>
  v == null ? "—" : v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: d });
const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const px = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));

export default function LoopPage() {
  const [d, setD] = useState<LoopData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/loop")
      .then((r) => r.json())
      .then(setD)
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  const s = d?.summary;
  const cfg = d?.harness?.config;
  const cards = [
    { label: "EQUITY", value: s ? usd(s.equity, 0) : "—", color: "" },
    { label: "DEPLOYED", value: s ? pct(s.deployedPct) : "—", color: "var(--accent-info)" },
    { label: "OPEN RISK", value: s ? pct(s.openRiskPct) : "—", color: (s?.openRiskPct ?? 0) > 0.064 ? "var(--accent-warning)" : "var(--accent-bull)" },
    { label: "NAMES", value: s ? `${s.names ?? 0} / ${cfg?.maxNames ?? 8}` : "—", color: "" },
    { label: "LAST LOOP", value: s?.asOfDate ?? "—", color: d?.stale ? "var(--accent-warning)" : "" },
    { label: "PX AS OF", value: d?.priceAsOfDate ?? "—", color: (d?.priceStaleDays ?? 0) > 1 ? "var(--accent-warning)" : "" },
  ];

  return (
    <div className="px-4 py-6">
      <div className="mb-4">
        <h1 className="text-lg font-terminal font-bold tracking-wider" style={{ color: "var(--accent-warning)" }}>
          LOOP TERMINAL
        </h1>
        <p className="text-xs text-[var(--text-secondary)]">
          Donchian 55 + 20d VWAP · exit ATR(14)×2 trail · equal-weight · paper only
        </p>
      </div>

      {d?.headline && (
        <div className="px-4 py-2 mb-4 rounded border border-[var(--border)] bg-[var(--badge-bg)] text-sm text-[var(--text-secondary)] font-terminal">
          <span style={{ color: "var(--accent-warning)" }}>LOOP:</span> {d.headline}
          {s?.posture != null && <span className="ml-3 text-[var(--text-muted)]">posture {s.posture}</span>}
        </div>
      )}

      {(d?.loopRunStaleDays ?? 0) > 1 && (
        <div className="px-4 py-2 mb-4 rounded border border-[var(--accent-warning)] bg-[var(--badge-bg)] text-xs font-terminal text-[var(--text-secondary)]">
          Loop engine last ran on <strong>{s?.asOfDate}</strong>
          {(d?.loopRunStaleDays ?? 0) > 0 && <> ({d?.loopRunStaleDays} calendar days ago)</>}.
          LAST / P&amp;L below are marked from <strong>{d?.priceAsOfDate ?? "prices_daily"}</strong> EOD bars when the nightly job has not refreshed the book.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
        {cards.map((c) => (
          <div key={c.label} className="p-3 rounded border border-[var(--border)] bg-[var(--card-bg)] text-center">
            <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">{c.label}</div>
            <div className="text-lg font-terminal font-bold mt-1" style={{ color: c.color || undefined }}>
              {loading ? "…" : c.value}
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">OPEN BOOK</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">SIDE</th>
              <th className="text-right px-3 py-2">SHARES</th>
              <th className="text-left px-3 py-2">OPENED</th>
              <th className="text-right px-3 py-2">DAYS</th>
              <th className="text-right px-3 py-2">ENTRY</th>
              <th className="text-right px-3 py-2">LAST</th>
              <th className="text-right px-3 py-2">ATR STOP</th>
              <th className="text-right px-3 py-2">STR</th>
              <th className="text-right px-3 py-2">—</th>
              <th className="text-right px-3 py-2">P&amp;L</th>
              <th className="text-left px-3 py-2">REASON</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.book?.length ? (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-[var(--text-muted)] text-xs leading-relaxed">
                  {d?.summary ? (
                    <>
                      No open positions. Loop ran on <strong>{d.summary.asOfDate}</strong>
                      {d.headline ? <> ({d.headline})</> : null}.
                      <br />
                      No names in the rebalance basket — prior bar must close above the 55-day Donchian upper band and 20-day VWAP (posture ≥ 50).
                    </>
                  ) : (
                    <>No loop run yet. Run: python -m pipeline.compute.portfolio_loop</>
                  )}
                </td>
              </tr>
            ) : (
              d.book.map((r) => {
                const pnlColor = (r.unrealizedPnlUsd ?? 0) >= 0 ? "var(--accent-bull)" : "var(--accent-bear)";
                return (
                  <tr key={r.ticker} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                    <td className="px-3 py-2">
                      <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]">{r.ticker}</Link>
                      <span className="text-[var(--text-muted)] ml-2 text-xs hidden lg:inline">{r.companyName}</span>
                    </td>
                    <td className="px-3 py-2 font-bold" style={{ color: "var(--accent-bull)" }}>{r.side}</td>
                    <td className="px-3 py-2 text-right">{r.shares}</td>
                    <td className="px-3 py-2 text-left text-xs">{r.openedAt ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{r.daysHeld ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{px(r.entry)}</td>
                    <td className="px-3 py-2 text-right" title={r.priceAsOfDate ? `EOD ${r.priceAsOfDate}` : undefined}>
                      {px(r.last)}
                    </td>
                    <td className="px-3 py-2 text-right" style={{ color: "var(--accent-bear)" }}>{px(r.stop)}</td>
                    <td className="px-3 py-2 text-right">{r.rank ?? "—"}</td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right font-bold" style={{ color: pnlColor }}>{usd(r.unrealizedPnlUsd, 0)}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.breakout && <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--badge-bg)] text-[var(--accent-warning)] mr-1">DC55</span>}
                      {r.green && <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--badge-bg)] text-[var(--accent-bull)] mr-1">VWAP</span>}
                      <span className="text-[var(--text-secondary)]">{r.reason}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">SECTOR HARNESS</h2>
          <div className="rounded border border-[var(--border)] overflow-hidden">
            <table className="w-full text-sm font-terminal">
              <thead>
                <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
                  <th className="text-left px-3 py-2">SECTOR</th>
                  <th className="text-right px-3 py-2">EXP</th>
                  <th className="text-right px-3 py-2">UTIL</th>
                  <th className="text-right px-3 py-2">N</th>
                </tr>
              </thead>
              <tbody>
                {(d?.harness?.sectorExposure ?? []).map((x) => (
                  <tr key={x.sector} className="border-b border-[var(--border)]">
                    <td className="px-3 py-2">{x.sector}</td>
                    <td className="px-3 py-2 text-right">{pct(x.exposurePct)}</td>
                    <td className="px-3 py-2 text-right" style={{ color: x.utilizationPct >= 1 ? "var(--accent-warning)" : undefined }}>{pct(x.utilizationPct)}</td>
                    <td className="px-3 py-2 text-right">{x.names}</td>
                  </tr>
                ))}
                {!d?.harness?.sectorExposure?.length && (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-[var(--text-muted)]">—</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">
            DONCHIAN ENTRY CANDIDATES
            {d?.strategy?.donchianVwap?.asOf ? (
              <span className="ml-2 text-[var(--text-muted)]">as of {d.strategy.donchianVwap.asOf}</span>
            ) : null}
          </h2>
          <div className="rounded border border-[var(--border)] overflow-hidden max-h-40 overflow-y-auto mb-4">
            <table className="w-full text-sm font-terminal">
              <thead>
                <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
                  <th className="text-left px-3 py-2">TICKER</th>
                  <th className="text-right px-3 py-2">SCORE</th>
                  <th className="text-left px-3 py-2">REASON</th>
                </tr>
              </thead>
              <tbody>
                {(d?.strategy?.donchianVwap?.entryCandidates ?? []).slice(0, 12).map((x) => (
                  <tr key={x.symbol} className="border-b border-[var(--border)]">
                    <td className="px-3 py-2 font-bold">{x.symbol}</td>
                    <td className="px-3 py-2 text-right">{x.score.toFixed(2)}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{x.reason}</td>
                  </tr>
                ))}
                {!d?.strategy?.donchianVwap?.entryCandidates?.length && (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-[var(--text-muted)]">
                      No published candidates (run strategy bus nightly)
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">SKIPPED THIS LOOP</h2>
          <div className="rounded border border-[var(--border)] overflow-hidden max-h-56 overflow-y-auto">
            <table className="w-full text-sm font-terminal">
              <thead>
                <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
                  <th className="text-left px-3 py-2">TICKER</th>
                  <th className="text-left px-3 py-2">REASON</th>
                  <th className="text-left px-3 py-2">DETAIL</th>
                </tr>
              </thead>
              <tbody>
                {(d?.harness?.skipped ?? []).slice(0, 20).map((x, i) => (
                  <tr key={`${x.ticker}-${i}`} className="border-b border-[var(--border)]">
                    <td className="px-3 py-2 font-bold">{x.ticker}</td>
                    <td className="px-3 py-2 text-xs text-[var(--accent-warning)]">{x.reason}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)] truncate max-w-[220px]">{x.detail}</td>
                  </tr>
                ))}
                {!d?.harness?.skipped?.length && (
                  <tr><td colSpan={3} className="px-3 py-4 text-center text-[var(--text-muted)]">No skips</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
        <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest">TRADING JOURNAL</h2>
        {d?.journalSummary && d.journalSummary.closedTrades > 0 && (
          <p className="text-[10px] font-terminal text-[var(--text-muted)]">
            {d.journalSummary.closedTrades} closed · realized {usd(d.journalSummary.realizedPnlUsd, 0)}
            {d.journalSummary.winRatePct != null && (
              <> · win {d.journalSummary.winRatePct.toFixed(0)}%</>
            )}
          </p>
        )}
      </div>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">EXIT</th>
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-right px-3 py-2">SHARES</th>
              <th className="text-right px-3 py-2">ENTRY</th>
              <th className="text-right px-3 py-2">EXIT PX</th>
              <th className="text-right px-3 py-2">P&amp;L</th>
              <th className="text-right px-3 py-2">RET</th>
              <th className="text-left px-3 py-2">EXIT REASON</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.journal?.length ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)] text-xs leading-relaxed">
                  No closed LOOP trades yet. Exits are recorded here when the nightly harness sells (ATR trail or rebalance).
                </td>
              </tr>
            ) : (
              d.journal.map((j) => {
                const pnlColor = (j.pnlUsd ?? 0) >= 0 ? "var(--accent-bull)" : "var(--accent-bear)";
                return (
                  <tr key={j.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{j.exitedAt ?? "—"}</td>
                    <td className="px-3 py-2 font-bold">
                      <Link href={`/ticker/${j.ticker}`} className="hover:text-[var(--accent-info)]">{j.ticker}</Link>
                    </td>
                    <td className="px-3 py-2 text-right">{j.shares}</td>
                    <td className="px-3 py-2 text-right">{px(j.entry)}</td>
                    <td className="px-3 py-2 text-right">{px(j.exit)}</td>
                    <td className="px-3 py-2 text-right font-bold" style={{ color: pnlColor }}>{usd(j.pnlUsd, 0)}</td>
                    <td className="px-3 py-2 text-right" style={{ color: pnlColor }}>
                      {j.returnPct == null ? "—" : `${j.returnPct >= 0 ? "+" : ""}${j.returnPct.toFixed(1)}%`}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--text-secondary)] truncate max-w-[280px]" title={j.exitReason ?? undefined}>
                      {j.exitReason ?? "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">LAST LOOP ORDERS</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">DATE</th>
              <th className="text-left px-3 py-2">ACTION</th>
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">TYPE</th>
              <th className="text-right px-3 py-2">SHARES</th>
              <th className="text-right px-3 py-2">LIMIT</th>
              <th className="text-right px-3 py-2">RISK $</th>
              <th className="text-left px-3 py-2">REASON</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.orders?.length ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">No orders this run — book unchanged.</td></tr>
            ) : (
              d.orders.map((o) => (
                <tr key={o.id} className="border-b border-[var(--border)]">
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{o.createdAt ?? s?.asOfDate ?? "—"}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: o.action === "BUY" ? "var(--accent-bull)" : "var(--accent-bear)" }}>{o.action}</td>
                  <td className="px-3 py-2 font-bold">
                    <Link href={`/ticker/${o.ticker}`} className="hover:text-[var(--accent-info)]">{o.ticker}</Link>
                  </td>
                  <td className="px-3 py-2 text-xs">{o.type}</td>
                  <td className="px-3 py-2 text-right">{o.shares}</td>
                  <td className="px-3 py-2 text-right">{o.limitPrice == null ? "MKT" : px(o.limitPrice)}</td>
                  <td className="px-3 py-2 text-right">{usd(o.riskUsd, 0)}</td>
                  <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{o.reason}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">LOOP LOG</h2>
      <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3 font-terminal text-xs max-h-48 overflow-y-auto">
        {(d?.log ?? []).map((l, i) => (
          <div key={i} className="py-0.5" style={{
            color: l.level === "ORDER" ? "var(--accent-info)" : l.level === "SKIP" ? "var(--accent-warning)" : l.level === "WARN" ? "var(--accent-bear)" : "var(--text-muted)",
          }}>
            [{l.level}] {l.message}
          </div>
        ))}
        {!d?.log?.length && <div className="text-[var(--text-muted)]">No loop log.</div>}
      </div>

      <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-3">
        Paper harness: Donchian {cfg?.entryChannel ?? 55} + VWAP {cfg?.vwapWindow ?? 20} · equal weight · max {cfg?.maxNames ?? 8} names · rebalance every {cfg?.rebalanceDays ?? 5} sessions.
        Systematic sizing only — not investment advice. No live broker orders.
      </p>
    </div>
  );
}
