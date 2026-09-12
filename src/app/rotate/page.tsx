"use client";

import { useEffect, useMemo, useState } from "react";
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
  aligned: boolean;
  parentSector: string | null;
};

type Canary = {
  name: string;
  pair: string;
  z: number | null;
  smooth: number | null;
  vote: number;
  implication: string;
  proxy: boolean;
};

type Trigger = {
  ticker: string;
  sector: string;
  industry: string;
  ensemble: number | null;
  nLong: number | null;
  nCfg: number | null;
  triggered: string | null;
  temaSide: string | null;
  temaGrade: string | null;
  macdAction: string | null;
  aligned: boolean;
  groupLabel: string | null;
};

type Carver = {
  ticker: string;
  sector: string;
  industry: string;
  forecast: number | null;
  parentForecast: number | null;
  sleeveForecast: number | null;
  xsScore: number | null;
  xsRank: number | null;
  sleeveRank: number | null;
  unlocked: number;
  rungs: number;
  weight: number | null;
  notional: number | null;
  side: string;
  action: string;
  aligned: boolean;
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
    canaryScore: number | null;
    canaryOn: number | null;
    canaryOff: number | null;
    nTriggers: number | null;
    nCarver: number | null;
    carverRungs: number | null;
  } | null;
  sectors: Group[];
  industries: Group[];
  canaries: Canary[];
  triggers: Trigger[];
  carver: Carver[];
  headline: string | null;
  stale: boolean;
};

const pct = (v: number | null | undefined, d = 0) =>
  v == null ? "—" : `${(v * 100).toFixed(d)}%`;
const num = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));
const usd = (v: number | null | undefined) =>
  v == null ? "—" : `$${Math.round(v).toLocaleString()}`;

function labelColor(l: string | null) {
  if (l === "LEAD") return "var(--accent-bull)";
  if (l === "ACCEL" || l === "REPAIR") return "var(--accent-info)";
  if (l === "FADE") return "var(--accent-warning)";
  return "var(--accent-bear)";
}

function regimeColor(r: string | null) {
  if (r?.includes("RISK-ON")) return "var(--accent-bull)";
  if (r?.includes("RISK-OFF")) return "var(--accent-bear)";
  return "var(--accent-warning)";
}

function actionColor(a: string) {
  if (a === "ADD") return "var(--accent-bull)";
  if (a === "ROTATE") return "var(--accent-info)";
  if (a === "TRIM") return "var(--accent-warning)";
  return "var(--text-muted)";
}

function Rungs({ n, max = 4 }: { n: number; max?: number }) {
  return (
    <span className="tracking-tight" title={`${n}/${max} D-rungs`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} style={{ color: i < n ? "var(--accent-bull)" : "var(--text-muted)" }}>{i < n ? "■" : "□"}</span>
      ))}
    </span>
  );
}

function voteColor(v: number) {
  if (v > 0) return "var(--accent-bull)";
  if (v < 0) return "var(--accent-bear)";
  return "var(--text-muted)";
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

function TemaSleeveRows({
  sleeve,
  rows,
  sector,
  showHeader,
}: {
  sleeve: string;
  rows: Trigger[];
  sector: string | null;
  showHeader: boolean;
}) {
  return (
    <>
      {showHeader && (
        <tr className="bg-[var(--surface-alt)]">
          <td colSpan={8} className="px-3 py-1 text-[10px] tracking-widest" style={{ color: "var(--accent-info)" }}>
            {(sector ?? rows[0]?.sector ?? "").toUpperCase()} → {sleeve.toUpperCase()}
          </td>
        </tr>
      )}
      {rows.map((t) => (
        <tr key={t.ticker} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
          <td className="px-3 py-2">
            <Link href={`/ticker/${t.ticker}`} className="font-bold hover:text-[var(--accent-info)]">{t.ticker}</Link>
            {t.aligned && <span className="ml-2 text-[10px] font-bold" style={{ color: "var(--accent-bull)" }}>ALIGNED</span>}
          </td>
          <td className="px-3 py-2 text-xs">{t.sector}</td>
          <td className="px-3 py-2 text-xs">{t.industry}</td>
          <td className="px-3 py-2 font-bold" style={{ color: t.triggered === "LONG" ? "var(--accent-bull)" : "var(--accent-bear)" }}>{t.triggered} {pct(t.ensemble, 0)}</td>
          <td className="px-3 py-2 text-right text-xs">{t.nLong ?? 0}/{t.nCfg ?? 0}</td>
          <td className="px-3 py-2" style={{ color: t.temaSide === "BUY" ? "var(--accent-bull)" : t.temaSide === "SELL" ? "var(--accent-bear)" : "var(--text-muted)" }}>{t.temaSide} {t.temaGrade}</td>
          <td className="px-3 py-2" style={{ color: t.macdAction === "CLOSE" ? "var(--accent-bear)" : "var(--accent-bull)" }}>{t.macdAction}</td>
          <td className="px-3 py-2 text-xs" style={{ color: labelColor(t.groupLabel) }}>{t.groupLabel ?? "—"}</td>
        </tr>
      ))}
    </>
  );
}

function GroupTable({
  rows,
  kind,
  selected,
  onSelect,
}: {
  rows: Group[];
  kind: string;
  selected?: string | null;
  onSelect?: (name: string) => void;
}) {
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
          {rows.map((r) => {
            const active = selected === r.name;
            return (
              <tr
                key={`${r.groupType}-${r.name}`}
                className={`border-b border-[var(--border)] ${onSelect ? "cursor-pointer" : ""} hover:bg-[var(--surface-alt)]`}
                style={active ? { background: "rgba(56, 189, 248, 0.12)" } : undefined}
                onClick={() => onSelect?.(r.name)}
              >
                <td className="px-3 py-2">
                  <span className="font-bold">{r.name}</span>
                  <span className="text-[var(--text-muted)] ml-2 text-xs">{r.nNames}n · {r.bucket}</span>
                  {r.aligned && <span className="ml-2 text-[10px] font-bold" style={{ color: "var(--accent-bull)" }}>ALIGNED</span>}
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
                    <Link key={t} href={`/ticker/${t}`} className="mr-2 hover:text-[var(--accent-info)]" onClick={(e) => e.stopPropagation()}>{t}</Link>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function RotatePage() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [sector, setSector] = useState<string | null>("Energy");
  const [industry, setIndustry] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/rotate")
      .then((r) => r.json())
      .then(setD)
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, []);

  const nested = useMemo(() => {
    const map: Record<string, Group[]> = {};
    for (const g of d?.industries ?? []) {
      const parent = g.parentSector || "Other";
      if (!map[parent]) map[parent] = [];
      map[parent].push(g);
    }
    Object.keys(map).forEach((key) => {
      map[key].sort((a: Group, b: Group) => Number(b.aligned) - Number(a.aligned) || (b.score ?? 0) - (a.score ?? 0));
    });
    return map;
  }, [d]);

  const parentOrder = useMemo(() => {
    const names = (d?.sectors ?? []).map((s) => s.name);
    Object.keys(nested).forEach((key) => {
      if (!names.includes(key)) names.push(key);
    });
    return names;
  }, [d, nested]);

  const visibleParents = sector ? parentOrder.filter((p) => p === sector) : parentOrder;

  const sleeveCarver = useMemo(() => {
    let rows = d?.carver ?? [];
    if (sector) rows = rows.filter((t) => t.sector === sector);
    if (industry) rows = rows.filter((t) => t.industry === industry);
    return rows;
  }, [d, sector, industry]);

  const sleeveTriggers = useMemo(() => {
    let rows = d?.triggers ?? [];
    if (sector) rows = rows.filter((t) => t.sector === sector);
    if (industry) rows = rows.filter((t) => t.industry === industry);
    return rows;
  }, [d, sector, industry]);

  const temaGroups = useMemo(() => {
    const map: Record<string, Trigger[]> = {};
    for (const t of sleeveTriggers) {
      const key = t.industry || "Other";
      if (!map[key]) map[key] = [];
      map[key].push(t);
    }
    return Object.entries(map);
  }, [sleeveTriggers]);

  const s = d?.summary;
  const cards = [
    { label: "REGIME", value: s?.regime ?? "—", color: regimeColor(s?.regime ?? null) },
    { label: "CANARIES", value: s?.canaryOn == null ? "—" : `${s.canaryOn}↑ ${s.canaryOff ?? 0}↓`, color: "var(--accent-info)" },
    { label: "ALIGNED TEMA", value: (d?.triggers ?? []).filter((t) => t.aligned && t.triggered === "LONG").length, color: "var(--accent-bull)" },
    { label: "CARVER ADD", value: (d?.carver ?? []).filter((t) => t.action === "ADD").length, color: "var(--accent-bull)" },
    { label: "D-RUNGS", value: s?.carverRungs ?? "—", color: "var(--accent-info)" },
  ];

  const path = [sector, industry].filter(Boolean).join(" › ") || "all sectors";

  function pickSector(name: string) {
    if (sector === name && !industry) {
      setSector(null);
      return;
    }
    setSector(name);
    setIndustry(null);
  }

  function pickIndustry(name: string) {
    setIndustry((cur) => (cur === name ? null : name));
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-4">
        <h1 className="text-lg font-terminal font-bold tracking-wider" style={{ color: "var(--accent-info)" }}>
          MACRO → SECTOR → SUB-SECTOR → ASSET · CARVER DCA
        </h1>
        <p className="text-xs text-[var(--text-secondary)]">
          Canaries decide WHERE, the nest decides WHICH sleeve, Carver D-rungs size HOW MUCH as DCA on the bigger trend · paper only
        </p>
      </div>

      <div className="px-4 py-3 mb-4 rounded border border-[var(--border)] bg-[var(--badge-bg)] text-xs text-[var(--text-secondary)] font-terminal space-y-1">
        <p>
          <span style={{ color: "var(--accent-info)" }}>FLOW:</span>{" "}
          Click a sector to open its sub-sectors, then a sleeve. TEMA-MACD is the WHEN. Carver D1–D4 are discrete
          partials unlocked by the parent-sector EWMAC (|f| 5 / 10 / 15 / 20). Those rungs rotate into the leading
          sub-sector and its top names (Strategy 19-lite). Isolated from the PERPS Carver book.
        </p>
        <p>
          ADD = DCA onto the bigger trend. ROTATE = the same rungs belong to a hotter sleeve. ALIGNED = group trend
          matches the canary regime. Not investment advice.
        </p>
      </div>

      {d?.headline && (
        <div className="px-4 py-2 mb-4 rounded border border-[var(--border)] bg-[var(--card-bg)] text-sm text-[var(--text-secondary)] font-terminal">
          <span style={{ color: "var(--accent-info)" }}>ROTATE:</span> {d.headline}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4 text-xs font-terminal">
        <button
          type="button"
          onClick={() => { setSector(null); setIndustry(null); }}
          className="px-2 py-1 rounded border border-[var(--border)]"
          style={{ background: !sector ? "rgba(56, 189, 248, 0.15)" : "var(--card-bg)", color: "var(--text-secondary)" }}
        >
          ALL SECTORS
        </button>
        {sector && (
          <button
            type="button"
            onClick={() => setIndustry(null)}
            className="px-2 py-1 rounded border border-[var(--border)]"
            style={{ background: !industry ? "rgba(56, 189, 248, 0.15)" : "var(--card-bg)", color: "var(--accent-info)" }}
          >
            {sector}
          </button>
        )}
        {industry && (
          <span className="px-2 py-1 rounded border border-[var(--border)]" style={{ color: "var(--accent-bull)" }}>
            {industry}
          </span>
        )}
      </div>

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

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">1 · MACRO CONTEXT · CANARY VOTES</h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">CANARY</th>
              <th className="text-left px-3 py-2">PROXY</th>
              <th className="text-center px-3 py-2">VOTE</th>
              <th className="text-right px-3 py-2">Z</th>
              <th className="text-right px-3 py-2">SMOOTH</th>
              <th className="text-left px-3 py-2">IMPLICATION</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !d?.canaries?.length ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-[var(--text-muted)]">No canaries. Re-run sector_rotation after migration 016.</td></tr>
            ) : (
              d.canaries.map((c) => (
                <tr key={c.name} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                  <td className="px-3 py-2 font-bold">{c.name}</td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{c.pair}{c.proxy ? " · proxy" : ""}</td>
                  <td className="px-3 py-2 text-center font-bold" style={{ color: voteColor(c.vote) }}>{c.vote > 0 ? "+1" : c.vote < 0 ? "−1" : "0"}</td>
                  <td className="px-3 py-2 text-right">{num(c.z, 2)}</td>
                  <td className="px-3 py-2 text-right">{num(c.smooth, 2)}</td>
                  <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{c.implication}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">2 · ROTATION · CLICK A SECTOR TO OPEN ITS SLEEVES</h2>
      {loading ? (
        <p className="text-[var(--text-muted)] font-terminal px-3 py-8 text-center">Loading…</p>
      ) : !d?.sectors?.length ? (
        <p className="text-[var(--text-muted)] font-terminal px-3 py-8 text-center">Empty. Run: python -m pipeline.compute.sector_rotation</p>
      ) : (
        <GroupTable rows={d.sectors} kind="SECTOR" selected={sector} onSelect={pickSector} />
      )}

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">
        2b · SUB-SECTORS · {sector ? `${sector.toUpperCase()} → ${ (nested[sector] ?? []).map((g) => g.name).join(" / ") || "—" }` : "EVERY SECTOR NEST"}
      </h2>
      {loading ? null : !d?.industries?.length ? (
        <p className="text-[var(--text-muted)] font-terminal px-3 py-8 text-center">No sub-sectors. Re-seed sleeves then re-run sector_rotation.</p>
      ) : (
        visibleParents.map((parent) => {
          const kids = nested[parent] ?? [];
          if (!kids.length) return (
            <p key={parent} className="text-[var(--text-muted)] font-terminal px-3 py-4 text-sm">
              {parent} has no industry sleeves in this universe.
            </p>
          );
          return (
            <div key={parent}>
              {!sector && (
                <h3 className="text-[11px] font-terminal tracking-widest mb-2 px-1" style={{ color: "var(--accent-info)" }}>
                  {parent.toUpperCase()} · {kids.length} sleeves
                </h3>
              )}
              <GroupTable rows={kids} kind="SUB-SECTOR" selected={industry} onSelect={pickIndustry} />
            </div>
          );
        })
      )}

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">
        3 · TEMA ENSEMBLE · {path.toUpperCase()}
      </h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">SECTOR</th>
              <th className="text-left px-3 py-2">SUB-SECTOR</th>
              <th className="text-left px-3 py-2">ENSEMBLE</th>
              <th className="text-right px-3 py-2">GRID</th>
              <th className="text-left px-3 py-2">TEMA 9/99/199</th>
              <th className="text-left px-3 py-2">MACD CLOSE</th>
              <th className="text-left px-3 py-2">GROUP</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !sleeveTriggers.length ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--text-muted)]">No TEMA-MACD ensemble hits in {path}.</td></tr>
            ) : (
              temaGroups.map(([sleeve, rows]) => (
                <TemaSleeveRows
                  key={sleeve}
                  sleeve={sleeve}
                  rows={rows}
                  sector={sector}
                  showHeader={!industry}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">
        4 · CARVER DCA · {path.toUpperCase()} · D-RUNGS ON THE BIGGER TREND
      </h2>
      <div className="overflow-x-auto rounded border border-[var(--border)] mb-6">
        <table className="w-full text-sm font-terminal">
          <thead>
            <tr className="text-[10px] text-[var(--text-muted)] tracking-widest border-b border-[var(--border)] bg-[var(--surface-alt)]">
              <th className="text-left px-3 py-2">TICKER</th>
              <th className="text-left px-3 py-2">SECTOR → SLEEVE</th>
              <th className="text-left px-3 py-2">ACTION</th>
              <th className="text-left px-3 py-2">D-RUNGS</th>
              <th className="text-right px-3 py-2">PARENT f</th>
              <th className="text-right px-3 py-2">NAME f</th>
              <th className="text-right px-3 py-2">XS</th>
              <th className="text-right px-3 py-2">WEIGHT</th>
              <th className="text-right px-3 py-2">NOTIONAL</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-[var(--text-muted)]">Loading…</td></tr>
            ) : !sleeveCarver.length ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-[var(--text-muted)]">No Carver tape in {path}. Re-run sector_rotation after migration 018.</td></tr>
            ) : (
              sleeveCarver.map((r) => (
                <tr key={r.ticker} className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)]">
                  <td className="px-3 py-2">
                    <Link href={`/ticker/${r.ticker}`} className="font-bold hover:text-[var(--accent-info)]">{r.ticker}</Link>
                    {r.aligned && <span className="ml-2 text-[10px] font-bold" style={{ color: "var(--accent-bull)" }}>ALIGNED</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.sector} → {r.industry}
                    <span className="text-[var(--text-muted)]"> · sleeve #{r.sleeveRank} · xs #{r.xsRank}</span>
                  </td>
                  <td className="px-3 py-2 font-bold" style={{ color: actionColor(r.action) }}>{r.action} {r.side !== "FLAT" ? r.side : ""}</td>
                  <td className="px-3 py-2"><Rungs n={r.rungs} /> <span className="text-[10px] text-[var(--text-muted)]">{r.rungs}/{r.unlocked}</span></td>
                  <td className="px-3 py-2 text-right" style={{ color: (r.parentForecast ?? 0) >= 0 ? "var(--accent-bull)" : "var(--accent-bear)" }}>{num(r.parentForecast, 1)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: (r.forecast ?? 0) >= 0 ? "var(--accent-bull)" : "var(--accent-bear)" }}>{num(r.forecast, 1)}</td>
                  <td className="px-3 py-2 text-right">{pct(r.xsScore, 1)}</td>
                  <td className="px-3 py-2 text-right">{pct(r.weight, 1)}</td>
                  <td className="px-3 py-2 text-right">{usd(r.notional)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-3">
        Current = 20d up-name share · Momentum = 60d · Carver D-rungs = parent EWMAC 5/10/15/20 ·
        XS = 60d return minus sleeve mean. Demo tape is synthetic. Isolated from PERPS. Not investment advice.
      </p>
    </div>
  );
}
