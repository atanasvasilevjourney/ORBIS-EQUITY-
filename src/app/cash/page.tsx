"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TemaRibbon } from "@/components/charts/TemaRibbon";
import { DeskHeader } from "@/components/ui/DeskHeader";
import { deskList, parseDesk } from "@/lib/deskPayload";
import { temaTape, type TemaBar, type TemaReadout } from "@/lib/tema";

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
  stale?: boolean;
};

const DEFAULT_TEMA_NAMES = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "JPM", "XOM"];

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
  const [vizTicker, setVizTicker] = useState("AAPL");
  const [tape, setTape] = useState<{ bars: TemaBar[]; readout: TemaReadout | null }>({ bars: [], readout: null });
  const [tapeNote, setTapeNote] = useState("Loading listed closes…");

  useEffect(() => {
    fetch("/api/perps")
      .then((r) => r.json())
      .then((raw: unknown) => {
        const parsed = parseDesk<Data>(raw, "temaBook") ?? parseDesk<Data>(raw, "names");
        if (parsed) {
          setD(parsed);
          const first = parsed.temaBook?.[0]?.ticker || parsed.names?.[0]?.ticker;
          if (first) setVizTicker((cur) => cur || first);
        } else {
          setD({
            summary: null,
            names: deskList<Name>(raw, "names"),
            temaBook: deskList<Name>(raw, "temaBook"),
            macdClosed: deskList<Name>(raw, "macdClosed"),
            carverBook: deskList<Name>(raw, "carverBook"),
            headline: null,
            config: null,
          });
        }
      })
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTapeNote(`Loading ${vizTicker} cash tape…`);
    fetch(`/api/chart/${encodeURIComponent(vizTicker)}`)
      .then((r) => r.json())
      .then((raw: { candles?: { time: string | number; high: number; low: number; close: number }[] }) => {
        if (cancelled) return;
        const candles = Array.isArray(raw?.candles) ? raw.candles : [];
        const next = temaTape(candles);
        setTape(next);
        if (!candles.length) setTapeNote(`${vizTicker} has no prices_daily bars yet.`);
        else if (!next.readout) setTapeNote(`${vizTicker}: ${candles.length} bars — TEMA 199 needs ≥220 daily closes.`);
        else setTapeNote(`${vizTicker} · ${candles.length} listed daily closes`);
      })
      .catch(() => {
        if (!cancelled) {
          setTape({ bars: [], readout: null });
          setTapeNote(`${vizTicker} chart failed.`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [vizTicker]);

  const chips = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [
      vizTicker,
      ...(d?.temaBook ?? []).map((n) => n.ticker),
      ...(d?.carverBook ?? []).map((n) => n.ticker),
      ...(d?.names ?? []).map((n) => n.ticker),
      ...DEFAULT_TEMA_NAMES,
    ]) {
      const u = (t || "").toUpperCase();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
      if (out.length >= 16) break;
    }
    return out;
  }, [d, vizTicker]);

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
      <DeskHeader
        title="CASH BOOK · TEMA + CARVER"
        description="Listed close from prices_daily (Yahoo → Stooq cash EOD) · fully funded shares · no USDT-M leverage, funding, or liquidation · paper only"
        asOf={s?.asOfDate}
        stale={d?.stale}
        source="CASH EOD"
        chips={s?.regime ? [{ label: s.regime, color: regimeColor }] : []}
      />

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

      {(d?.headline || d?.summary == null) && (
        <div className="px-4 py-2 mb-4 rounded border border-[var(--border)] bg-[var(--card-bg)] text-sm text-[var(--text-secondary)] font-terminal">
          <span style={{ color: "var(--accent-info)" }}>CASH:</span>{" "}
          {d?.headline ?? "Paper TEMA ribbon on listed closes. Book slots fill after python -m pipeline.compute.perps_desk (cash EOD, not perps)."}
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

      <div className="mb-4 flex flex-wrap gap-2">
        {chips.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setVizTicker(t)}
            className="px-2 py-1 rounded border border-[var(--border)] text-xs font-terminal"
            style={{
              background: t === vizTicker ? "rgba(56, 189, 248, 0.18)" : "var(--card-bg)",
              color: t === vizTicker ? "var(--accent-info)" : "var(--text-secondary)",
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-[var(--text-muted)] font-terminal mb-2">{tapeNote}</p>
      <div className="mb-6">
        <TemaRibbon bars={tape.bars} readout={tape.readout} title={`TEMA RIBBON · ${vizTicker} · 9 / 99 / 199`} />
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
              <tr><td colSpan={10} className="px-3 py-8 text-center text-[var(--text-muted)]">No TEMA slots yet (nightly perps_desk has not written a book). Ribbon above still plots 9/99/199 on listed closes.</td></tr>
            ) : (
              d.temaBook.map((r) => (
                <tr key={`t-${r.ticker}`} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                  <td className="px-3 py-2">
                    <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]" onClick={() => setVizTicker(r.ticker)}>{r.ticker}</Link>
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
                    <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]" onClick={() => setVizTicker(r.ticker)}>{r.ticker}</Link>
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
                    <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]" onClick={() => setVizTicker(r.ticker)}>{r.ticker}</Link>
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
