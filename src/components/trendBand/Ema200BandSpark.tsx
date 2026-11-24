"use client";

import type { PbEmaSparkBar } from "@/lib/trendBandPullback";

export function Ema200BandSpark({
  bars,
  width = 132,
  height = 44,
}: {
  bars: PbEmaSparkBar[];
  width?: number;
  height?: number;
}) {
  const slice = bars.slice(-48);
  if (slice.length < 6) {
    return <span className="text-[10px] text-[var(--text-muted)]">—</span>;
  }
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const ys: number[] = [];
  for (const b of slice) {
    ys.push(b.close, b.ema200High, b.ema200Low);
  }
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const y = (v: number) => pad + ((max - v) / span) * innerH;
  const x = (i: number) => pad + (i / (slice.length - 1)) * innerW;
  const bull = "var(--accent-bull)";
  const bear = "var(--accent-bear)";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      {slice.map((b, i) => {
        if (i === 0) return null;
        const a = slice[i - 1];
        return (
          <polygon
            key={`${b.date}-${i}`}
            points={`${x(i - 1)},${y(a.ema200High)} ${x(i)},${y(b.ema200High)} ${x(i)},${y(b.ema200Low)} ${x(i - 1)},${y(a.ema200Low)}`}
            fill={b.rising ? bull : bear}
            opacity="0.22"
          />
        );
      })}
      <polyline
        fill="none"
        stroke="var(--text-secondary)"
        strokeWidth="1"
        points={slice.map((b, i) => `${x(i)},${y(b.close)}`).join(" ")}
      />
    </svg>
  );
}