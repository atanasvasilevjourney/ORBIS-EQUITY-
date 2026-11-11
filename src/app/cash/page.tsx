"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DeskPageHeader } from "@/components/ui/DeskPageHeader";
import { InfoCallout } from "@/components/ui/InfoCallout";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { FilterChip } from "@/components/ui/FilterChip";
import { TemaRibbon } from "@/components/charts/TemaRibbon";
import { CashBookBoard } from "@/components/dashboard/CashBookBoard";
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
};

const DEFAULT_TEMA_NAMES = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "JPM", "XOM"];

type ScreenRow = {
  ticker: string;
  companyName: string;
  sector: string;
  last: number | null;
  asOf: string | null;
  on: boolean;
  votes: number;
  distance: number;
  histograms: [boolean, boolean, boolean];
};

type ScreenData = { watched: number; on: number; rows: ScreenRow[] };

const SPREAD = ["8/21", "12/50", "8/63"];

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
  const [screen, setScreen] = useState<ScreenData | null>(null);
  const [screenLoading, setScreenLoading] = useState(true);

  useEffect(() => {
    fetch("/api/cash")
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
    fetch("/api/tema-screen")
      .then((r) => r.json())
      .then((raw: ScreenData) => {
        const rows = Array.isArray(raw?.rows) ? raw.rows : [];
        setScreen({ watched: raw?.watched ?? 0, on: raw?.on ?? rows.length, rows });
        const first = rows[0]?.ticker;
        if (first) setVizTicker(first);
      })
      .catch(() => setScreen({ watched: 0, on: 0, rows: [] }))
      .finally(() => setScreenLoading(false));
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
      ...(screen?.rows ?? []).map((n) => n.ticker),
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
  }, [d, screen, vizTicker]);

  const s = d?.summary;
  const regimeColor = s?.regime === "CASH" ? "var(--accent-bear)" : s?.regime === "REDUCE" ? "var(--accent-warning)" : "var(--accent-bull)";
  const cards = [
    { label: "REGIME", value: s?.regime ?? "—", color: regimeColor },
    { label: "DD / SCALAR", value: s?.drawdown == null ? "—" : `${(s.drawdown * 100).toFixed(1)}% · ${num(s.ddScalar, 2)}`, color: (s?.drawdown ?? 0) < -0.1 ? "var(--accent-warning)" : "" },
    { label: "TEMA ON", value: screenLoading ? "…" : String(screen?.on ?? 0), color: "var(--accent-info)" },
    { label: "CARVER", value: s?.carverSlots ?? "—", color: "var(--accent-warning)" },
    { label: "CASH OUT", value: s?.deployed == null ? "—" : usd(s.deployed, 0), color: "var(--accent-bull)" },
  ];

  return (
    <div className="py-6">
      <DeskPageHeader
        badge="CASH DESK"
        title="TEMA screen · Carver book"
        subtitle="TEMA lists names. You decide. Carver is the only sized cash book."
      />

      <InfoCallout title="TEMA is a screen">
        <p>
          A name is on when at least two of the 8/21, 12/50, and 8/63 TEMA histograms are positive and the close is above TEMA-199.
          It stays on until the close falls back through TEMA-199. Long only. No share count, no cash amount, no stop, no target.
        </p>
        <p>Carver still sizes its own cash book. The list is for your decision. Paper only — not investment advice.</p>
      </InfoCallout>

      {(d?.headline || d?.summary == null) && (
        <div className="headline-banner mb-4">
          <span style={{ color: "var(--accent-info)" }}>CASH:</span>{" "}
          {d?.headline ?? "Carver sizes the cash book. The TEMA list below is a screen."}
        </div>
      )}

      <MetricStrip items={cards} columns={5} loading={loading} />

      <CashBookBoard
        names={(d?.carverBook ?? []).map((row) => ({
          ticker: row.ticker,
          companyName: row.companyName,
          last: row.last,
          notional: row.carverNotional,
          side: row.carverSide,
        }))}
        onPick={setVizTicker}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {chips.map((t) => (
          <FilterChip key={t} label={t} active={t === vizTicker} onClick={() => setVizTicker(t)} />
        ))}
      </div>
      <p className="text-[10px] text-[var(--text-muted)] font-terminal mb-2">{tapeNote}</p>
      <div className="mb-6">
        <TemaRibbon bars={tape.bars} readout={tape.readout} title={`TEMA RIBBON · ${vizTicker} · 9 / 99 / 199`} />
      </div>

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">
        TEMA SCREEN · LONG ONLY · 2 OF 3 HISTOGRAMS · EXIT AT TEMA-199 · {screen ? `${screen.on} ON / ${screen.watched} WATCHED` : "—"}
      </h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">SECTOR</th>
              <th className="text-right px-3 py-2">LAST</th>
              <th className="text-left px-3 py-2">AS OF</th>
              <th className="text-left px-3 py-2">STATE</th>
              <th className="text-right px-3 py-2">VOTES</th>
              <th className="text-right px-3 py-2">8/21</th>
              <th className="text-right px-3 py-2">12/50</th>
              <th className="text-right px-3 py-2">8/63</th>
              <th className="text-right px-3 py-2">VS TEMA-199</th>
            </tr>
          </thead>
          <tbody>
            {screenLoading ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-[var(--text-muted)]">Reading the top 100 closes…</td></tr>
            ) : !screen?.rows.length ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-[var(--text-muted)]">No names are on the screen.</td></tr>
            ) : (
              screen.rows.map((r) => (
                <tr key={`s-${r.ticker}`} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                  <td className="px-3 py-2">
                    <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]" onClick={() => setVizTicker(r.ticker)}>{r.ticker}</Link>
                    <span className="text-[var(--text-muted)] ml-2 text-xs hidden lg:inline">{r.companyName}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{r.sector || "—"}</td>
                  <td className="px-3 py-2 text-right">{px(r.last)}</td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{r.asOf ?? "—"}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: "var(--accent-bull)" }}>ON</td>
                  <td className="px-3 py-2 text-right">{r.votes} / 3</td>
                  {r.histograms.map((up, i) => (
                    <td key={SPREAD[i]} className="px-3 py-2 text-right" style={{ color: up ? "var(--accent-bull)" : "var(--text-muted)" }}>{up ? "UP" : "—"}</td>
                  ))}
                  <td className="px-3 py-2 text-right">{pct(r.distance, 1)}</td>
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
        TEMA screen does not allocate. Carver is the sized cash book · DD soft 10% / hard 25% · fully funded. Not investment advice.
      </p>
    </div>
  );
}
