"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { OvernightMover } from "@/lib/overnightGaps";
import type { BreakoutHit } from "@/lib/breakoutScan";
import { TradingChart, type Candle, type ChartLevel } from "@/components/chart/TradingChart";
import { parseDesk } from "@/lib/deskPayload";
import { recordRecentTicker } from "@/components/command/CommandPalette";
import type { SessionMover } from "@/lib/sessionMovers";
import { cashClock, overnightWatchStep, type CashClock } from "@/lib/cashSession";

type PlaySummary = {
  asOfDate: string;
  priorDate: string;
  names: number;
  nGainers: number;
  nLosers: number;
  nGappers: number;
  nOvernight?: number;
  overnightLead?: string | null;
  overnightLeadGap?: number | null;
  nBreakouts?: number;
  nBreakouts5m?: number;
};

type PlayData = {
  summary: PlaySummary | null;
  gainers: SessionMover[];
  losers: SessionMover[];
  gappers: SessionMover[];
  liquid: SessionMover[];
  overnight?: OvernightMover[];
  breakouts?: BreakoutHit[];
  breakouts5m?: BreakoutHit[];
  clock?: CashClock;
  headline: string | null;
  stale: boolean;
};

type OrbWatch = {
  ticker: string;
  companyName: string;
  gapPct: number | null;
  prevClose: number | null;
  open: number | null;
  orHigh: number | null;
  orLow: number | null;
  status: string;
  last: number | null;
};

type ScanId = "overnight" | "breakout" | "breakout5m" | "gainers" | "losers" | "gappers" | "liquid" | "orb";

type NewsItem = {
  id: string;
  ticker: string;
  publishedAt: string | null;
  source: string | null;
  headline: string | null;
  url: string | null;
};

const SCANS: { id: ScanId; label: string; hint: string }[] = [
  { id: "overnight", label: "Overnight Gaps", hint: "AH/pre vs prior close" },
  { id: "breakout", label: "Breakout 100D", hint: "close > HH(close,100)[1]" },
  { id: "breakout5m", label: "Breakout 100·5m", hint: "same logic on delayed 5m" },
  { id: "gainers", label: "Session Gainers", hint: "Close vs prior" },
  { id: "losers", label: "Session Decliners", hint: "Close vs prior" },
  { id: "gappers", label: "Gappers ≥4%", hint: "Yesterday open gap" },
  { id: "liquid", label: "Most Active $", hint: "Close × volume" },
  { id: "orb", label: "ORB Watch", hint: "Paper 15m OR book" },
];

const WATCH_STEPS = [
  { n: 1, when: "07:00", text: "Rank overnight gap-ups. Read the news. Skip thin AH prints." },
  { n: 2, when: "09:25", text: "Lock 3–5 names. Paper size only." },
  { n: 3, when: "09:30", text: "Mark 15-minute OR (09:30–09:45 ET) on ORB." },
  { n: 4, when: "09:45", text: "First 5m close above OR high = paper long 1R." },
];

function fmtPx(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 100) return v.toFixed(2);
  if (v >= 1) return v.toFixed(3);
  return v.toFixed(4);
}

function fmtPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
}

function fmtAbs(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : "-"}${fmtPx(Math.abs(v))}`;
}

function fmtVol(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

function tone(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v) || v === 0) return "var(--text-muted)";
  return v > 0 ? "var(--accent-bull)" : "var(--accent-bear)";
}

function orbToMover(w: OrbWatch): SessionMover {
  const last = w.last ?? w.open ?? 0;
  const prev = w.prevClose ?? 0;
  const open = w.open ?? last;
  const gapFrac = (w.gapPct ?? 0) / 100;
  return {
    ticker: w.ticker,
    companyName: w.companyName || w.status,
    last,
    prevClose: prev,
    open,
    high: w.orHigh ?? last,
    low: w.orLow ?? last,
    volume: null,
    chgPct: prev > 0 ? last / prev - 1 : gapFrac,
    chgAbs: prev > 0 ? last - prev : 0,
    gapPct: gapFrac,
    dollarVol: 0,
  };
}

function rankClientBreakouts(rows: BreakoutHit[], sort: "volume" | "rsi"): BreakoutHit[] {
  const copy = [...rows];
  if (sort === "rsi") copy.sort((a, b) => (b.rsi ?? -1) - (a.rsi ?? -1));
  else copy.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  return copy;
}

export default function PlayPage() {
  const [d, setD] = useState<PlayData | null>(null);
  const [orb, setOrb] = useState<OrbWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState<CashClock>(() => cashClock());
  const [scan, setScan] = useState<ScanId>(() => (cashClock().watchOvernight ? "overnight" : "gainers"));
  const [sel, setSel] = useState("");
  const [filter, setFilter] = useState("");
  const [brkSort, setBrkSort] = useState<"volume" | "rsi">("volume");
  const [chartTf, setChartTf] = useState<"1d" | "5m">(() => (cashClock().watchOvernight ? "5m" : "1d"));
  const [chart, setChart] = useState<{
    candles: Candle[];
    sma20?: (number | null)[];
    source: string;
    interval: string;
  } | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);

  useEffect(() => {
    const tick = () => setClock(cashClock());
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      Promise.all([
        fetch("/api/play")
          .then((r) => r.json())
          .then((data: unknown) => parseDesk<PlayData>(data, "gainers")),
        fetch("/api/orb")
          .then((r) => r.json())
          .then((data: unknown) => {
            const rec = parseDesk<{ watch: OrbWatch[] }>(data, "watch");
            return rec?.watch ?? [];
          })
          .catch(() => [] as OrbWatch[]),
      ])
        .then(([desk, watch]) => {
          if (cancelled) return;
          setD(desk);
          setOrb(watch);
          if (!sel) {
            const first =
              (cashClock().watchOvernight ? desk?.overnight?.[0]?.ticker : null) ||
              desk?.gainers?.[0]?.ticker ||
              watch[0]?.ticker ||
              "";
            if (first) setSel(first);
          }
        })
        .catch(() => {
          if (!cancelled) setD(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const id = window.setInterval(load, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // sel is read only to avoid resetting the pick on poll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    if (scan === "orb") return orb.map(orbToMover);
    if (!d) return [];
    if (scan === "overnight") return d.overnight ?? [];
    if (scan === "breakout") return rankClientBreakouts(d.breakouts ?? [], brkSort);
    if (scan === "breakout5m") return rankClientBreakouts(d.breakouts5m ?? [], brkSort);
    if (scan === "losers") return d.losers;
    if (scan === "gappers") return d.gappers;
    if (scan === "liquid") return d.liquid;
    return d.gainers;
  }, [d, orb, scan, brkSort]);

  const shown = useMemo(() => {
    const q = filter.trim().toUpperCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.ticker.includes(q) || r.companyName.toUpperCase().includes(q)
    );
  }, [rows, filter]);

  useEffect(() => {
    if (!shown.length) return;
    if (!shown.some((r) => r.ticker === sel)) setSel(shown[0].ticker);
  }, [shown, sel]);

  const selected = shown.find((r) => r.ticker === sel) ?? shown[0] ?? null;

  useEffect(() => {
    if (!selected?.ticker) {
      setChart(null);
      setNews([]);
      return;
    }
    recordRecentTicker(selected.ticker);
    const ac = new AbortController();
    fetch(`/api/chart/${encodeURIComponent(selected.ticker)}?interval=${chartTf}`, {
      signal: ac.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("chart");
        return r.json();
      })
      .then((x) => setChart(x))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setChart(null);
      });
    fetch(`/api/earnings-news?ticker=${encodeURIComponent(selected.ticker)}&days=30&limit=20`, {
      signal: ac.signal,
    })
      .then((r) => r.json())
      .then((x) => setNews(Array.isArray(x?.news) ? x.news : []))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setNews([]);
      });
    return () => ac.abort();
  }, [selected?.ticker, chartTf]);

  useEffect(() => {
    if (scan === "overnight") setChartTf("5m");
    if (scan === "breakout") setChartTf("1d");
    if (scan === "breakout5m") setChartTf("5m");
  }, [scan]);

  const counts: Record<ScanId, number> = {
    overnight: d?.overnight?.length ?? 0,
    breakout: d?.breakouts?.length ?? 0,
    breakout5m: d?.breakouts5m?.length ?? 0,
    gainers: d?.gainers?.length ?? 0,
    losers: d?.losers?.length ?? 0,
    gappers: d?.gappers?.length ?? 0,
    liquid: d?.liquid?.length ?? 0,
    orb: orb.length,
  };

  const pctHeader = scan === "gappers" || scan === "orb" || scan === "overnight" ? "GAP" : "% CHG";
  const asOf = d?.summary?.asOfDate ?? "—";
  const step = overnightWatchStep(clock);
  const n4 = (d?.overnight ?? []).filter((r) => r.orbEligible).length;
  const isBrk = scan === "breakout" || scan === "breakout5m";
  const brkSel = selected && "priorHigh" in selected ? (selected as BreakoutHit) : null;
  const chartLevels: ChartLevel[] =
    brkSel != null && Number.isFinite(brkSel.priorHigh)
      ? [{ price: brkSel.priorHigh, title: `HH ${brkSel.lookback}`, color: "var(--accent-info)" }]
      : [];

  return (
    <div className="flex flex-col min-h-[560px] lg:h-[calc(100vh-72px)]">
      <div className="shrink-0 px-3 py-2 border-b border-[var(--border)] flex flex-wrap items-center gap-x-4 gap-y-1">
        <div>
          <h1 className="text-sm font-terminal font-bold tracking-wider" style={{ color: "var(--accent-warning)" }}>
            STOCKS IN PLAY
          </h1>
          <p className="text-[10px] text-[var(--text-muted)] font-terminal">
            Overnight gaps = delayed Yahoo AH/pre · Breakout 100 = close {'>'} highest prior 100 closes · not TOS live L1
          </p>
        </div>
        <div className="text-[10px] font-terminal text-[var(--text-secondary)]">
          {d?.headline ?? (loading ? "Loading…" : "No session tape")}
          {d?.stale ? (
            <span className="ml-2" style={{ color: "var(--accent-warning)" }}>
              EOD STALE
            </span>
          ) : null}
        </div>
        <div className="ml-auto text-[10px] font-terminal text-[var(--text-muted)] text-right">
          <div style={{ color: clock.watchOvernight ? "var(--accent-warning)" : "var(--text-secondary)" }}>
            {clock.et} · {clock.phase} · {clock.next}
          </div>
          <div>
            EOD {asOf} · PRIOR {d?.summary?.priorDate ?? "—"} · {d?.summary?.names ?? 0} NAMES
            {n4 ? ` · ${n4} ≥4% overnight` : ""}
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        <aside className="lg:w-48 shrink-0 border-b lg:border-b-0 lg:border-r border-[var(--border)] bg-[var(--surface)] overflow-y-auto">
          <div className="px-3 py-2 text-[10px] font-terminal tracking-widest text-[var(--text-muted)]">
            SCANS
          </div>
          {SCANS.map((s) => {
            const active = scan === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setScan(s.id)}
                className={`w-full text-left px-3 py-2 border-l-2 ${
                  active
                    ? "bg-[var(--badge-bg)] border-[var(--accent-warning)]"
                    : "border-transparent hover:bg-[var(--surface-alt)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-xs font-terminal"
                    style={{ color: active ? "var(--accent-warning)" : "var(--text-primary)" }}
                  >
                    {s.label}
                  </span>
                  <span className="text-[10px] font-terminal text-[var(--text-muted)]">{counts[s.id]}</span>
                </div>
                <div className="text-[10px] text-[var(--text-muted)]">{s.hint}</div>
              </button>
            );
          })}
          <div className="px-3 py-3 text-[10px] text-[var(--text-muted)] font-terminal leading-relaxed space-y-2">
            <div className="tracking-widest">7AM → OPEN</div>
            {WATCH_STEPS.map((s) => (
              <div
                key={s.n}
                className="pl-2 border-l-2"
                style={{
                  borderColor: step === s.n ? "var(--accent-warning)" : "var(--border)",
                  color: step === s.n ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                <span className="text-[var(--accent-info)]">{s.when}</span> {s.text}
              </div>
            ))}
            <div>
              ORB stays a strategy tab.{" "}
              <Link href="/orb" className="text-[var(--accent-info)] hover:underline">
                Open ORB
              </Link>
            </div>
          </div>
        </aside>

        <section className="flex-1 min-w-0 flex flex-col min-h-[320px] lg:min-h-0 border-b lg:border-b-0 lg:border-r border-[var(--border)]">
          <div className="shrink-0 px-3 py-1.5 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-alt)]">
            <span className="text-[10px] font-terminal tracking-widest text-[var(--text-muted)]">
              {SCANS.find((s) => s.id === scan)?.label.toUpperCase()} · {shown.length} RESULTS
            </span>
            {isBrk && (
              <div className="flex gap-1">
                {(["volume", "rsi"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setBrkSort(k)}
                    className={`px-2 py-0.5 text-[10px] font-terminal rounded border ${
                      brkSort === k
                        ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                        : "border-[var(--border)] text-[var(--text-muted)]"
                    }`}
                  >
                    {k === "volume" ? "SORT VOL" : "SORT RSI"}
                  </button>
                ))}
              </div>
            )}
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter ticker…"
              className="ml-auto w-36 px-2 py-0.5 text-[10px] font-terminal rounded border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs font-terminal">
              <thead className="sticky top-0 bg-[var(--surface-alt)]">
                <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)]">
                  <th className="text-right px-2 py-1.5 w-8">#</th>
                  <th className="text-left px-2 py-1.5">TICKER</th>
                  <th className="text-right px-2 py-1.5">LAST</th>
                  <th className="text-right px-2 py-1.5">{pctHeader}</th>
                  <th className="text-right px-2 py-1.5">$ CHG</th>
                  <th className="text-right px-2 py-1.5">OPEN</th>
                  <th className="text-right px-2 py-1.5">HIGH</th>
                  <th className="text-right px-2 py-1.5">LOW</th>
                  <th className="text-right px-2 py-1.5">VOL</th>
                  {isBrk ? (
                    <>
                      <th className="text-right px-2 py-1.5">RSI</th>
                      <th className="text-right px-2 py-1.5">HH100</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={isBrk ? 11 : 9} className="px-3 py-10 text-center text-[var(--text-muted)]">
                      Loading session movers…
                    </td>
                  </tr>
                ) : !shown.length ? (
                  <tr>
                    <td colSpan={isBrk ? 11 : 9} className="px-3 py-10 text-center text-[var(--text-muted)]">
                      {scan === "orb"
                        ? "No ORB watch this session. Run: python -m pipeline.compute.opening_range"
                        : scan === "overnight"
                          ? "No delayed overnight prints yet. Premarket 04:00–09:30 ET. Yahoo spark, not live L1."
                          : isBrk
                          ? "No close above the prior 100-bar high with last ≥ $1 and volume ≥ 1M. Sub-$1 runners (TRUG) are excluded. Delayed tape, not Thinkorswim."
                          : "No names on this scan. Need two daily prints in prices_daily."}
                    </td>
                  </tr>
                ) : (
                  shown.map((r, i) => {
                    const active = r.ticker === selected?.ticker;
                    const pct = scan === "gappers" || scan === "orb" || scan === "overnight" ? r.gapPct : r.chgPct;
                    const overnight = r as OvernightMover;
                    return (
                      <tr
                        key={r.ticker}
                        className={`border-b border-[var(--border)] cursor-pointer ${
                          active ? "bg-[var(--badge-bg)]" : "hover:bg-[var(--surface-alt)]"
                        }`}
                        onClick={() => setSel(r.ticker)}
                      >
                        <td className="px-2 py-1.5 text-right text-[var(--text-muted)]">{i + 1}</td>
                        <td className="px-2 py-1.5">
                          <Link
                            href={`/ticker/${r.ticker}`}
                            className="font-bold hover:text-[var(--accent-info)]"
                            style={{ color: active ? "var(--accent-warning)" : undefined }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.ticker}
                          </Link>
                          {(r.companyName || (scan === "overnight" && overnight.orbEligible)) ? (
                            <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[160px]">
                              {r.companyName}
                              {scan === "overnight" && overnight.orbEligible ? `${r.companyName ? " · " : ""}ORB ≥4%` : ""}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 text-right">{fmtPx(r.last)}</td>
                        <td className="px-2 py-1.5 text-right font-bold" style={{ color: tone(pct) }}>
                          {fmtPct(pct)}
                        </td>
                        <td className="px-2 py-1.5 text-right" style={{ color: tone(r.chgAbs) }}>
                          {fmtAbs(r.chgAbs)}
                        </td>
                        <td className="px-2 py-1.5 text-right">{fmtPx(r.open)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtPx(r.high)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtPx(r.low)}</td>
                        <td className="px-2 py-1.5 text-right text-[var(--text-secondary)]">
                          {scan === "liquid" && r.dollarVol
                            ? fmtVol(r.dollarVol)
                            : fmtVol(r.volume)}
                        </td>
                        {isBrk ? (
                          <>
                            <td className="px-2 py-1.5 text-right">
                              {(r as BreakoutHit).rsi == null ? "—" : (r as BreakoutHit).rsi?.toFixed(0)}
                            </td>
                            <td className="px-2 py-1.5 text-right">{fmtPx((r as BreakoutHit).priorHigh)}</td>
                          </>
                        ) : null}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="lg:w-[440px] xl:w-[500px] shrink-0 flex flex-col min-h-[420px] lg:min-h-0 bg-[var(--card-bg)]">
          {selected ? (
            <>
              <div className="shrink-0 px-3 py-2 border-b border-[var(--border)]">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-terminal font-bold">{selected.ticker}</div>
                    <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[240px]">
                      {selected.companyName || "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-terminal font-bold">{fmtPx(selected.last)}</div>
                    <div className="text-[10px] font-terminal" style={{ color: tone(selected.chgPct) }}>
                      {fmtPct(selected.chgPct)} · {fmtAbs(selected.chgAbs)}
                    </div>
                  </div>
                </div>
                <div className={`mt-2 grid gap-1 text-center ${isBrk && brkSel ? "grid-cols-7" : "grid-cols-5"}`}>
                  {[
                    ["OPEN", fmtPx(selected.open)],
                    ["HIGH", fmtPx(selected.high)],
                    ["LOW", fmtPx(selected.low)],
                    ["GAP", fmtPct(selected.gapPct)],
                    ["VOL", fmtVol(selected.volume)],
                    ...(isBrk && brkSel
                      ? [
                          ["RSI", brkSel.rsi == null ? "—" : brkSel.rsi.toFixed(0)],
                          ["HH100", fmtPx(brkSel.priorHigh)],
                        ]
                      : []),
                  ].map(([k, v]) => (
                    <div key={k} className="rounded border border-[var(--border)] px-1 py-1">
                      <div className="text-[9px] font-terminal text-[var(--text-muted)] tracking-widest">{k}</div>
                      <div className="text-[10px] font-terminal">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="shrink-0 flex items-center justify-between px-3 py-1 border-b border-[var(--border)]">
                <span className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">
                  {selected.ticker} · {chart?.interval ?? chartTf} · {chart?.source ?? "…"}
                  {chart?.interval === "5m" ? " · Yahoo delayed pre/post" : " · prices_daily"}
                </span>
                <div className="flex gap-1">
                  {(["1d", "5m"] as const).map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => setChartTf(tf)}
                      className={`px-2 py-0.5 text-[10px] font-terminal rounded border ${
                        chartTf === tf
                          ? "border-[var(--accent-info)] text-[var(--accent-info)] bg-[var(--badge-bg)]"
                          : "border-[var(--border)] text-[var(--text-muted)]"
                      }`}
                    >
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="shrink-0">
                <TradingChart
                  candles={chart?.candles ?? []}
                  sma={chart?.interval === "1d" ? chart?.sma20 : undefined}
                  levels={chartLevels}
                  height={260}
                />
              </div>
              <div className="flex-1 min-h-0 overflow-auto border-t border-[var(--border)]">
                <div className="px-3 py-1.5 text-[10px] font-terminal tracking-widest text-[var(--text-muted)] border-b border-[var(--border)]">
                  NEWS · {selected.ticker}
                </div>
                {!news.length ? (
                  <p className="px-3 py-4 text-[10px] font-terminal text-[var(--text-muted)]">
                    No stored headlines for this ticker.
                  </p>
                ) : (
                  <ul>
                    {news.map((n) => (
                      <li key={n.id} className="px-3 py-2 border-b border-[var(--border)]">
                        <div className="text-[9px] font-terminal text-[var(--text-muted)]">
                          {n.publishedAt ? String(n.publishedAt).replace("T", " ").slice(0, 16) : "—"}
                          {n.source ? ` · ${n.source}` : ""}
                        </div>
                        {n.url ? (
                          <a
                            href={n.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent-info)]"
                          >
                            {n.headline ?? "Headline"}
                          </a>
                        ) : (
                          <div className="text-[11px] text-[var(--text-secondary)]">{n.headline ?? "Headline"}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs font-terminal text-[var(--text-muted)] px-4 text-center">
              Select a name to load the daily chart and news.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
