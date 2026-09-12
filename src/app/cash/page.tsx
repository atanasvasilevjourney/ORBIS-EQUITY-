"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Name = {
  ticker: string;
  companyName: string;
  sector: string;
  last: number | null;
  temaSide: string | null;
  temaGrade: string | null;
  temaScore: number | null;
  temaStop: number | null;
  temaTp: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  macdAction: string | null;
  temaWeightPct: number | null;
  temaNotional: number | null;
  temaShares: number | null;
  carverForecast: number | null;
  carverEwmacFast: number | null;
  carverEwmacSlow: number | null;
  carverVol: number | null;
  carverSide: string | null;
  carverNotional: number | null;
  carverShares: number | null;
  atr: number | null;
  inTemaBook: boolean;
  inCarverBook: boolean;
  skipReason: string | null;
  rationale: string | null;
};

type Data = {
  summary: {
    names: number | null;
    temaSlots: number | null;
    carverSlots: number | null;
    deployed: number | null;
    asOfDate: string | null;
    regime: string | null;
    drawdown: number | null;
    ddScalar: number | null;
    book: string | null;
  } | null;
  names: Name[];
  temaBook: Name[];
  macdClosed: Name[];
  carverBook: Name[];
  headline: string | null;
  config: Record<string, number | string> | null;
};

const usd = (v: number | null | undefined, d = 0) =>
  v == null ? "—" : v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: d });
const px = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));
const num = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const sh = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 2 }));

function sideColor(s: string | null) {
  if (s === "BUY" || s === "LONG") return "var(--accent-bull)";
  if (s === "SELL" || s === "SHORT") return "var(--accent-bear)";
  return "var(--text-muted)";
}

function gradeColor(g: string | null) {
  if (g === "A+" || g === "A") return "var(--accent-bull)";
  if (g === "B") return "var(--accent-warning)";
  return "var(--text-muted)";
}

function macdColor(a: string | null) {
  if (a === "HOLD") return "var(--accent-bull)";
  if (a === "CLOSE") return "var(--accent-bear)";
  return "var(--text-muted)";
}

export default function CashPage() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/perps")
      .then((r) => r.json())
      .then(setD)
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  const s = d?.summary;
  const regimeColor = s?.regime === "CASH" ? "var(--accent-bear)" : s?.regime === "REDUCE" ? "var(--accent-warning)" : "var(--accent-bull)";
  const cards = [
    { label: "REGIME", value: s?.regime ?? "—", color: regimeColor },
    { label: "DD / SCALAR", value: s?.drawdown == null ? "—" : `${(s.drawdown * 100).toFixed(1)}% · ${num(s.ddScalar, 2)}`, color: (s?.drawdown ?? 0) < -0.1 ? "var(--accent-warning)" : "" },
    { label: "TEMA 9/99/199", value: s?.temaSlots ?? "—", color: "var(--accent-info)" },
    { label: "CARVER", value: s?.carverSlots ?? "—", color: "var(--accent-warning)" },
    { label: "CASH OUT", value: s?.deployed == null ? "—" : usd(s.deployed, 0), color: "var(--accent-bull)" },
  ];

  return (
    <div className="px-4 py-6">
      <div className="mb-4">
        <h1 className="text-lg font-terminal font-bold tracking-wider" style={{ color: "var(--accent-info)" }}>
          CASH BOOK · TEMA + CARVER
        </h1>
        <p className="text-xs text-[var(--text-secondary)]">
          Listed close from prices_daily (Yahoo → Stooq cash EOD) · fully funded shares · no USDT-M leverage, funding, or liquidation · paper only
        </p>
      </div>

      <div className="px-4 py-3 mb-4 rounded border border-[var(--border)] bg-[var(--badge-bg)] text-xs text-[var(--text-secondary)] font-terminal space-y-1">
        <p>
          <span style={{ color: "var(--accent-info)" }}>CASH:</span>{" "}
          Same TEMA 9/99/199 swing and Carver EWMAC as before, sized on the actual stock close
          from the cash EOD ingest (Yahoo chart API, Stooq fallback — QMIE-shaped, not perp klines).
          A slot is shares × cash price, capped at the allocated sleeve cash. Longs are paper long stock.
          Shorts are paper shorts of the listed name — no borrow / locate model. Isolated from LOOP / ORB / BIAS / ROTATE.
        </p>
        <p>
          MACD(12,26,9) is the systematic close. 2.5 ATR is the hard stop. Not investment advice. No live orders.
        </p>
      </div>

      {d?.headline && (
        <div className="px-4 py-2 mb-4 rounded border border-[var(--border)] bg-[var(--card-bg)] text-sm text-[var(--text-secondary)] font-terminal">
          <span style={{ color: "var(--accent-info)" }}>CASH:</span> {d.headline}
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

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">TEMA BOOK · CASH SHARES · MACD HOLD · B+ · 3L/3S</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-right px-3 py-2">CASH PX</th>
              <th className="text-left px-3 py-2">SIDE</th>
              <th className="text-left px-3 py-2">GRADE</th>
              <th className="text-left px-3 py-2">MACD</th>
              <th className="text-right px-3 py-2">WGT</th>
              <th className="text-right px-3 py-2">SHARES</th>
              <th className="text-right px-3 py-2">CASH $</th>
              <th className="text-right px-3 py-2">STOP</th>
              <th className="text-right px-3 py-2">TP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.temaBook?.length ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-[var(--text-muted)]">No TEMA slots. Run: python -m pipeline.compute.perps_desk</td></tr>
            ) : (
              d.temaBook.map((r) => (
                <tr key={`t-${r.ticker}`} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                  <td className="px-3 py-2">
                    <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]">{r.ticker}</Link>
                    <span className="text-[var(--text-muted)] ml-2 text-xs hidden lg:inline">{r.companyName}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{px(r.last)}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: sideColor(r.temaSide) }}>{r.temaSide}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: gradeColor(r.temaGrade) }}>{r.temaGrade} {num(r.temaScore, 0)}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: macdColor(r.macdAction) }}>
                    {r.macdAction ?? "—"}
                    <span className="text-[var(--text-muted)] font-normal ml-2 text-xs">{num(r.macd, 3)}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{r.temaWeightPct == null ? "—" : `${r.temaWeightPct.toFixed(1)}%`}</td>
                  <td className="px-3 py-2 text-right">{sh(r.temaShares)}</td>
                  <td className="px-3 py-2 text-right">{usd(r.temaNotional, 0)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--accent-bear)" }}>{px(r.temaStop)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--accent-bull)" }}>{px(r.temaTp)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">MACD CLOSE · TEMA SETUP, LINE CROSSED SIGNAL · NOT IN BOOK</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">SIDE</th>
              <th className="text-left px-3 py-2">GRADE</th>
              <th className="text-right px-3 py-2">MACD</th>
              <th className="text-right px-3 py-2">SIGNAL</th>
              <th className="text-right px-3 py-2">HIST</th>
              <th className="text-right px-3 py-2">STOP</th>
              <th className="text-left px-3 py-2">NOTE</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.macdClosed?.length ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">No TEMA names sitting on a MACD close.</td></tr>
            ) : (
              d.macdClosed.map((r) => (
                <tr key={`m-${r.ticker}`} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                  <td className="px-3 py-2">
                    <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]">{r.ticker}</Link>
                  </td>
                  <td className="px-3 py-2 font-bold" style={{ color: sideColor(r.temaSide) }}>{r.temaSide}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: gradeColor(r.temaGrade) }}>{r.temaGrade} {num(r.temaScore, 0)}</td>
                  <td className="px-3 py-2 text-right">{num(r.macd, 3)}</td>
                  <td className="px-3 py-2 text-right">{num(r.macdSignal, 3)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: (r.macdHist ?? 0) < 0 ? "var(--accent-bear)" : "var(--accent-bull)" }}>{num(r.macdHist, 3)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--accent-bear)" }}>{px(r.temaStop)}</td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{r.skipReason ?? "macd_close"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">CARVER BOOK · EWMAC + DD SCALAR · CASH SHARES · {s?.regime ?? "—"}</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-right px-3 py-2">CASH PX</th>
              <th className="text-left px-3 py-2">SIDE</th>
              <th className="text-right px-3 py-2">FORECAST</th>
              <th className="text-right px-3 py-2">16/64</th>
              <th className="text-right px-3 py-2">32/128</th>
              <th className="text-right px-3 py-2">σ ANN</th>
              <th className="text-right px-3 py-2">SHARES</th>
              <th className="text-right px-3 py-2">CASH $</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.carverBook?.length ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-[var(--text-muted)]">No Carver slots. Forecasts need |f| ≥ 5 after vol targeting.</td></tr>
            ) : (
              d.carverBook.map((r) => (
                <tr key={`c-${r.ticker}`} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                  <td className="px-3 py-2">
                    <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]">{r.ticker}</Link>
                  </td>
                  <td className="px-3 py-2 text-right">{px(r.last)}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: sideColor(r.carverSide) }}>{r.carverSide}</td>
                  <td className="px-3 py-2 text-right font-bold" style={{ color: sideColor(r.carverSide) }}>{num(r.carverForecast, 1)}</td>
                  <td className="px-3 py-2 text-right">{num(r.carverEwmacFast, 1)}</td>
                  <td className="px-3 py-2 text-right">{num(r.carverEwmacSlow, 1)}</td>
                  <td className="px-3 py-2 text-right">{pct(r.carverVol, 0)}</td>
                  <td className="px-3 py-2 text-right">{sh(r.carverShares)}</td>
                  <td className="px-3 py-2 text-right">{usd(r.carverNotional, 0)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">UNIVERSE · CASH CLOSE</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-right px-3 py-2">CASH PX</th>
              <th className="text-left px-3 py-2">TEMA</th>
              <th className="text-left px-3 py-2">MACD</th>
              <th className="text-right px-3 py-2">FCAST</th>
              <th className="text-left px-3 py-2">NOTE</th>
            </tr>
          </thead>
          <tbody>
            {(d?.names ?? []).map((r) => (
              <tr key={r.ticker} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                <td className="px-3 py-2">
                  <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]">{r.ticker}</Link>
                </td>
                <td className="px-3 py-2 text-right">{px(r.last)}</td>
                <td className="px-3 py-2 text-xs" style={{ color: gradeColor(r.temaGrade) }}>{r.temaSide} {r.temaGrade}</td>
                <td className="px-3 py-2 text-xs font-bold" style={{ color: macdColor(r.macdAction) }}>{r.macdAction ?? "—"}</td>
                <td className="px-3 py-2 text-right" style={{ color: sideColor(r.carverSide) }}>{num(r.carverForecast, 1)}</td>
                <td className="px-3 py-2 text-xs text-[var(--text-muted)] truncate max-w-[320px]">{r.skipReason ?? r.rationale}</td>
              </tr>
            ))}
            {!loading && !d?.names?.length && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-[var(--text-muted)]">Empty. Run the cash compute.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-3">
        Paper harness: $100,000 cash · TEMA 9/99/199 · MACD(12,26,9) close · 2.5 ATR hard stop ·
        Carver DD soft 10% / hard 25% · rotation LIVE / REDUCE / CASH · fully funded. Not investment advice.
      </p>
    </div>
  );
}
