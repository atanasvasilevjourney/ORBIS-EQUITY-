"use client";

import type { PriceBar } from "@/lib/trendDiagnostics";

type Props = {
  candles: PriceBar[];
  emaFast: (number | null)[];
  emaSlow: (number | null)[];
  fastPeriod: number;
  slowPeriod: number;
  symbol: string;
  label: string;
};

type Pt = { x: number; close: number; fast: number | null; slow: number | null };

function finite(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

export function TrendRibbonChart({
  candles,
  emaFast,
  emaSlow,
  fastPeriod,
  slowPeriod,
  symbol,
  label,
}: Props) {
  const width = 860;
  const height = 300;
  const pad = { l: 12, r: 58, t: 16, b: 22 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  const points: Pt[] = candles.map((bar, i) => ({
    x: pad.l + (candles.length <= 1 ? innerW / 2 : (i / (candles.length - 1)) * innerW),
    close: bar.close,
    fast: emaFast[i] ?? null,
    slow: emaSlow[i] ?? null,
  }));

  const ys: number[] = [];
  for (const p of points) {
    ys.push(p.close);
    if (finite(p.fast)) ys.push(p.fast);
    if (finite(p.slow)) ys.push(p.slow);
  }
  const min = ys.length ? Math.min(...ys) : 0;
  const max = ys.length ? Math.max(...ys) : 1;
  const span = max - min || 1;
  const yOf = (v: number) => pad.t + ((max - v) / span) * innerH;

  const last = points[points.length - 1];
  const ribbonUp = finite(last?.fast) && finite(last?.slow) ? last.fast >= last.slow : null;
  const bull = "var(--accent-bull)";
  const bear = "var(--accent-bear)";

  const ticks = [max, (max + min) / 2, min];

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3">
        <div>
          <div className="font-terminal text-[11px] tracking-widest text-[var(--text-muted)]">
            {label.toUpperCase()} · {symbol}
          </div>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">
            EMA {fastPeriod} / {slowPeriod}
            {ribbonUp == null ? "" : ribbonUp ? " · fast above slow" : " · fast below slow"}
          </div>
        </div>
        <div className="font-terminal text-[10px] text-[var(--text-muted)]">
          shaded {fastPeriod}/{slowPeriod} · daily
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label={`${symbol} trend ribbon`}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.l}
              x2={width - pad.r}
              y1={yOf(tick)}
              y2={yOf(tick)}
              stroke="var(--panel-grid)"
              strokeWidth="1"
            />
            <text
              x={width - pad.r + 6}
              y={yOf(tick) + 3}
              fill="var(--text-muted)"
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
            >
              {tick >= 1000 ? tick.toFixed(0) : tick >= 100 ? tick.toFixed(1) : tick.toFixed(2)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          if (i === 0) return null;
          const a = points[i - 1];
          if (!finite(a.fast) || !finite(a.slow) || !finite(p.fast) || !finite(p.slow)) return null;
          const up = p.fast >= p.slow;
          return (
            <polygon
              key={candles[i].date}
              points={`${a.x},${yOf(a.fast)} ${p.x},${yOf(p.fast)} ${p.x},${yOf(p.slow)} ${a.x},${yOf(a.slow)}`}
              fill={up ? bull : bear}
              opacity="0.18"
            />
          );
        })}
        <polyline
          fill="none"
          stroke="var(--text-secondary)"
          strokeWidth="1.2"
          points={points.map((p) => `${p.x},${yOf(p.close)}`).join(" ")}
        />
        <polyline
          fill="none"
          stroke={bull}
          strokeWidth="1.4"
          points={points
            .filter((p) => finite(p.fast))
            .map((p) => `${p.x},${yOf(p.fast as number)}`)
            .join(" ")}
        />
        <polyline
          fill="none"
          stroke={bear}
          strokeWidth="1.4"
          points={points
            .filter((p) => finite(p.slow))
            .map((p) => `${p.x},${yOf(p.slow as number)}`)
            .join(" ")}
        />
      </svg>
    </div>
  );
}
