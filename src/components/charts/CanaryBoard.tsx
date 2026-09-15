"use client";

import type { CanaryVote } from "@/lib/canary";

function voteColor(v: number) {
  if (v > 0) return "var(--accent-bull)";
  if (v < 0) return "var(--accent-bear)";
  return "var(--text-muted)";
}

function Spark({ tape }: { tape?: CanaryVote["tape"] }) {
  const vals = (tape ?? []).map((p) => p.smooth).filter((v): v is number => v != null && Number.isFinite(v));
  if (vals.length < 4) return <span className="text-[var(--text-muted)]">—</span>;
  const w = 140;
  const h = 36;
  const min = Math.min(...vals, -0.25);
  const max = Math.max(...vals, 0.25);
  const Y = (v: number) => 2 + (1 - (v - min) / (max - min || 1)) * (h - 4);
  const X = (i: number) => (i / (vals.length - 1)) * w;
  const d = vals.map((v, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const zero = Y(0);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-36 h-9">
      <line x1="0" x2={w} y1={zero} y2={zero} stroke="var(--border)" />
      <path d={d} fill="none" stroke="var(--accent-info)" strokeWidth="1.4" />
    </svg>
  );
}

function ZBar({ z }: { z: number | null }) {
  const v = z == null ? 0 : Math.max(-3, Math.min(3, z));
  const pct = ((v + 3) / 6) * 100;
  return (
    <div className="relative h-2 w-28 rounded-sm bg-[var(--surface-alt)]">
      <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--border)]" />
      <div
        className="absolute top-0 h-2 w-1.5 rounded-sm"
        style={{
          left: `calc(${pct}% - 3px)`,
          background: v > 0.25 ? "var(--accent-bull)" : v < -0.25 ? "var(--accent-bear)" : "var(--accent-warning)",
        }}
      />
    </div>
  );
}

export type CanaryCard = Pick<CanaryVote, "name" | "pair" | "z" | "smooth" | "vote" | "implication"> & {
  proxy?: boolean;
  tape?: CanaryVote["tape"];
};

export function CanaryBoard({ canaries }: { canaries: CanaryCard[] }) {
  if (!canaries.length) {
    return (
      <p className="text-xs text-[var(--text-muted)] font-terminal px-3 py-8 text-center">
        No canary ratios yet. Need ~126 sessions of sector-basket history.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {canaries.map((c) => (
        <div key={c.name} className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <div className="text-sm font-terminal font-bold">{c.name}</div>
              <div className="text-[10px] text-[var(--text-muted)] font-terminal">{c.pair}{c.proxy ? " · proxy" : ""}</div>
            </div>
            <div className="text-lg font-terminal font-bold" style={{ color: voteColor(c.vote) }}>
              {c.vote > 0 ? "+1" : c.vote < 0 ? "−1" : "0"}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <ZBar z={c.smooth ?? c.z} />
            <Spark tape={c.tape} />
          </div>
          <div className="mt-2 flex justify-between text-[10px] font-terminal text-[var(--text-muted)]">
            <span>z {c.z == null ? "—" : c.z.toFixed(2)}</span>
            <span>smooth {c.smooth == null ? "—" : c.smooth.toFixed(2)}</span>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)] font-terminal">{c.implication}</p>
        </div>
      ))}
    </div>
  );
}
