type PostureGaugeProps = {
  value: number | null;
  label?: string | null;
  size?: number;
};

/** Semi-circle posture gauge — risk appetite / market weather. */
export function PostureGauge({ value, label, size = 160 }: PostureGaugeProps) {
  const v = value ?? 50;
  const color =
    v >= 55 ? "var(--accent-bull)" : v <= 45 ? "var(--accent-bear)" : "var(--accent-info)";

  const r = 56;
  const cx = 80;
  const cy = 78;
  const stroke = 10;
  // Semi-circle path length
  const circ = Math.PI * r;
  const filled = (Math.max(0, Math.min(100, v)) / 100) * circ;

  return (
    <div className="flex flex-col items-center justify-center">
      <svg width={size} height={size * 0.72} viewBox="0 0 160 115" aria-label={`Posture ${v}`}>
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="var(--gauge-track)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circ}`}
        />
        <text
          x={cx}
          y={cy - 8}
          textAnchor="middle"
          fill={color}
          style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 28, fontWeight: 700 }}
        >
          {value ?? "—"}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fill="var(--text-muted)"
          style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 9, letterSpacing: "0.12em" }}
        >
          POSTURE
        </text>
      </svg>
      {label && (
        <div className="text-xs font-terminal tracking-wide" style={{ color }}>
          {label}
        </div>
      )}
    </div>
  );
}
