"use client";

type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
};

export function SparklineCell({ data, width = 80, height = 24 }: SparklineProps) {
  if (!data || data.length < 2) return <span className="text-[var(--text-muted)]">—</span>;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  const trending = data[data.length - 1] >= data[0];
  const color = trending ? "var(--sparkline-up)" : "var(--sparkline-down)";

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
