"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DeskPageHeader } from "@/components/ui/DeskPageHeader";
import { InfoCallout } from "@/components/ui/InfoCallout";
import { MetricStrip } from "@/components/ui/MetricStrip";
import { CorrHeatmap } from "@/components/charts/CorrHeatmap";
import { deskList, parseDesk } from "@/lib/deskPayload";
import type { CorrMatrix } from "@/lib/corr";

type Book = { label: string; annReturn: number | null; annVol: number | null; sharpe: number | null };
type FrontierPt = { annReturn: number; annVol: number; sharpe: number };
type Name = {
  ticker: string;
  companyName: string;
  last: number | null;
  annReturn: number | null;
  annVol: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdown: number | null;
  var95: number | null;
  cvar95: number | null;
  beta: number | null;
  alpha: number | null;
  infoRatio: number | null;
  altmanZ: number | null;
  altmanZone: string | null;
  wEqual: number | null;
  wInvVol: number | null;
  wMinVar: number | null;
  wMaxSharpe: number | null;
};

type Data = {
  summary: {
    names: number | null;
    asOfDate: string | null;
    distressed: number;
    zProxy?: number;
    equalSharpe?: number | null;
    invVol?: number | null;
    maxSharpe: number | null;
    minVol: number | null;
  } | null;
  names: Name[];
  allocations: Record<string, Book> | null;
  frontier: FrontierPt[];
  headline: string | null;
  stale: boolean;
  corr?: CorrMatrix | null;
  lite?: boolean;
};

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const num = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));
const wgt = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

function zoneColor(z: string | null) {
  if (z === "safe") return "var(--accent-bull)";
  if (z === "distress") return "var(--accent-bear)";
  if (z === "grey") return "var(--accent-warning)";
  return "var(--text-muted)";
}

function Frontier({ pts, books }: { pts: FrontierPt[]; books: Record<string, Book> | null }) {
  if (!pts.length) return <div className="text-xs text-[var(--text-muted)] font-terminal px-3 py-8 text-center">No frontier</div>;
  const w = 520, h = 200, pad = 36;
  const xs = pts.map((p) => p.annVol);
  const ys = pts.map((p) => p.annReturn);
  const xMin = Math.min(...xs) * 0.9, xMax = Math.max(...xs) * 1.08;
  const yMin = Math.min(...ys) * 0.9, yMax = Math.max(...ys) * 1.08;
  const X = (x: number) => pad + ((x - xMin) / (xMax - xMin || 1)) * (w - pad * 2);
  const Y = (y: number) => h - pad - ((y - yMin) / (yMax - yMin || 1)) * (h - pad * 2);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${X(p.annVol).toFixed(1)},${Y(p.annReturn).toFixed(1)}`).join(" ");
  const marks: { x: number; y: number; c: string; l: string }[] = [];
  if (books?.minVar && books.minVar.annVol != null && books.minVar.annReturn != null) marks.push({ x: books.minVar.annVol, y: books.minVar.annReturn, c: "var(--accent-info)", l: "MIN VOL" });
  if (books?.maxSharpe && books.maxSharpe.annVol != null && books.maxSharpe.annReturn != null) marks.push({ x: books.maxSharpe.annVol, y: books.maxSharpe.annReturn, c: "var(--text-muted)", l: "IS MAX" });
  if (books?.equal && books.equal.annVol != null && books.equal.annReturn != null) marks.push({ x: books.equal.annVol, y: books.equal.annReturn, c: "var(--accent-info)", l: "1/N" });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-52">
      <path d={line} fill="none" stroke="var(--accent-info)" strokeWidth="1.6" />
      {marks.map((m) => (
        <g key={m.l}>
          <circle cx={X(m.x)} cy={Y(m.y)} r="4" fill={m.c} />
          <text x={X(m.x) + 6} y={Y(m.y) - 6} fill={m.c} fontSize="9" fontFamily="JetBrains Mono, monospace">{m.l}</text>
        </g>
      ))}
      <text x={w / 2} y={h - 6} fill="var(--text-muted)" fontSize="9" textAnchor="middle" fontFamily="JetBrains Mono, monospace">σ annual</text>
    </svg>
  );
}

export default function QuantropyPage() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [book, setBook] = useState<"wEqual" | "wInvVol" | "wMinVar" | "wMaxSharpe">("wEqual");

  useEffect(() => {
    fetch("/api/quantropy")
      .then((r) => r.json())
      .then((raw: unknown) => {
        const parsed = parseDesk<Data>(raw, "names");
        if (parsed) setD(parsed);
        else {
          setD({
            summary: null,
            names: deskList<Name>(raw, "names"),
            allocations: null,
            frontier: [],
            headline: null,
            stale: true,
            corr: null,
          });
        }
      })
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  const s = d?.summary;
  const alloc = d?.allocations;
  const cards = [
    { label: "NAMES", value: s?.names ?? "—", color: "" },
    { label: "EW SHARPE", value: s?.equalSharpe == null ? "—" : s.equalSharpe.toFixed(2), color: "var(--accent-info)" },
    { label: "INV VOL", value: pct(s?.invVol), color: "var(--accent-info)" },
    { label: "Z PROXY", value: s?.zProxy ?? "—", color: "var(--text-secondary)" },
  ];
  const bookKey = book === "wEqual" ? "equal" : book === "wInvVol" ? "invVol" : book === "wMinVar" ? "minVar" : "maxSharpe";
  const weight = (n: Name) => n[book];

  return (
    <div className="py-6">
      <DeskPageHeader
        badge="IN-SAMPLE"
        title="Quantropy"
        subtitle={`Equal-weight and inverse-vol books. Beta is versus the equal-weight peer basket. Altman Z is a ratio proxy.${
          d?.lite ? " Lite correlation from prices_daily." : ""
        }`}
      />

      <InfoCallout title="In-sample desk" variant="warning" accent="var(--accent-warning)">
        <p>
          Equal-weight and inverse-vol are the books on this page. Min-variance and max-Sharpe use the same
          return window, so they stay diagnostic. Beta is versus the equal-weight peers, which include the
          stock. The Z column is a statement proxy (assets inferred as NI/ROA). It is not a safe/distress zone.
        </p>
      </InfoCallout>

      {d?.headline && (
        <div className="headline-banner mb-4">
          <span style={{ color: "var(--accent-info)" }}>Q:</span> {d.headline}
        </div>
      )}

      <MetricStrip items={cards} columns={4} loading={loading} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3">
          <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">MARKOWITZ BULLET · LONG-ONLY</h2>
          <Frontier pts={d?.frontier ?? []} books={alloc ?? null} />
        </div>
        <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3">
          <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">ALLOCATION REGIMES</h2>
          <table className="w-full text-sm font-terminal">
            <thead>
              <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)]">
                <th className="text-left px-2 py-1">BOOK</th>
                <th className="text-right px-2 py-1">E[R]</th>
                <th className="text-right px-2 py-1">σ</th>
                <th className="text-right px-2 py-1">SHARPE</th>
              </tr>
            </thead>
            <tbody>
              {(["equal", "invVol", "minVar", "maxSharpe"] as const).map((k) => {
                const b = alloc?.[k];
                const active = bookKey === k;
                return (
                  <tr
                    key={k}
                    className="border-b border-[var(--border)] cursor-pointer hover:bg-[var(--surface-alt)]"
                    onClick={() => setBook(k === "equal" ? "wEqual" : k === "invVol" ? "wInvVol" : k === "minVar" ? "wMinVar" : "wMaxSharpe")}
                  >
                    <td className="px-2 py-2" style={{ color: active ? "var(--accent-info)" : undefined }}>{b?.label ?? k}</td>
                    <td className="px-2 py-2 text-right">{pct(b?.annReturn)}</td>
                    <td className="px-2 py-2 text-right">{pct(b?.annVol)}</td>
                    <td className="px-2 py-2 text-right font-bold" style={{ color: "var(--accent-warning)" }}>{num(b?.sharpe)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-2">
            Click a regime to highlight weights. Long-only, Σw=1, SLSQP. Cash proxy 4%. Not a live book.
          </p>
        </div>
      </div>

      <div className="mb-6">
        <CorrHeatmap corr={d?.corr} title="CORRELATION MATRIX · DAILY RETURNS" />
      </div>

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">
        NAME RISK · WEIGHTS ({book === "wMaxSharpe" ? "MAX SHARPE" : book === "wMinVar" ? "MIN VAR" : book === "wInvVol" ? "INV VOL" : "1/N"})
      </h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-4">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-right px-3 py-2">W</th>
              <th className="text-right px-3 py-2">RET</th>
              <th className="text-right px-3 py-2">VOL</th>
              <th className="text-right px-3 py-2">SHARPE</th>
              <th className="text-right px-3 py-2">SORTINO</th>
              <th className="text-right px-3 py-2">MAX DD</th>
              <th className="text-right px-3 py-2">VaR 5%</th>
              <th className="text-right px-3 py-2">β</th>
              <th className="text-right px-3 py-2">α</th>
              <th className="text-right px-3 py-2">Z</th>
              <th className="text-left px-3 py-2">Z NOTE</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.names?.length ? (
              <tr><td colSpan={12} className="px-3 py-8 text-center text-[var(--text-muted)]">No snapshot yet. Correlation matrix above still uses overlapping prices_daily when available.</td></tr>
            ) : (
              d.names.map((r) => (
                <tr key={r.ticker} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                  <td className="px-3 py-2">
                    <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]">{r.ticker}</Link>
                  </td>
                  <td className="px-3 py-2 text-right font-bold" style={{ color: "var(--accent-info)" }}>{wgt(weight(r))}</td>
                  <td className="px-3 py-2 text-right" style={{ color: (r.annReturn ?? 0) >= 0 ? "var(--accent-bull)" : "var(--accent-bear)" }}>{pct(r.annReturn)}</td>
                  <td className="px-3 py-2 text-right">{pct(r.annVol)}</td>
                  <td className="px-3 py-2 text-right">{num(r.sharpe)}</td>
                  <td className="px-3 py-2 text-right">{num(r.sortino)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: "var(--accent-bear)" }}>{pct(r.maxDrawdown)}</td>
                  <td className="px-3 py-2 text-right">{pct(r.var95)}</td>
                  <td className="px-3 py-2 text-right">{num(r.beta)}</td>
                  <td className="px-3 py-2 text-right">{pct(r.alpha)}</td>
                  <td className="px-3 py-2 text-right">{num(r.altmanZ)}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: zoneColor(r.altmanZone) }}>{r.altmanZone ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-3">
        Sharpe, Sortino, VaR, CVaR, and max drawdown use the overlapping daily window. Beta and alpha are
        versus the equal-weight peer basket. Z is labeled proxy because total assets, retained earnings, and
        working capital are inferred. Max-Sharpe stays in the table as an in-sample diagnostic.
        Paper analytics — not a broker, not investment advice.
      </p>
    </div>
  );
}
