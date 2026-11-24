"use client";

import type { PbEmaSparkBar } from "@/lib/trendBandPullback";

type Props = {
  bars: PbEmaSparkBar[];
  timeframe: string;
  symbol: string;
  label: string;
};

export function Ema200BandChart({ bars, timeframe, symbol, label }: Props) {
  const width = 860;
  const height = 300;
  const pad = { l: 12, r: 58, t: 16, b: 22 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  const points = bars.map((bar, i) => ({
    x: pad.l + (bars.length <= 1 ? innerW / 2 : (i / (bars.length - 1)) * innerW),
    close: bar.close,
    hi: bar.ema200High,
    lo: bar.ema200Low,
    rising: bar.rising,
  }));

  const ys: number[] = [];
  for (const p of points) {
    ys.push(p.close, p.hi, p.lo);
  }
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const yOf = (v: number) => pad.t + ((max - v) / span) * innerH;
  const bull = "var(--accent-bull)";
  const bear = "var(--accent-bear)";
  const last = points[points.length - 1];

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3">
        <div>
          <div className="font-terminal text-[11px] tracking-widest text-[var(--text-muted)]">
            {label.toUpperCase()} · {symbol} · {timeframe.toUpperCase()}
          </div>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5">
            EMA200 high / EMA200 low{last?.rising ? " · band rising" : " · band falling"}
          </div>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label={`${symbol} EMA200 band`}>
        {points.map((p, i) => {
          if (i === 0) return null;
          const a = points[i - 1];
          return (
            <polygon
              key={i}
              points={`${a.x},${yOf(a.hi)} ${p.x},${yOf(p.hi)} ${p.x},${yOf(p.lo)} ${a.x},${yOf(a.lo)}`}
              fill={p.rising ? bull : bear}
              opacity="0.2"
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
          strokeWidth="1.3"
          points={points.map((p) => `${p.x},${yOf(p.hi)}`).join(" ")}
        />
        <polyline
          fill="none"
          stroke={bear}
          strokeWidth="1.3"
          points={points.map((p) => `${p.x},${yOf(p.lo)}`).join(" ")}
        />
      </svg>
    </div>
  );
}