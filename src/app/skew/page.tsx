"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type StrikePt = {
  k: number;
  kPct: number;
  iv: number;
  ivCall: number | null;
  ivPut: number | null;
  oi: number;
  volume: number;
};

type Slice = {
  expiry: string;
  dte: number;
  weekday: number;
  atmIv: number | null;
  putIv: number | null;
  callIv: number | null;
  rr: number | null;
  fly: number | null;
  strikes: StrikePt[];
};

type TermPt = {
  expiry: string;
  dte: number;
  weekday: number;
  atmIv: number | null;
  putIv: number | null;
  callIv: number | null;
};

type SurfaceCell = { expiry: string; dte: number; kPct: number; iv: number };

type Weekend = {
  fridayExpiry: string;
  fridayDte: number;
  fridayIv: number;
  mondayExpiry: string;
  mondayDte: number;
  mondayIv: number;
  calendarDays: number;
  varFriday: number;
  varMonday: number;
  varWeekend: number;
  weekendIv: number;
  weekendRatio: number | null;
  weekendVarShare: number | null;
  note: string;
};

type SkewName = {
  ticker: string;
  companyName: string;
  spot: number | null;
  atmIv: number | null;
  ivTrading: number | null;
  frontDte: number | null;
  frontExpiry: string | null;
  putSkew: number | null;
  callSkew: number | null;
  riskReversal: number | null;
  butterfly: number | null;
  termSlope: number | null;
  weekendIv: number | null;
  weekendRatio: number | null;
  weekendVarShare: number | null;
  nExpiries: number | null;
  slices: Slice[];
  term: TermPt[];
  surface: SurfaceCell[];
  weekend: Weekend | null;
};

type SkewData = {
  summary: {
    names: number | null;
    asOfDate: string | null;
    runId: string;
    lastRunAt: string | null;
    avgAtmIv: number | null;
    avgPutSkew: number | null;
    avgWeekendRatio: number | null;
    weekendRichest: string | null;
    weekendRichestRatio: number | null;
  } | null;
  names: SkewName[];
  headline: string | null;
  stale: boolean;
};

const ivPct = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${(v * 100).toFixed(d)}%`;
const volPts = (v: number | null | undefined) =>
  v == null ? "—" : `${(v * 100).toFixed(1)}`;
const num = (v: number | null | undefined, d = 2) =>
  v == null ? "—" : v.toFixed(d);
const px = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));

function weekdayLabel(n: number) {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][n] ?? "";
}

function polyline(
  pts: { x: number; y: number }[],
  xMin: number, xMax: number, yMin: number, yMax: number,
  w: number, h: number, pad: number
) {
  const xs = xMax === xMin ? 1 : xMax - xMin;
  const ys = yMax === yMin ? 1 : yMax - yMin;
  return pts
    .map((p, i) => {
      const x = pad + ((p.x - xMin) / xs) * (w - pad * 2);
      const y = h - pad - ((p.y - yMin) / ys) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function LineChart({
  series,
  xLabel,
  yFmt,
}: {
  series: { label: string; color: string; pts: { x: number; y: number }[] }[];
  xLabel: string;
  yFmt: (v: number) => string;
}) {
  const w = 520, h = 180, pad = 36;
  const all = series.flatMap((s) => s.pts);
  if (!all.length) {
    return <div className="text-xs text-[var(--text-muted)] font-terminal px-3 py-8 text-center">No points</div>;
  }
  const xMin = Math.min(...all.map((p) => p.x));
  const xMax = Math.max(...all.map((p) => p.x));
  const yMin = Math.min(...all.map((p) => p.y)) * 0.92;
  const yMax = Math.max(...all.map((p) => p.y)) * 1.08;
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-44">
      {yTicks.map((t) => {
        const y = h - pad - ((t - yMin) / (yMax - yMin || 1)) * (h - pad * 2);
        return (
          <g key={t}>
            <line x1={pad} x2={w - pad} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
            <text x={4} y={y + 3} fill="var(--text-muted)" fontSize="9" fontFamily="JetBrains Mono, monospace">
              {yFmt(t)}
            </text>
          </g>
        );
      })}
      <text x={w / 2} y={h - 6} fill="var(--text-muted)" fontSize="9" textAnchor="middle" fontFamily="JetBrains Mono, monospace">
        {xLabel}
      </text>
      {series.map((s) =>
        s.pts.length > 1 ? (
          <path key={s.label} d={polyline(s.pts, xMin, xMax, yMin, yMax, w, h, pad)} fill="none" stroke={s.color} strokeWidth="1.8" />
        ) : null
      )}
    </svg>
  );
}

function Heatmap({ cells }: { cells: SurfaceCell[] }) {
  const dtes = Array.from(new Set(cells.map((c) => c.dte))).sort((a, b) => a - b);
  const ks = Array.from(new Set(cells.map((c) => c.kPct))).sort((a, b) => a - b);
  if (!dtes.length || !ks.length) {
    return <div className="text-xs text-[var(--text-muted)] font-terminal px-3 py-8 text-center">No surface</div>;
  }
  const ivs = cells.map((c) => c.iv);
  const lo = Math.min(...ivs);
  const hi = Math.max(...ivs);
  const tone = (iv: number) => {
    const t = hi === lo ? 0.5 : (iv - lo) / (hi - lo);
    if (t < 0.33) return "var(--accent-bull)";
    if (t < 0.66) return "var(--accent-warning)";
    return "var(--accent-bear)";
  };
  const lookup = new Map(cells.map((c) => [`${c.dte}|${c.kPct}`, c.iv]));
  return (
    <div className="overflow-x-auto">
      <table className="text-[10px] font-terminal">
        <thead>
          <tr>
            <th className="px-1 py-1 text-[var(--text-muted)] text-left">K% \\ DTE</th>
            {dtes.map((d) => (
              <th key={d} className="px-1 py-1 text-[var(--text-muted)] font-normal">{d}d</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ks.map((k) => (
            <tr key={k}>
              <td className="px-1 py-0.5 text-[var(--text-muted)]">{k.toFixed(0)}</td>
              {dtes.map((d) => {
                const iv = lookup.get(`${d}|${k}`);
                return (
                  <td
                    key={d}
                    className="px-1 py-1 text-center"
                    style={{ color: iv == null ? "var(--text-muted)" : tone(iv), backgroundColor: "var(--card-bg)" }}
                    title={iv == null ? "" : `${(iv * 100).toFixed(1)}%`}
                  >
                    {iv == null ? "·" : (iv * 100).toFixed(0)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SkewPage() {
  const [d, setD] = useState<SkewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [ticker, setTicker] = useState<string>("");
  const [expiry, setExpiry] = useState<string>("");

  useEffect(() => {
    fetch("/api/skew")
      .then((r) => r.json())
      .then((data: SkewData) => {
        setD(data);
        const first = data.names?.[0]?.ticker;
        if (first) setTicker(first);
      })
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  const name = d?.names.find((n) => n.ticker === ticker) ?? d?.names[0] ?? null;
  useEffect(() => {
    if (!name) return;
    if (!expiry || !name.slices.some((s) => s.expiry === expiry)) {
      setExpiry(name.slices[0]?.expiry ?? "");
    }
  }, [name, expiry]);

  const slice = name?.slices.find((s) => s.expiry === expiry) ?? name?.slices[0] ?? null;
  const s = d?.summary;

  const skewSeries = useMemo(() => {
    if (!slice) return [];
    const iv = slice.strikes.filter((p) => p.iv != null).map((p) => ({ x: p.kPct, y: p.iv }));
    const puts = slice.strikes.filter((p) => p.ivPut != null).map((p) => ({ x: p.kPct, y: p.ivPut as number }));
    const calls = slice.strikes.filter((p) => p.ivCall != null).map((p) => ({ x: p.kPct, y: p.ivCall as number }));
    return [
      { label: "PAYING", color: "var(--accent-info)", pts: iv },
      { label: "PUT", color: "var(--accent-bear)", pts: puts },
      { label: "CALL", color: "var(--accent-bull)", pts: calls },
    ];
  }, [slice]);

  const termSeries = useMemo(() => {
    if (!name) return [];
    return [
      { label: "ATM", color: "var(--accent-info)", pts: name.term.filter((t) => t.atmIv != null).map((t) => ({ x: t.dte, y: t.atmIv as number })) },
      { label: "10% PUT", color: "var(--accent-bear)", pts: name.term.filter((t) => t.putIv != null).map((t) => ({ x: t.dte, y: t.putIv as number })) },
      { label: "10% CALL", color: "var(--accent-bull)", pts: name.term.filter((t) => t.callIv != null).map((t) => ({ x: t.dte, y: t.callIv as number })) },
    ];
  }, [name]);

  const cards = [
    { label: "NAMES", value: s?.names ?? "—", color: "" },
    { label: "AVG ATM IV", value: ivPct(s?.avgAtmIv), color: "var(--accent-info)" },
    { label: "AVG PUT SKEW", value: s?.avgPutSkew == null ? "—" : volPts(s.avgPutSkew), color: (s?.avgPutSkew ?? 0) > 0 ? "var(--accent-bear)" : "var(--accent-bull)" },
    { label: "WKND RATIO", value: s?.avgWeekendRatio == null ? "—" : `${s.avgWeekendRatio.toFixed(2)}×`, color: "var(--accent-warning)" },
    { label: "RICHEST WKND", value: s?.weekendRichest ?? "—", color: "var(--accent-warning)" },
  ];

  return (
    <div className="px-4 py-6">
      <div className="mb-4">
        <h1 className="text-lg font-terminal font-bold tracking-wider" style={{ color: "var(--accent-info)" }}>
          SKEW MAP
        </h1>
        <p className="text-xs text-[var(--text-secondary)]">
          What listed options traders are paying for — IV vs strike, term, surface, weekend vol
        </p>
      </div>

      {d?.headline && (
        <div className="px-4 py-2 mb-4 rounded border border-[var(--border)] bg-[var(--badge-bg)] text-sm text-[var(--text-secondary)] font-terminal">
          <span style={{ color: "var(--accent-info)" }}>SKEW:</span> {d.headline}
          {s?.asOfDate && (
            <span className="ml-3 text-[var(--text-muted)]" style={{ color: d.stale ? "var(--accent-warning)" : undefined }}>
              as of {s.asOfDate}
            </span>
          )}
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

      <div className="flex flex-wrap gap-1 mb-4">
        {(d?.names ?? []).map((n) => (
          <button
            key={n.ticker}
            onClick={() => setTicker(n.ticker)}
            className={`px-2 py-1 text-xs font-terminal rounded border ${
              name?.ticker === n.ticker
                ? "border-[var(--accent-info)] bg-[var(--badge-bg)] text-[var(--accent-info)]"
                : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {n.ticker}
          </button>
        ))}
      </div>

      {name && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
            {[
              { l: "SPOT", v: px(name.spot) },
              { l: "ATM IV", v: ivPct(name.atmIv), c: "var(--accent-info)" },
              { l: "TD IV", v: ivPct(name.ivTrading) },
              { l: "FRONT", v: name.frontDte == null ? "—" : `${name.frontDte}d` },
              { l: "PUT SKEW", v: volPts(name.putSkew), c: "var(--accent-bear)" },
              { l: "RR 10%", v: volPts(name.riskReversal), c: (name.riskReversal ?? 0) > 0 ? "var(--accent-bear)" : "var(--accent-bull)" },
              { l: "TERM", v: volPts(name.termSlope) },
              { l: "WKND IV", v: ivPct(name.weekendIv), c: "var(--accent-warning)" },
            ].map((x) => (
              <div key={x.l} className="p-2 rounded border border-[var(--border)] bg-[var(--card-bg)]">
                <div className="text-[9px] font-terminal text-[var(--text-muted)] tracking-widest">{x.l}</div>
                <div className="text-sm font-terminal font-bold" style={{ color: x.c }}>{x.v}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest">SKEW SLICE · IV vs STRIKE</h2>
                <div className="flex flex-wrap gap-1">
                  {name.slices.map((sl) => (
                    <button
                      key={sl.expiry}
                      onClick={() => setExpiry(sl.expiry)}
                      className={`px-1.5 py-0.5 text-[10px] font-terminal rounded ${
                        slice?.expiry === sl.expiry
                          ? "bg-[var(--badge-bg)] text-[var(--accent-info)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {sl.dte}d
                    </button>
                  ))}
                </div>
              </div>
              <LineChart series={skewSeries} xLabel={slice ? `${slice.expiry} · ${weekdayLabel(slice.weekday)} · ${slice.dte} DTE · strike % of spot` : "strike %"} yFmt={(v) => `${(v * 100).toFixed(0)}`} />
              <div className="flex gap-3 text-[10px] font-terminal text-[var(--text-muted)] mt-1">
                <span style={{ color: "var(--accent-info)" }}>PAYING</span>
                <span style={{ color: "var(--accent-bear)" }}>PUT IV</span>
                <span style={{ color: "var(--accent-bull)" }}>CALL IV</span>
              </div>
            </div>
            <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3">
              <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">TERM · ATM IV vs DTE</h2>
              <LineChart series={termSeries} xLabel="calendar DTE" yFmt={(v) => `${(v * 100).toFixed(0)}`} />
              <div className="flex gap-3 text-[10px] font-terminal text-[var(--text-muted)] mt-1">
                <span style={{ color: "var(--accent-info)" }}>ATM</span>
                <span style={{ color: "var(--accent-bear)" }}>10% OTM PUT</span>
                <span style={{ color: "var(--accent-bull)" }}>10% OTM CALL</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3">
              <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">SURFACE · MONEYNESS × DTE (IV %)</h2>
              <Heatmap cells={name.surface} />
              <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-2">
                Green = cheap vol vs this name&apos;s surface, red = rich. OTM puts (K% &lt; 100) are crash premium; OTM calls are upside chase.
              </p>
            </div>
            <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3">
              <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">WEEKEND VOL</h2>
              {name.weekend ? (
                <div className="font-terminal text-xs space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[var(--text-muted)]">FRI {name.weekend.fridayExpiry} ({name.weekend.fridayDte}d)</div>
                      <div className="text-[var(--accent-info)]">{ivPct(name.weekend.fridayIv)}</div>
                    </div>
                    <div>
                      <div className="text-[var(--text-muted)]">MON {name.weekend.mondayExpiry} ({name.weekend.mondayDte}d)</div>
                      <div className="text-[var(--accent-info)]">{ivPct(name.weekend.mondayIv)}</div>
                    </div>
                    <div>
                      <div className="text-[var(--text-muted)]">WEEKEND IV</div>
                      <div className="text-lg font-bold" style={{ color: "var(--accent-warning)" }}>{ivPct(name.weekend.weekendIv)}</div>
                    </div>
                    <div>
                      <div className="text-[var(--text-muted)]">vs FRI ATM</div>
                      <div className="text-lg font-bold" style={{ color: "var(--accent-warning)" }}>
                        {name.weekend.weekendRatio == null ? "—" : `${name.weekend.weekendRatio.toFixed(2)}×`}
                      </div>
                    </div>
                  </div>
                  <div className="text-[var(--text-muted)] leading-relaxed">
                    var = IV² × DTE/365 · weekend = var(Mon) − var(Fri) · {name.weekend.calendarDays} calendar days.
                    Trading-day rescale of front ATM: {ivPct(name.ivTrading)} (×√365/252).
                    {(name.weekend.weekendRatio ?? 1) > 1
                      ? " Weekend is rich vs weekday clock — event premium over Sat/Sun."
                      : " Weekend is cheap vs weekday clock — calendar time without trading variance."}
                  </div>
                  <div className="text-[var(--text-muted)]">{name.weekend.note}</div>
                </div>
              ) : (
                <div className="text-xs text-[var(--text-muted)] font-terminal">
                  No Friday→Monday expiry pair on this name (need listed weeklies).
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">CROSS-NAME SKEW</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-4">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-right px-3 py-2">SPOT</th>
              <th className="text-right px-3 py-2">ATM IV</th>
              <th className="text-right px-3 py-2">TD IV</th>
              <th className="text-right px-3 py-2">DTE</th>
              <th className="text-right px-3 py-2">PUT SK</th>
              <th className="text-right px-3 py-2">RR 10%</th>
              <th className="text-right px-3 py-2">FLY</th>
              <th className="text-right px-3 py-2">TERM</th>
              <th className="text-right px-3 py-2">WKND IV</th>
              <th className="text-right px-3 py-2">WKND ×</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.names?.length ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-[var(--text-muted)]">No skew snapshot. Run: python -m pipeline.compute.skew_map</td></tr>
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
                  <td className="px-3 py-2 text-right">{px(r.spot)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--accent-info)" }}>{ivPct(r.atmIv)}</td>
                  <td className="px-3 py-2 text-right">{ivPct(r.ivTrading)}</td>
                  <td className="px-3 py-2 text-right">{r.frontDte ?? "—"}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--accent-bear)" }}>{volPts(r.putSkew)}</td>
                  <td className="px-3 py-2 text-right">{volPts(r.riskReversal)}</td>
                  <td className="px-3 py-2 text-right">{volPts(r.butterfly)}</td>
                  <td className="px-3 py-2 text-right">{volPts(r.termSlope)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--accent-warning)" }}>{ivPct(r.weekendIv)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--accent-warning)" }}>{num(r.weekendRatio)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-3">
        Yahoo listed last/mid inverted to IV (Yahoo's impliedVolatility column is a placeholder when bid/ask are 0). Skew uses OTM puts below spot and OTM calls above.
        10% OTM is a 25-delta-style proxy, not an interpolated 25Δ. Weekend vol isolates Friday→Monday calendar variance.
        Not a calibrated vol model and not investment advice.
      </p>
    </div>
  );
}
