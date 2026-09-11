"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Group = {
  groupType: string;
  name: string;
  nNames: number;
  tickers: string[];
  currentBreadth: number | null;
  momBreadth: number | null;
  valueBreadth: number | null;
  lowvolBreadth: number | null;
  avgTrend: number | null;
  impulse: number | null;
  beta60: number | null;
  rs4w: number | null;
  stretchPct: number | null;
  label: string | null;
  score: number | null;
  bucket: string | null;
  heatmap: (number | null)[];
  leaders: string[];
};

type Data = {
  summary: {
    names: number | null;
    nSectors: number | null;
    nIndustries: number | null;
    regime: string | null;
    asOfDate: string | null;
    leading: number;
    fading: number;
  } | null;
  sectors: Group[];
  industries: Group[];
  headline: string | null;
  stale: boolean;
};

const pct = (v: number | null | undefined, d = 0) =>
  v == null ? "—" : `${(v * 100).toFixed(d)}%`;
const num = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

function labelColor(l: string | null) {
  if (l === "LEAD") return "var(--accent-bull)";
  if (l === "ACCEL" || l === "REPAIR") return "var(--accent-info)";
  if (l === "FADE") return "var(--accent-warning)";
  return "var(--accent-bear)";
}

function regimeColor(r: string | null) {
  if (r === "RISK-ON") return "var(--accent-bull)";
  if (r === "RISK-OFF") return "var(--accent-bear)";
  return "var(--accent-warning)";
}

function heatColor(v: number | null) {
  if (v == null) return "var(--surface-alt)";
  if (v > 0.02) return "rgba(34, 197, 94, 0.85)";
  if (v > 0) return "rgba(34, 197, 94, 0.45)";
  if (v < -0.02) return "rgba(239, 68, 68, 0.85)";
  if (v < 0) return "rgba(239, 68, 68, 0.45)";
  return "var(--surface-alt)";
}

function Heat({ values }: { values: (number | null)[] }) {
  return (
    <div className="flex gap-0.5">
      {values.map((v, i) => (
        <span
          key={i}
          title={v == null ? "—" : `${(v * 100).toFixed(1)}%`}
          className="inline-block w-3 h-4 rounded-sm"
          style={{ background: heatColor(v) }}
        />
      ))}
    </div>
  );
}

function GroupTable({ rows, kind }: { rows: Group[]; kind: string }) {
  return (
    <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
      <table className="w-full text-sm font-terminal">
        <thead>
          <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
            <th className="text-left px-3 py-2">{kind}</th>
            <th className="text-left px-3 py-2">TREND</th>
            <th className="text-right px-3 py-2">CUR</th>
            <th className="text-right px-3 py-2">MOM</th>
            <th className="text-right px-3 py-2">VAL</th>
            <th className="text-right px-3 py-2">LV</th>
            <th className="text-right px-3 py-2">β 60</th>
            <th className="text-right px-3 py-2">RS 4W</th>
            <th className="text-right px-3 py-2">IMPULSE</th>
            <th className="text-right px-3 py-2">STRETCH</th>
            <th className="text-left px-3 py-2">8W</th>
            <th className="text-left px-3 py-2">LEADERS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.groupType}-${r.name}`} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
              <td className="px-3 py-2">
                <span className="font-bold">{r.name}</span>
                <span className="text-[var(--text-muted)] ml-2 text-xs">{r.nNames}n · {r.bucket}</span>
              </td>
              <td className="px-3 py-2 font-bold" style={{ color: labelColor(r.label) }}>{r.label}</td>
              <td className="px-3 py-2 text-right">{pct(r.currentBreadth, 0)}</td>
              <td className="px-3 py-2 text-right">{pct(r.momBreadth, 0)}</td>
              <td className="px-3 py-2 text-right">{pct(r.valueBreadth, 0)}</td>
              <td className="px-3 py-2 text-right">{pct(r.lowvolBreadth, 0)}</td>
              <td className="px-3 py-2 text-right">{num(r.beta60, 2)}</td>
              <td className="px-3 py-2 text-right" style={{ color: (r.rs4w ?? 0) >= 0 ? "var(--accent-bull)" : "var(--accent-bear)" }}>{pct(r.rs4w, 1)}</td>
              <td className="px-3 py-2 text-right" style={{ color: (r.impulse ?? 0) >= 0 ? "var(--accent-bull)" : "var(--accent-bear)" }}>{pct(r.impulse, 1)}</td>
              <td className="px-3 py-2 text-right">{pct(r.stretchPct, 0)}</td>
              <td className="px-3 py-2"><Heat values={r.heatmap} /></td>
              <td className="px-3 py-2 text-xs">
                {r.leaders.map((t) => (
                  <Link key={t} href={`/ticker/${t}`} className="mr-2 hover:text-[var(--accent-info)]">{t}</Link>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RotatePage() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/rotate")
      .then((r) => r.json())
      .then(setD)
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  const s = d?.summary;
  const cards = [
    { label: "REGIME", value: s?.regime ?? "—", color: regimeColor(s?.regime ?? null) },
    { label: "LEADING", value: s?.leading ?? "—", color: "var(--accent-bull)" },
    { label: "FADING", value: s?.fading ?? "—", color: "var(--accent-bear)" },
    { label: "SECTORS", value: s?.nSectors ?? "—", color: "var(--accent-info)" },
    { label: "INDUSTRIES", value: s?.nIndustries ?? "—", color: "var(--accent-warning)" },
  ];

  return (
    <div className="px-4 py-6">
      <div className="mb-4">
        <h1 className="text-lg font-terminal font-bold tracking-wider" style={{ color: "var(--accent-info)" }}>
          BETA ROTATION
        </h1>
        <p className="text-xs text-[var(--text-secondary)]">
          Which sectors and industries are trending — breadth, impulse, 60-day beta, 8-week heatmap · paper only
        </p>
      </div>

      <div className="px-4 py-3 mb-4 rounded border border-[var(--border)] bg-[var(--badge-bg)] text-xs text-[var(--text-secondary)] font-terminal space-y-1">
        <p>
          <span style={{ color: "var(--accent-info)" }}>CALTROPIA MAP:</span>{" "}
          Structure follows the Caltropia 2026 sector &amp; industry outlook (current / momentum / value / low-vol
          breadth, weekly impulse, upside stretch) plus a 60-day OLS beta vs the equal-weight universe. RISK-ON when
          cyclicals lead on 4-week relative strength; RISK-OFF when defensives do. Computed on this universe — we do
          not ingest their published numbers.
        </p>
        <p>
          LEAD = breadth ≥ 65% and impulse not falling. FADE = strong breadth losing speed. REPAIR = weak breadth
          turning up. ACCEL = improving but not yet leadership. 8W is oldest → newest weekly equal-weight return.
          Not investment advice.
        </p>
      </div>

      {d?.headline && (
        <div className="px-4 py-2 mb-4 rounded border border-[var(--border)] bg-[var(--card-bg)] text-sm text-[var(--text-secondary)] font-terminal">
          <span style={{ color: "var(--accent-info)" }}>ROTATE:</span> {d.headline}
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

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">SECTORS · RANKED BY TREND SCORE</h2>
      {loading ? (
        <p className="text-[var(--text-muted)] font-terminal px-3 py-8 text-center">Loading…</p>
      ) : !d?.sectors?.length ? (
        <p className="text-[var(--text-muted)] font-terminal px-3 py-8 text-center">Empty. Run: python -m pipeline.compute.sector_rotation</p>
      ) : (
        <GroupTable rows={d.sectors} kind="SECTOR" />
      )}

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">INDUSTRIES · WHERE THE SECTOR TAPE HIDES</h2>
      {loading ? null : !d?.industries?.length ? (
        <p className="text-[var(--text-muted)] font-terminal px-3 py-8 text-center">No industries.</p>
      ) : (
        <GroupTable rows={d.industries} kind="INDUSTRY" />
      )}

      <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-3">
        Current = 20d up-name share · Momentum = 60d · Value = value-score ≥ 50 · Low-vol = 20d σ below universe median ·
        β vs equal-weight universe, 60d. Demo tape is synthetic. Not investment advice.
      </p>
    </div>
  );
}
