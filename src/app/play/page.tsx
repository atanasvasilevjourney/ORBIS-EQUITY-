"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OvernightMover } from "@/lib/overnightGaps";
import type { BreakoutHit } from "@/lib/breakoutScan";
import { parseDesk } from "@/lib/deskPayload";
import { recordRecentTicker } from "@/components/command/CommandPalette";
import type { SessionMover } from "@/lib/sessionMovers";
import { cashClock, overnightWatchStep, type CashClock } from "@/lib/cashSession";
import { chartHref, playScanTimeframe } from "@/lib/chartDesk";

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
  overnightSource?: "lse" | "yahoo" | null;
};

type LiveTape = {
  configured: boolean;
  streaming: boolean;
  source: string;
  names: number;
};

type LiveQuote = {
  last: number;
  bid: number | null;
  ask: number | null;
  ts: string | null;
  replay?: boolean;
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
  live?: LiveTape;
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

const SCANS: { id: ScanId; label: string; hint: string }[] = [
  { id: "overnight", label: "Overnight Gaps", hint: "LSE last vs closed session" },
  { id: "breakout", label: "Breakout 100D", hint: "close > HH(close,100)[1]" },
  { id: "breakout5m", label: "Breakout 100·5m", hint: "same logic on LSE vault 5m" },
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

function withLiveLast<T extends SessionMover>(row: T, q: LiveQuote | undefined): T {
  if (!q || !(q.last > 0)) return row;
  const prev = row.prevClose > 0 ? row.prevClose : row.last;
  const gapPct = prev > 0 ? q.last / prev - 1 : row.gapPct;
  return {
    ...row,
    last: q.last,
    chgPct: gapPct,
    chgAbs: q.last - prev,
    gapPct,
  };
}

function rankClientBreakouts(rows: BreakoutHit[], sort: "volume" | "rsi"): BreakoutHit[] {
  const copy = [...rows];
  if (sort === "rsi") copy.sort((a, b) => (b.rsi ?? -1) - (a.rsi ?? -1));
  else copy.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  return copy;
}

export default function PlayPage() {
  const router = useRouter();
  const [d, setD] = useState<PlayData | null>(null);
  const [orb, setOrb] = useState<OrbWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState<CashClock>(() => cashClock());
  const [scan, setScan] = useState<ScanId>(() => (cashClock().watchOvernight ? "overnight" : "gainers"));
  const [sel, setSel] = useState("");
  const [filter, setFilter] = useState("");
  const [brkSort, setBrkSort] = useState<"volume" | "rsi">("volume");
  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveQuote>>({});

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

  useEffect(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    const add = (t?: string) => {
      const s = (t || "").toUpperCase();
      if (!s || seen.has(s)) return;
      seen.add(s);
      names.push(s);
    };
    add(sel);
    const overnight = d?.overnight ?? [];
    for (let i = 0; i < overnight.length && names.length < 40; i++) add(overnight[i].ticker);
    if (!names.length) return;
    let cancelled = false;
    const load = () => {
      fetch(`/api/quotes?symbols=${names.map(encodeURIComponent).join(",")}`)
        .then((r) => r.json())
        .then((body) => {
          if (cancelled) return;
          const next: Record<string, LiveQuote> = {};
          const rows = Array.isArray(body?.quotes) ? body.quotes : [];
          for (let i = 0; i < rows.length; i++) {
            const q = rows[i];
            const last = Number(q?.last);
            if (!q?.symbol || !(last > 0)) continue;
            next[String(q.symbol).toUpperCase()] = {
              last,
              bid: q.bid == null ? null : Number(q.bid),
              ask: q.ask == null ? null : Number(q.ask),
              ts: q.ts ?? q.updated_at ?? null,
              replay: Boolean(q.replay),
            };
          }
          setLiveQuotes(next);
        })
        .catch(() => {});
    };
    load();
    const id = window.setInterval(load, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [sel, d?.overnight]);

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
    const mapped = rows.map((r) =>
      scan === "overnight" ? withLiveLast(r, liveQuotes[r.ticker]) : r
    );
    if (!q) return mapped;
    return mapped.filter(
      (r) => r.ticker.includes(q) || r.companyName.toUpperCase().includes(q)
    );
  }, [rows, filter, liveQuotes, scan]);

  useEffect(() => {
    if (!shown.length) return;
    if (!shown.some((r) => r.ticker === sel)) setSel(shown[0].ticker);
  }, [shown, sel]);

  const selected = shown.find((r) => r.ticker === sel) ?? shown[0] ?? null;

  function openChart(ticker: string) {
    if (!ticker) return;
    recordRecentTicker(ticker);
    router.push(chartHref(ticker, { tf: playScanTimeframe(scan), from: "play" }));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const idx = Number(e.key);
      if (idx >= 1 && idx <= SCANS.length) {
        e.preventDefault();
        const next = SCANS[idx - 1];
        setScan(next.id);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (sel) openChart(sel);
        return;
      }
      if (e.key === "j" || e.key === "J" || e.key === "ArrowDown") {
        e.preventDefault();
        if (!shown.length) return;
        const i = Math.max(0, shown.findIndex((r) => r.ticker === sel));
        const next = shown[Math.min(shown.length - 1, i + 1)];
        if (next) setSel(next.ticker);
        return;
      }
      if (e.key === "k" || e.key === "K" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!shown.length) return;
        const i = Math.max(0, shown.findIndex((r) => r.ticker === sel));
        const next = shown[Math.max(0, i - 1)];
        if (next) setSel(next.ticker);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, sel, scan, router]);

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-3 py-2 border-b border-[var(--border)] flex flex-wrap items-center gap-x-4 gap-y-1">
        <div>
          <h1 className="text-sm font-terminal font-bold tracking-wider" style={{ color: "var(--accent-warning)" }}>
            STOCKS IN PLAY
          </h1>
          <p className="text-[10px] text-[var(--text-muted)] font-terminal">
            Click a ticker (or Enter) to open CHART · j/k moves the row · not TOS Level-1
          </p>
        </div>
        <div className="text-[10px] font-terminal text-[var(--text-secondary)]">
          {d?.headline ?? (loading ? "Loading…" : "No session tape")}
          {d?.stale ? (
            <span className="ml-2" style={{ color: "var(--accent-warning)" }}>
              EOD STALE
            </span>
          ) : null}
          {d?.live?.streaming ? (
            <span className="ml-2 font-bold" style={{ color: "var(--accent-bull)" }}>
              LSE LAST-PRINT
            </span>
          ) : d?.live?.configured ? (
            <span className="ml-2" style={{ color: "var(--accent-warning)" }}>
              LSE IDLE
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
            {d?.summary?.overnightSource ? ` · TAPE ${d.summary.overnightSource.toUpperCase()}` : ""}
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        <aside className="lg:w-48 shrink-0 border-b lg:border-b-0 lg:border-r border-[var(--border)] bg-[var(--surface)] overflow-y-auto">
          <div className="px-3 py-2 text-[10px] font-terminal tracking-widest text-[var(--text-muted)]">
            SCANS · 1–8 · J/K ROW · ENTER CHART
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

        <section className="flex-1 min-w-0 flex flex-col min-h-0">
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
                  <th className="text-left px-2 py-1.5">SRC</th>
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
                    <td colSpan={isBrk ? 12 : 10} className="px-3 py-10 text-center text-[var(--text-muted)]">
                      Loading session movers…
                    </td>
                  </tr>
                ) : !shown.length ? (
                  <tr>
                    <td colSpan={isBrk ? 12 : 10} className="px-3 py-10 text-center text-[var(--text-muted)]">
                      {scan === "orb"
                        ? "No ORB watch this session. Run: python -m pipeline.compute.opening_range"
                        : scan === "overnight"
                          ? "No LSE last-prints vs the closed session yet. Run python -m pipeline.ingest.lse_live. Yahoo spark is fallback only when the websocket is idle."
                          : isBrk
                          ? "No close above the prior 100-bar high with last ≥ $1 and volume ≥ 1M. Sub-$1 runners (TRUG) are excluded. LSE vault 5m, not Thinkorswim."
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
                        onClick={() => {
                          setSel(r.ticker);
                          openChart(r.ticker);
                        }}
                      >
                        <td className="px-2 py-1.5 text-right text-[var(--text-muted)]">{i + 1}</td>
                        <td className="px-2 py-1.5">
                          <span
                            className="font-bold"
                            style={{ color: active ? "var(--accent-warning)" : undefined }}
                          >
                            {r.ticker}
                          </span>
                          {(r.companyName || (scan === "overnight" && overnight.orbEligible)) ? (
                            <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[160px]">
                              {r.companyName}
                              {scan === "overnight" && overnight.orbEligible ? `${r.companyName ? " · " : ""}ORB ≥4%` : ""}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-[var(--text-muted)]">
                          {scan === "overnight"
                            ? (overnight.source ?? d?.summary?.overnightSource ?? "tape").toUpperCase()
                            : isBrk && (r as BreakoutHit).tf === "5m"
                              ? "5M"
                              : "EOD"}
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
      </div>
    </div>
  );
}
