"use client";

export type RrgPoint = {
  name: string;
  rs4w: number | null;
  impulse: number | null;
  label: string | null;
  nNames: number;
};

const QUADRANTS = [
  { key: "leading", title: "LEADING", color: "rgba(34,197,94,0.12)", x: 1, y: 1 },
  { key: "weakening", title: "WEAKENING", color: "rgba(234,179,8,0.12)", x: 1, y: -1 },
  { key: "lagging", title: "LAGGING", color: "rgba(239,68,68,0.12)", x: -1, y: -1 },
  { key: "improving", title: "IMPROVING", color: "rgba(56,189,248,0.12)", x: -1, y: 1 },
] as const;

function quadrant(rs: number, imp: number): string {
  if (rs >= 0 && imp >= 0) return "leading";
  if (rs >= 0 && imp < 0) return "weakening";
  if (rs < 0 && imp < 0) return "lagging";
  return "improving";
}

export function RotationRRG({ points }: { points: RrgPoint[] }) {
  const plotted = points.filter((p) => p.rs4w != null && p.impulse != null);
  if (!plotted.length) {
    return (
      <div className="text-xs text-[var(--text-muted)] font-terminal py-8 text-center">
        No rotation snapshot — run sector rotation compute or open lite desk.
      </div>
    );
  }

  const xs = plotted.map((p) => (p.rs4w ?? 0) * 100);
  const ys = plotted.map((p) => (p.impulse ?? 0) * 100);
  const pad = 0.08;
  const xMin = Math.min(...xs, 0) - pad;
  const xMax = Math.max(...xs, 0) + pad;
  const yMin = Math.min(...ys, 0) - pad;
  const yMax = Math.max(...ys, 0) + pad;
  const w = 480;
  const h = 280;
  const margin = 36;
  const X = (x: number) => margin + ((x - xMin) / (xMax - xMin || 1)) * (w - margin * 2);
  const Y = (y: number) => h - margin - ((y - yMin) / (yMax - yMin || 1)) * (h - margin * 2);
  const midX = X(0);
  const midY = Y(0);

  return (
    <div>
      <p className="text-[10px] text-[var(--text-muted)] font-terminal mb-2 tracking-wider">
        RS 4W vs impulse · median member vs book (diagnostic)
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-h-72 bg-[var(--surface-alt)] rounded border border-[var(--border)]">
        {QUADRANTS.map((q) => {
          const x0 = q.x > 0 ? midX : margin;
          const x1 = q.x > 0 ? w - margin : midX;
          const y0 = q.y > 0 ? margin : midY;
          const y1 = q.y > 0 ? midY : h - margin;
          return (
            <g key={q.key}>
              <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={q.color} />
              <text
                x={(x0 + x1) / 2}
                y={y0 + 12}
                textAnchor="middle"
                fill="var(--text-muted)"
                fontSize="8"
                fontFamily="JetBrains Mono, monospace"
              >
                {q.title}
              </text>
            </g>
          );
        })}
        <line x1={midX} y1={margin} x2={midX} y2={h - margin} stroke="var(--panel-border)" />
        <line x1={margin} y1={midY} x2={w - margin} y2={midY} stroke="var(--panel-border)" />
        {plotted.map((p) => {
          const x = X((p.rs4w ?? 0) * 100);
          const y = Y((p.impulse ?? 0) * 100);
          const q = quadrant(p.rs4w ?? 0, p.impulse ?? 0);
          const fill =
            q === "leading"
              ? "var(--accent-bull)"
              : q === "weakening"
                ? "var(--accent-warning)"
                : q === "lagging"
                  ? "var(--accent-bear)"
                  : "var(--accent-info)";
          return (
            <g key={p.name}>
              <circle cx={x} cy={y} r={5} fill={fill} opacity={0.85} />
              <title>{`${p.name} · ${p.label ?? ""} · ${p.nNames}n`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
