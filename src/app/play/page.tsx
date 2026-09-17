"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TradingChart, type Candle } from "@/components/chart/TradingChart";
import { parseDesk } from "@/lib/deskPayload";
import { recordRecentTicker } from "@/components/command/CommandPalette";
import type { SessionMover } from "@/lib/sessionMovers";

type PlaySummary = {
  asOfDate: string;
  priorDate: string;
  names: number;
  nGainers: number;
  nLosers: number;
  nGappers: number;
};

type PlayData = {
  summary: PlaySummary | null;
  gainers: SessionMover[];
  losers: SessionMover[];
  gappers: SessionMover[];
  liquid: SessionMover[];
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

type ScanId = "gainers" | "losers" | "gappers" | "liquid" | "orb";

type NewsItem = {
  id: string;
  ticker: string;
  publishedAt: string | null;
  source: string | null;
  headline: string | null;
  url: string | null;
};

const SCANS: { id: ScanId; label: string; hint: string }[] = [
  { id: "gainers", label: "Session Gainers", hint: "Close vs prior" },
  { id: "losers", label: "Session Decliners", hint: "Close vs prior" },
  { id: "gappers", label: "Gappers ≥4%", hint: "Open vs prior close" },
  { id: "liquid", label: "Most Active $", hint: "Close × volume" },
  { id: "orb", label: "ORB Watch", hint: "Paper 15m OR book" },
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

export default function PlayPage() {
  const [d, setD] = useState<PlayData | null>(null);
  const [orb, setOrb] = useState<OrbWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState<ScanId>("gainers");
  const [sel, setSel] = useState("");
  const [filter, setFilter] = useState("");
  const [chartTf, setChartTf] = useState<"1d" | "5m">("1d");
  const [chart, setChart] = useState<{
    candles: Candle[];
    sma20?: (number | null)[];
    source: string;
    interval: string;
  } | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);

  useEffect(() => {
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
        setD(desk);
        setOrb(watch);
        const first = desk?.gainers?.[0]?.ticker ?? watch[0]?.ticker ?? "";
        if (first) setSel(first);
      })
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    if (scan === "orb") return orb.map(orbToMover);
    if (!d) return [];
    if (scan === "losers") return d.losers;
    if (scan === "gappers") return d.gappers;
    if (scan === "liquid") return d.liquid;
    return d.gainers;
  }, [d, orb, scan]);

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

  const counts: Record<ScanId, number> = {
    gainers: d?.gainers?.length ?? 0,
    losers: d?.losers?.length ?? 0,
    gappers: d?.gappers?.length ?? 0,
    liquid: d?.liquid?.length ?? 0,
    orb: orb.length,
  };

  const pctHeader = scan === "gappers" || scan === "orb" ? "GAP" : "% CHG";
  const asOf = d?.summary?.asOfDate ?? "—";

  return (
    <div className="flex flex-col h-[calc(100vh-72px)] min-h-[560px]">
      <div className="shrink-0 px-3 py-2 border-b border-[var(--border)] flex flex-wrap items-center gap-x-4 gap-y-1">
        <div>
          <h1 className="text-sm font-terminal font-bold tracking-wider" style={{ color: "var(--accent-warning)" }}>
            STOCKS IN PLAY
          </h1>
          <p className="text-[10px] text-[var(--text-muted)] font-terminal">
            Last session from daily prints · not live pre-market · Yahoo 5m is delayed tape
          </p>
        </div>
        <div className="text-[10px] font-terminal text-[var(--text-secondary)]">
          {d?.headline ?? (loading ? "Loading…" : "No session tape")}
          {d?.stale ? (
            <span className="ml-2" style={{ color: "var(--accent-warning)" }}>
              STALE
            </span>
          ) : null}
        </div>
        <div className="ml-auto text-[10px] font-terminal text-[var(--text-muted)]">
          AS OF {asOf} · PRIOR {d?.summary?.priorDate ?? "—"} · {d?.summary?.names ?? 0} NAMES
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
          <div className="px-3 py-3 text-[10px] text-[var(--text-muted)] font-terminal leading-relaxed">
            ORB stays a strategy tab.{" "}
            <Link href="/orb" className="text-[var(--accent-info)] hover:underline">
              Open ORB
            </Link>
          </div>
        </aside>

        <section className="flex-1 min-w-0 flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-[var(--border)]">
          <div className="shrink-0 px-3 py-1.5 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-alt)]">
            <span className="text-[10px] font-terminal tracking-widest text-[var(--text-muted)]">
              {SCANS.find((s) => s.id === scan)?.label.toUpperCase()} · {shown.length} RESULTS
            </span>
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
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-[var(--text-muted)]">
                      Loading session movers…
                    </td>
                  </tr>
                ) : !shown.length ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-[var(--text-muted)]">
                      {scan === "orb"
                        ? "No ORB watch this session. Run: python -m pipeline.compute.opening_range"
                        : "No names on this scan. Need two daily prints in prices_daily."}
                    </td>
                  </tr>
                ) : (
                  shown.map((r, i) => {
                    const active = r.ticker === selected?.ticker;
                    const pct = scan === "gappers" || scan === "orb" ? r.gapPct : r.chgPct;
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
                          {r.companyName ? (
                            <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[160px]">
                              {r.companyName}
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
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="lg:w-[440px] xl:w-[500px] shrink-0 flex flex-col min-h-0 bg-[var(--card-bg)]">
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
                <div className="mt-2 grid grid-cols-5 gap-1 text-center">
                  {[
                    ["OPEN", fmtPx(selected.open)],
                    ["HIGH", fmtPx(selected.high)],
                    ["LOW", fmtPx(selected.low)],
                    ["GAP", fmtPct(selected.gapPct)],
                    ["VOL", fmtVol(selected.volume)],
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
                  {chart?.interval === "5m" ? " · Yahoo delayed" : " · prices_daily"}
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
                  levels={[]}
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
