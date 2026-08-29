"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Name = {
  ticker: string;
  companyName: string;
  sector: string;
  last: number | null;
  perpSymbol: string | null;
  venue: string | null;
  venueListed: boolean;
  mark: number | null;
  funding8h: number | null;
  fundingAnn: number | null;
  temaSide: string | null;
  temaGrade: string | null;
  temaScore: number | null;
  temaT8: number | null;
  temaT21: number | null;
  temaT55: number | null;
  temaStop: number | null;
  temaTp: number | null;
  temaWeightPct: number | null;
  temaNotional: number | null;
  temaLeverage: number | null;
  temaMargin: number | null;
  temaLiq: number | null;
  carverForecast: number | null;
  carverEwmacFast: number | null;
  carverEwmacSlow: number | null;
  carverVol: number | null;
  carverSide: string | null;
  carverNotional: number | null;
  carverLeverage: number | null;
  carverMargin: number | null;
  carverLiq: number | null;
  atr: number | null;
  atrPct: number | null;
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
    grossLeverage: number | null;
    asOfDate: string | null;
    listed: number;
    synthetic: number;
  } | null;
  names: Name[];
  temaBook: Name[];
  carverBook: Name[];
  headline: string | null;
  config: Record<string, number | string> | null;
  stale: boolean;
};

const usd = (v: number | null | undefined, d = 0) =>
  v == null ? "—" : v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: d });
const px = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));
const num = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);

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

export default function PerpsPage() {
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
  const cfg = d?.config;
  const cards = [
    { label: "TEMA SLOTS", value: s?.temaSlots ?? "—", color: "var(--accent-info)" },
    { label: "CARVER SLOTS", value: s?.carverSlots ?? "—", color: "var(--accent-warning)" },
    { label: "GROSS LEV", value: s?.grossLeverage == null ? "—" : `${s.grossLeverage.toFixed(2)}x`, color: (s?.grossLeverage ?? 0) > 2.5 ? "var(--accent-bear)" : "var(--accent-bull)" },
    { label: "VENUE LISTED", value: s ? `${s.listed}/${(s.listed + s.synthetic) || 0}` : "—", color: "" },
    { label: "AS OF", value: s?.asOfDate ?? "—", color: d?.stale ? "var(--accent-warning)" : "" },
  ];

  return (
    <div className="px-4 py-6">
      <div className="mb-4">
        <h1 className="text-lg font-terminal font-bold tracking-wider" style={{ color: "var(--accent-warning)" }}>
          PERPS DESK
        </h1>
        <p className="text-xs text-[var(--text-secondary)]">
          TEMA + Carver sleeves on listed equities, sized as isolated USDT-M perpetuals · paper only
        </p>
      </div>

      <div className="px-4 py-3 mb-4 rounded border border-[var(--border)] bg-[var(--badge-bg)] text-xs text-[var(--text-secondary)] font-terminal space-y-1">
        <p>
          <span style={{ color: "var(--accent-warning)" }}>QMIE MAP:</span>{" "}
          atanasvasilevjourney/QMIE does not ship engines named TEMA or Carver. It scans crypto USDT perps with
          triple Supertrend + EMA200 + ranked 3L/3S ATR brackets. This desk is a <em>separate</em> KovaView
          section: TEMA 8/21/55 is the tactical stack (grade B+ on daily equity, 1.5/2.5 ATR); Carver EWMAC 16/64+32/128
          is the slow vol-targeted sleeve. Do not mix with LOOP / ORB / BIAS.
        </p>
        <p>
          Signals from equity EOD. Contract = TICKERUSDT. Venue marks/funding from public Bybit/Binance when the
          host can reach them; otherwise synthetic. 24×7 funding, basis, and liquidation are perp risks listed
          cash books do not have. Not investment advice. No live orders.
        </p>
      </div>

      {d?.headline && (
        <div className="px-4 py-2 mb-4 rounded border border-[var(--border)] bg-[var(--card-bg)] text-sm text-[var(--text-secondary)] font-terminal">
          <span style={{ color: "var(--accent-warning)" }}>PERPS:</span> {d.headline}
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

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">TEMA BOOK · 8/21/55 · B+ · 3L/3S</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">PERP</th>
              <th className="text-left px-3 py-2">SIDE</th>
              <th className="text-left px-3 py-2">GRADE</th>
              <th className="text-right px-3 py-2">WGT</th>
              <th className="text-right px-3 py-2">NOTIONAL</th>
              <th className="text-right px-3 py-2">LEV</th>
              <th className="text-right px-3 py-2">MARGIN</th>
              <th className="text-right px-3 py-2">STOP</th>
              <th className="text-right px-3 py-2">TP</th>
              <th className="text-right px-3 py-2">LIQ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.temaBook?.length ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-[var(--text-muted)]">No TEMA slots. Run: python -m pipeline.compute.perps_desk</td></tr>
            ) : (
              d.temaBook.map((r) => (
                <tr key={`t-${r.ticker}`} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                  <td className="px-3 py-2">
                    <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]">{r.ticker}</Link>
                    <span className="text-[var(--text-muted)] ml-2 text-xs hidden lg:inline">{r.companyName}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{r.perpSymbol}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: sideColor(r.temaSide) }}>{r.temaSide}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: gradeColor(r.temaGrade) }}>{r.temaGrade} {num(r.temaScore, 0)}</td>
                  <td className="px-3 py-2 text-right">{r.temaWeightPct == null ? "—" : `${r.temaWeightPct.toFixed(1)}%`}</td>
                  <td className="px-3 py-2 text-right">{usd(r.temaNotional, 0)}</td>
                  <td className="px-3 py-2 text-right">{r.temaLeverage ? `${r.temaLeverage.toFixed(2)}x` : "—"}</td>
                  <td className="px-3 py-2 text-right">{usd(r.temaMargin, 0)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--accent-bear)" }}>{px(r.temaStop)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--accent-bull)" }}>{px(r.temaTp)}</td>
                  <td className="px-3 py-2 text-right">{px(r.temaLiq)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">CARVER BOOK · EWMAC 16/64 + 32/128 · VOL TARGET 25%</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">PERP</th>
              <th className="text-left px-3 py-2">SIDE</th>
              <th className="text-right px-3 py-2">FORECAST</th>
              <th className="text-right px-3 py-2">16/64</th>
              <th className="text-right px-3 py-2">32/128</th>
              <th className="text-right px-3 py-2">σ ANN</th>
              <th className="text-right px-3 py-2">NOTIONAL</th>
              <th className="text-right px-3 py-2">LEV</th>
              <th className="text-right px-3 py-2">MARGIN</th>
              <th className="text-right px-3 py-2">LIQ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.carverBook?.length ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-[var(--text-muted)]">No Carver slots. Forecasts need |f| ≥ 5 after vol targeting.</td></tr>
            ) : (
              d.carverBook.map((r) => (
                <tr key={`c-${r.ticker}`} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                  <td className="px-3 py-2">
                    <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]">{r.ticker}</Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{r.perpSymbol}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: sideColor(r.carverSide) }}>{r.carverSide}</td>
                  <td className="px-3 py-2 text-right font-bold" style={{ color: sideColor(r.carverSide) }}>{num(r.carverForecast, 1)}</td>
                  <td className="px-3 py-2 text-right">{num(r.carverEwmacFast, 1)}</td>
                  <td className="px-3 py-2 text-right">{num(r.carverEwmacSlow, 1)}</td>
                  <td className="px-3 py-2 text-right">{pct(r.carverVol, 0)}</td>
                  <td className="px-3 py-2 text-right">{usd(r.carverNotional, 0)}</td>
                  <td className="px-3 py-2 text-right">{r.carverLeverage ? `${r.carverLeverage.toFixed(2)}x` : "—"}</td>
                  <td className="px-3 py-2 text-right">{usd(r.carverMargin, 0)}</td>
                  <td className="px-3 py-2 text-right">{px(r.carverLiq)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">UNIVERSE TAPE</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">VENUE</th>
              <th className="text-right px-3 py-2">LAST</th>
              <th className="text-right px-3 py-2">MARK</th>
              <th className="text-right px-3 py-2">FUND 8H</th>
              <th className="text-left px-3 py-2">TEMA</th>
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
                <td className="px-3 py-2 text-xs">
                  <span style={{ color: r.venueListed ? "var(--accent-bull)" : "var(--text-muted)" }}>
                    {r.venueListed ? r.venue : "synthetic"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{px(r.last)}</td>
                <td className="px-3 py-2 text-right">{px(r.mark)}</td>
                <td className="px-3 py-2 text-right">{r.funding8h == null ? "—" : `${(r.funding8h * 100).toFixed(3)}%`}</td>
                <td className="px-3 py-2 text-xs" style={{ color: gradeColor(r.temaGrade) }}>{r.temaSide} {r.temaGrade}</td>
                <td className="px-3 py-2 text-right" style={{ color: sideColor(r.carverSide) }}>{num(r.carverForecast, 1)}</td>
                <td className="px-3 py-2 text-xs text-[var(--text-muted)] truncate max-w-[280px]">{r.skipReason ?? r.rationale}</td>
              </tr>
            ))}
            {!loading && !d?.names?.length && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">Empty. Run the perps compute.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-3">
        Paper harness: $100,000 · TEMA 50% sleeve · Carver target vol 25% · max {String(cfg?.maxLeverage ?? 5)}x isolated ·
        liq uses 0.5% MMR (not exchange-tiered). Funding haircut is live only when a venue tape exists; otherwise assume
        ~0.01%/8h (~11% annual) if you hold 24×7. Not investment advice.
      </p>
    </div>
  );
}
