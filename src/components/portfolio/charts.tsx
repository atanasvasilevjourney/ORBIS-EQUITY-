"use client";

import { useMemo, useState } from "react";
import { layoutTreemap, type FrontierPoint, type MonteCarlo, type Snapshot } from "@/lib/portfolio/engine";
import { pct, shortDate } from "@/components/portfolio/format";

type Pt = { x: number; y: number };

function scales(
  values: number[],
  w: number,
  h: number,
  pad = { l: 46, r: 12, t: 14, b: 26 },
  yPad = 0.08,
) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const lo = min - span * yPad;
  const hi = max + span * yPad;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const x = (i: number, n: number) => pad.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo)) * innerH;
  return { x, y, pad, innerW, innerH, lo, hi, w, h };
}

function linePath(pts: Pt[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

function Grid({ y, ticks, w, pad }: { y: (v: number) => number; ticks: number[]; w: number; pad: { l: number; r: number } }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--panel-grid)" />
          <text x={pad.l - 8} y={y(t) + 3} textAnchor="end" fill="var(--text-muted)" fontSize="10">
            {t >= 1000 ? `$${(t / 1000).toFixed(t >= 10000 ? 0 : 1)}k` : `${(t * 100).toFixed(0)}%`}
          </text>
        </g>
      ))}
    </g>
  );
}

function niceTicks(lo: number, hi: number, money: boolean): number[] {
  const span = hi - lo || 1;
  const raw = span / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => span / s <= 5) ?? raw;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 0.01; v += step) out.push(money ? v : v);
  return out.slice(0, 6);
}

export function GrowthChart({ points }: { points: Snapshot["growth"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 720;
  const h = 280;
  const book = points.map((p) => p.book);
  const world = points.map((p) => p.world);
  const s = scales([...book, ...world], w, h, { l: 52, r: 16, t: 16, b: 28 }, 0.06);
  if (points.length < 2) return <Empty />;
  const bookPts = points.map((p, i) => ({ x: s.x(i, points.length), y: s.y(p.book) }));
  const worldPts = points.map((p, i) => ({ x: s.x(i, points.length), y: s.y(p.world) }));
  const baseY = s.h - s.pad.b;
  const area = `${linePath(bookPts)} L${bookPts[bookPts.length - 1].x} ${baseY} L${bookPts[0].x} ${baseY} Z`;
  const ticks = niceTicks(s.lo, s.hi, true);
  const hi = hover ?? points.length - 1;
  const tip = points[Math.max(0, Math.min(points.length - 1, hi))];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Growth of ten thousand dollars">
      <Grid y={s.y} ticks={ticks} w={w} pad={s.pad} />
      <path d={area} fill="#3b82f6" opacity="0.12" />
      <path d={linePath(worldPts)} fill="none" stroke="#94a3b8" strokeWidth="1.4" strokeDasharray="4 4" />
      <path d={linePath(bookPts)} fill="none" stroke="#3b82f6" strokeWidth="2" />
      <text x={s.pad.l} y={h - 8} fill="var(--text-muted)" fontSize="10">{shortDate(points[0].date)}</text>
      <text x={w - s.pad.r} y={h - 8} textAnchor="end" fill="var(--text-muted)" fontSize="10">{shortDate(points[points.length - 1].date)}</text>
      {tip && (
        <g>
          <line x1={s.x(hi, points.length)} x2={s.x(hi, points.length)} y1={s.pad.t} y2={h - s.pad.b} stroke="#93c5fd" strokeDasharray="2 3" />
          <circle cx={s.x(hi, points.length)} cy={s.y(tip.book)} r="3.5" fill="#3b82f6" />
        </g>
      )}
      <rect
        x={s.pad.l}
        y={s.pad.t}
        width={s.innerW}
        height={s.innerH}
        fill="transparent"
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const rel = (e.clientX - box.left) / box.width;
          setHover(Math.round(rel * (points.length - 1)));
        }}
        onMouseLeave={() => setHover(null)}
      />
      {tip && (
        <g>
          {(() => {
            const tipW = 156;
            const anchor = s.x(hi, points.length);
            const tipX = anchor > w * 0.62 ? Math.max(s.pad.l, anchor - tipW - 10) : Math.min(anchor + 8, w - tipW - 8);
            return (
              <>
                <rect x={tipX} y={18} width={tipW} height="46" rx="8" fill="var(--card-bg)" stroke="var(--panel-border)" />
                <text x={tipX + 10} y={36} fill="var(--text-muted)" fontSize="10">{shortDate(tip.date)}</text>
                <text x={tipX + 10} y={54} fill="#93c5fd" fontSize="12">{usdCompact(tip.book)} · world {usdCompact(tip.world)}</text>
              </>
            );
          })()}
        </g>
      )}
    </svg>
  );
}

function usdCompact(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(2)}k`;
  return `$${n.toFixed(0)}`;
}

export function StackedWeights({ rows }: { rows: Snapshot["weights"] }) {
  const total = rows.reduce((s, r) => s + r.weight, 0) || 1;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-[var(--track)]">
        {rows.map((r) => (
          <div key={r.symbol} style={{ width: `${((r.weight / total) * 100).toFixed(2)}%`, background: r.color }} title={`${r.symbol} ${r.weight.toFixed(1)}%`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {rows.map((r) => (
          <span key={r.symbol} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
            <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
            {r.symbol} {r.weight.toFixed(0)}%
          </span>
        ))}
      </div>
    </div>
  );
}

export function Donut({ slices }: { slices: { label: string; weight: number; color: string }[] }) {
  const r = 68;
  const c = 2 * Math.PI * r;
  const total = slices.reduce((s, x) => s + x.weight, 0) || 1;
  let offset = 0;
  const arcs = slices.map((s) => {
    const len = (s.weight / total) * c;
    const arc = { ...s, len, offset };
    offset += len;
    return arc;
  });
  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <svg viewBox="0 0 180 180" className="w-44 h-44 shrink-0" role="img" aria-label="Allocation donut">
        <circle cx="90" cy="90" r={r} fill="none" stroke="var(--track)" strokeWidth="18" />
        {arcs.map((a) => (
          <circle
            key={a.label}
            cx="90"
            cy="90"
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth="18"
            strokeDasharray={`${a.len} ${c - a.len}`}
            strokeDashoffset={-a.offset}
            transform="rotate(-90 90 90)"
          />
        ))}
      </svg>
      <ul className="w-full space-y-1.5">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-[12px]">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="flex-1 text-[var(--text-secondary)] truncate">{s.label}</span>
            <span className="font-terminal text-[var(--text-primary)]">{s.weight.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HBars({
  rows,
  suffix = "%",
}: {
  rows: { label: string; value: number; flag?: string; color?: string }[];
  suffix?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[112px_1fr_52px] items-center gap-2 text-[13px]">
          <div className="flex items-center gap-1.5 text-[var(--text-secondary)] truncate">
            {r.flag ? <span aria-hidden>{r.flag}</span> : null}
            <span className="truncate">{r.label}</span>
          </div>
          <div className="h-2.5 rounded-full bg-[var(--track)] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${((r.value / max) * 100).toFixed(2)}%`, background: r.color ?? "#3b82f6" }} />
          </div>
          <div className="text-right font-terminal text-[var(--text-primary)]">{r.value.toFixed(1)}{suffix}</div>
        </div>
      ))}
    </div>
  );
}

export function CorrGrid({
  symbols,
  matrix,
  onPin,
  pinned,
}: {
  symbols: string[];
  matrix: number[][];
  pinned: [string, string] | null;
  onPin: (pair: [string, string]) => void;
}) {
  if (symbols.length < 2) return <Empty label="Add a second stock to read correlation." />;
  return (
    <div className="overflow-x-auto">
      <div
        className="grid w-full gap-1"
        style={{ gridTemplateColumns: `56px repeat(${symbols.length}, minmax(42px, 1fr))` }}
      >
        <span />
        {symbols.map((s) => (
          <span key={s} className="text-center text-[10px] font-terminal text-[var(--text-muted)]">{s}</span>
        ))}
        {symbols.map((row, i) => (
          <div key={row} className="contents">
            <span className="text-[10px] font-terminal text-[var(--text-muted)] self-center">{row}</span>
            {symbols.map((col, j) => {
              const v = matrix[i][j];
              const diag = i === j;
              const active = pinned && ((pinned[0] === row && pinned[1] === col) || (pinned[0] === col && pinned[1] === row));
              return (
                <button
                  key={col}
                  type="button"
                  onClick={() => onPin([row, col])}
                  className="h-9 rounded-md text-[11px] font-terminal"
                  style={{
                    background: diag ? "rgba(148,163,184,0.18)" : corrColor(v),
                    color: "white",
                    outline: active ? "1px solid white" : "none",
                  }}
                  aria-label={`${row} and ${col} correlation ${v.toFixed(2)}`}
                >
                  {v.toFixed(2)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function corrColor(v: number): string {
  const t = Math.max(0, Math.min(1, (v - 0.3) / 0.65));
  return `rgba(244, 63, 94, ${0.28 + t * 0.68})`;
}

function shortSector(label: string): string {
  const map: Record<string, string> = {
    "Information Technology": "Technology",
    "Consumer Discretionary": "Discretionary",
    "Communication Services": "Communication",
    "Consumer Staples": "Staples",
    "Health Care": "Health Care",
  };
  return map[label] ?? label;
}

export function Treemap({ slices }: { slices: Snapshot["sectors"] }) {
  const rects = useMemo(
    () => layoutTreemap(slices.map((s) => ({ key: s.label, value: s.weight })), 0, 0, 640, 280),
    [slices],
  );
  const color = Object.fromEntries(slices.map((s) => [s.label, s.color]));
  if (!rects.length) return <Empty />;
  return (
    <svg viewBox="0 0 640 280" className="w-full h-auto rounded-xl" role="img" aria-label="Sector treemap">
      {rects.map((r) => (
        <g key={r.key}>
          <rect x={r.x + 2} y={r.y + 2} width={Math.max(0, r.w - 4)} height={Math.max(0, r.h - 4)} rx="8" fill={color[r.key] ?? "#3b82f6"} opacity="0.9" />
          {r.w > 64 && r.h > 36 && (
            <>
              <text x={r.x + 12} y={r.y + 24} fill="white" fontSize="12" fontWeight="600">
                {shortSector(r.key)}
              </text>
              <text x={r.x + 12} y={r.y + 42} fill="white" opacity="0.85" fontSize="12">
                {r.value.toFixed(1)}%
              </text>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

export function FactorBars({ rows }: { rows: Snapshot["factors"] }) {
  const max = Math.max(0.4, ...rows.map((r) => Math.abs(r.beta)));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="grid grid-cols-[42px_1fr_92px] items-center gap-2 text-[12px]">
          <span className="font-terminal text-[var(--text-muted)]">{r.id}</span>
          <div className="relative h-3">
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--panel-border)]" />
            <div
              className="absolute top-1 h-2 rounded-sm"
              style={{
                background: r.beta >= 0 ? "#3b82f6" : "#a78bfa",
                width: `${(Math.abs(r.beta) / max) * 50}%`,
                left: r.beta >= 0 ? "50%" : `${50 - (Math.abs(r.beta) / max) * 50}%`,
              }}
            />
          </div>
          <span className="font-terminal text-right text-[var(--text-secondary)]">
            {r.beta.toFixed(2)} · t {r.t.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function RollingChart({ points }: { points: Snapshot["rolling"] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <Empty />;
  const w = 720;
  const h = 220;
  const vals = points.map((p) => p.vol);
  const s = scales(vals, w, h, { l: 46, r: 12, t: 12, b: 26 }, 0.1);
  const pts = points.map((p, i) => ({ x: s.x(i, points.length), y: s.y(p.vol) }));
  const hi = hover ?? points.length - 1;
  const tip = points[hi];
  const ticks = niceTicks(Math.max(0, s.lo), s.hi, false).filter((t) => t >= 0);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Rolling volatility">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={s.pad.l} x2={w - s.pad.r} y1={s.y(t)} y2={s.y(t)} stroke="var(--panel-grid)" />
          <text x={s.pad.l - 6} y={s.y(t) + 3} textAnchor="end" fill="var(--text-muted)" fontSize="10">{(t * 100).toFixed(0)}%</text>
        </g>
      ))}
      <path d={linePath(pts)} fill="none" stroke="#60a5fa" strokeWidth="2" />
      <text x={s.pad.l} y={h - 6} fill="var(--text-muted)" fontSize="10">{shortDate(points[0].date)}</text>
      <text x={w - s.pad.r} y={h - 6} textAnchor="end" fill="var(--text-muted)" fontSize="10">{shortDate(points[points.length - 1].date)}</text>
      {tip && <circle cx={s.x(hi, points.length)} cy={s.y(tip.vol)} r="3.5" fill="#93c5fd" />}
      <rect
        x={s.pad.l}
        y={s.pad.t}
        width={s.innerW}
        height={s.innerH}
        fill="transparent"
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setHover(Math.round(((e.clientX - box.left) / box.width) * (points.length - 1)));
        }}
        onMouseLeave={() => setHover(null)}
      />
    </svg>
  );
}

export function CalendarChart({ rows }: { rows: Snapshot["calendar"] }) {
  if (!rows.length) return <Empty />;
  const w = 640;
  const h = 220;
  const vals = rows.flatMap((r) => [r.book, r.world]);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const pad = { l: 44, r: 10, t: 12, b: 28 };
  const innerH = h - pad.t - pad.b;
  const y = (v: number) => pad.t + ((max - v) / (max - min || 1)) * innerH;
  const zero = y(0);
  const slot = (w - pad.l - pad.r) / rows.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Calendar returns">
      <line x1={pad.l} x2={w - pad.r} y1={zero} y2={zero} stroke="var(--panel-border)" />
      <text x={pad.l - 6} y={y(max) + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10">{pct(max, 0)}</text>
      <text x={pad.l - 6} y={y(min) + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10">{pct(min, 0)}</text>
      {rows.map((r, i) => {
        const cx = pad.l + i * slot + slot / 2;
        const bh = Math.abs(y(r.book) - zero);
        const wh = Math.abs(y(r.world) - zero);
        return (
          <g key={r.year}>
            <rect x={cx - 14} y={Math.min(y(r.world), zero)} width="8" height={Math.max(1, wh)} fill="#64748b" rx="2" />
            <rect x={cx - 4} y={Math.min(y(r.book), zero)} width="12" height={Math.max(1, bh)} fill={r.book >= 0 ? "#22c55e" : "#ef4444"} rx="2" />
            <text x={cx} y={h - 8} textAnchor="middle" fill="var(--text-muted)" fontSize="10">{r.year}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function MonthHeat({ rows }: { rows: Snapshot["months"] }) {
  const letters = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-[11px] font-terminal">
        <thead>
          <tr>
            <th />
            {letters.map((l, i) => (
              <th key={i} className="font-normal text-[var(--text-muted)]">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.year}>
              <td className="pr-2 text-[var(--text-muted)]">{row.year}</td>
              {row.values.map((v, i) => (
                <td
                  key={i}
                  className="h-8 min-w-[38px] rounded-md text-center"
                  style={{ background: heat(v), color: v != null && Math.abs(v) > 0.045 ? "white" : "var(--text-secondary)" }}
                >
                  {v == null ? "" : (v * 100).toFixed(1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function heat(v: number | null): string {
  if (v == null) return "transparent";
  const mag = Math.min(1, Math.abs(v) / 0.1);
  return v >= 0 ? `rgba(34,197,94,${0.16 + mag * 0.75})` : `rgba(239,68,68,${0.16 + mag * 0.75})`;
}

export function HistChart({ dist }: { dist: Snapshot["distribution"] }) {
  const bins = dist.bins;
  if (!bins.length) return <Empty />;
  const max = Math.max(...bins.map((b) => b.count));
  const w = 640;
  const h = 180;
  const pad = { l: 8, r: 8, t: 10, b: 22 };
  const slot = (w - pad.l - pad.r) / bins.length;
  const y = (c: number) => pad.t + (1 - c / (max || 1)) * (h - pad.t - pad.b);
  const xOf = (v: number) => {
    const min = bins[0].x0;
    const maxX = bins[bins.length - 1].x1;
    return pad.l + ((v - min) / (maxX - min || 1)) * (w - pad.l - pad.r);
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Return distribution">
      {bins.map((b, i) => (
        <rect
          key={i}
          x={pad.l + i * slot + 1}
          y={y(b.count)}
          width={Math.max(1, slot - 2)}
          height={Math.max(0, h - pad.b - y(b.count))}
          fill={b.x1 <= dist.var95 ? "#fb7185" : "#3b82f6"}
          opacity="0.9"
          rx="2"
        />
      ))}
      <line x1={xOf(dist.var95)} x2={xOf(dist.var95)} y1={pad.t} y2={h - pad.b} stroke="#fda4af" strokeDasharray="3 3" />
      <text x={8} y={h - 6} fill="var(--text-muted)" fontSize="10">{pct(bins[0].x0, 1)}</text>
      <text x={w - 8} y={h - 6} textAnchor="end" fill="var(--text-muted)" fontSize="10">{pct(bins[bins.length - 1].x1, 1)}</text>
    </svg>
  );
}

export function DrawdownChart({ points }: { points: Snapshot["drawdown"] }) {
  if (points.length < 2) return <Empty />;
  const w = 720;
  const h = 200;
  const vals = points.map((p) => p.dd);
  const min = Math.min(...vals, -0.05);
  const pad = { l: 46, r: 12, t: 12, b: 24 };
  const y = (v: number) => pad.t + ((0 - v) / (0 - min)) * (h - pad.t - pad.b);
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (w - pad.l - pad.r);
  const pts = points.map((p, i) => ({ x: x(i), y: y(p.dd) }));
  const d = `${linePath(pts)} L${pts[pts.length - 1].x} ${y(0)} L${pts[0].x} ${y(0)} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Drawdown">
      <line x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} stroke="var(--panel-border)" />
      <text x={pad.l - 6} y={y(min) + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10">{pct(min, 0)}</text>
      <path d={d} fill="rgba(244,63,94,0.18)" />
      <path d={linePath(pts)} fill="none" stroke="#fb7185" strokeWidth="1.7" />
      <text x={pad.l} y={h - 6} fill="var(--text-muted)" fontSize="10">{shortDate(points[0].date)}</text>
      <text x={w - pad.r} y={h - 6} textAnchor="end" fill="var(--text-muted)" fontSize="10">{shortDate(points[points.length - 1].date)}</text>
    </svg>
  );
}

export function ScatterChart({
  points,
  you,
  world,
}: {
  points: Snapshot["scatter"];
  you: Snapshot["you"];
  world: Snapshot["world"];
}) {
  const all = [...points.map((p) => p.vol), you.vol, world.vol];
  const rets = [...points.map((p) => p.ret), you.ret, world.ret];
  const w = 640;
  const h = 280;
  const pad = { l: 46, r: 16, t: 16, b: 28 };
  const minX = Math.min(...all) * 0.85;
  const maxX = Math.max(...all) * 1.08;
  const minY = Math.min(0, ...rets);
  const maxY = Math.max(...rets) * 1.12;
  const x = (v: number) => pad.l + ((v - minX) / (maxX - minX || 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + ((maxY - v) / (maxY - minY || 1)) * (h - pad.t - pad.b);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Risk versus return">
      <text x={pad.l} y={14} fill="var(--text-muted)" fontSize="10">return ↑</text>
      <text x={w - pad.r} y={h - 8} textAnchor="end" fill="var(--text-muted)" fontSize="10">vol →</text>
      {points.map((p) => (
        <g key={p.symbol}>
          <circle cx={x(p.vol)} cy={y(p.ret)} r="5" fill={p.color} />
          <text x={x(p.vol) + 7} y={y(p.ret) - 6} fill="var(--text-secondary)" fontSize="10">{p.symbol}</text>
        </g>
      ))}
      <circle cx={x(world.vol)} cy={y(world.ret)} r="5" fill="#94a3b8" />
      <text x={x(world.vol) + 7} y={y(world.ret) + 12} fill="#94a3b8" fontSize="10">WORLD</text>
      <circle cx={x(you.vol)} cy={y(you.ret)} r="7" fill="#3b82f6" stroke="white" strokeWidth="1.5" />
      <text x={x(you.vol) + 10} y={y(you.ret) + 4} fill="#93c5fd" fontSize="11" fontWeight="600">YOU</text>
    </svg>
  );
}

export function FrontierChart({
  cloud,
  you,
  picked,
}: {
  cloud: FrontierPoint[];
  you: { vol: number; ret: number };
  picked: FrontierPoint | null;
}) {
  if (cloud.length < 5) return <Empty label="Add at least two stocks to sample a frontier." />;
  const vols = cloud.map((p) => p.vol).concat(you.vol);
  const rets = cloud.map((p) => p.ret).concat(you.ret);
  const w = 640;
  const h = 260;
  const pad = { l: 46, r: 12, t: 16, b: 26 };
  const minX = Math.min(...vols) * 0.92;
  const maxX = Math.max(...vols) * 1.04;
  const minY = Math.min(...rets);
  const maxY = Math.max(...rets);
  const x = (v: number) => pad.l + ((v - minX) / (maxX - minX || 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + ((maxY - v) / (maxY - minY || 1)) * (h - pad.t - pad.b);
  const best = cloud.reduce((a, b) => (a.sharpe > b.sharpe ? a : b));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Efficient frontier">
      {cloud.map((p, i) => (
        <circle key={i} cx={x(p.vol)} cy={y(p.ret)} r="2.2" fill="#64748b" opacity="0.55" />
      ))}
      <circle cx={x(best.vol)} cy={y(best.ret)} r="5" fill="#22c55e" />
      <text x={x(best.vol) + 6} y={y(best.ret) - 6} fill="#86efac" fontSize="10">MAX SHARPE</text>
      {picked && <circle cx={x(picked.vol)} cy={y(picked.ret)} r="5" fill="#f59e0b" />}
      <circle cx={x(you.vol)} cy={y(you.ret)} r="6" fill="#3b82f6" stroke="white" strokeWidth="1.2" />
      <text x={x(you.vol) + 8} y={y(you.ret) + 4} fill="#93c5fd" fontSize="11">YOU</text>
      <text x={w - pad.r} y={h - 6} textAnchor="end" fill="var(--text-muted)" fontSize="10">vol →</text>
    </svg>
  );
}

export function FanChart({ mc }: { mc: MonteCarlo }) {
  const bands = mc.bands;
  if (bands.length < 2) return <Empty />;
  const w = 640;
  const h = 240;
  const vals = bands.flatMap((b) => [b.p5, b.p95]);
  const s = scales(vals, w, h, { l: 52, r: 12, t: 12, b: 22 }, 0.05);
  const n = bands.length;
  const top = (key: "p95" | "p75" | "p50") => bands.map((b, i) => ({ x: s.x(i, n), y: s.y(b[key]) }));
  const bot = (key: "p5" | "p25") => bands.map((b, i) => ({ x: s.x(i, n), y: s.y(b[key]) }));
  const ribbon = (hi: Pt[], lo: Pt[]) => `${linePath(hi)} ${[...lo].reverse().map((p) => `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")} Z`;
  return (
    <svg viewBox={`0 0 ${s.w} ${s.h}`} className="w-full h-auto" role="img" aria-label="Monte Carlo fan">
      <path d={ribbon(top("p95"), bot("p5"))} fill="rgba(59,130,246,0.15)" />
      <path d={ribbon(top("p75"), bot("p25"))} fill="rgba(59,130,246,0.28)" />
      <path d={linePath(top("p50"))} fill="none" stroke="#60a5fa" strokeWidth="2" />
      <text x={s.pad.l - 6} y={s.y(s.hi) + 8} textAnchor="end" fill="var(--text-muted)" fontSize="10">{usdCompact(s.hi)}</text>
      <text x={s.pad.l - 6} y={s.y(s.lo)} textAnchor="end" fill="var(--text-muted)" fontSize="10">{usdCompact(Math.max(0, s.lo))}</text>
    </svg>
  );
}

export function Spark({ values, color = "#fb7185" }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const w = 120;
  const h = 36;
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * w,
    y: 4 + ((max - v) / (max - min || 1)) * (h - 8),
  }));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-[120px] h-9" aria-hidden>
      <path d={linePath(pts)} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function Empty({ label = "Not enough history in this window." }: { label?: string }) {
  return <p className="text-[12px] text-[var(--text-muted)] py-8 text-center">{label}</p>;
}
