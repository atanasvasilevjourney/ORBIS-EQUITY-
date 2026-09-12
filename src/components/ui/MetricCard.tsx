type MetricCardProps = {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  /** 0–100 optional progress under the value */
  bar?: number;
  barColor?: string;
  className?: string;
};

/** Compact metric tile with optional progress bar (equity-signals style). */
export function MetricCard({
  label,
  value,
  sub,
  color,
  bar,
  barColor,
  className = "",
}: MetricCardProps) {
  const pct = bar != null ? Math.max(0, Math.min(100, bar)) : null;
  return (
    <div
      className={`p-3 rounded border border-[var(--panel-border)] bg-[var(--panel-bg)] ${className}`}
    >
      <div className="text-[9px] font-terminal tracking-widest text-[var(--text-muted)]">
        {label}
      </div>
      <div
        className="text-xl font-terminal font-bold mt-1 leading-none"
        style={{ color: color || undefined }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[10px] text-[var(--text-secondary)] mt-1 truncate">{sub}</div>
      )}
      {pct != null && (
        <div className="mt-2 h-1 rounded-full bg-[var(--gauge-track)] overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              backgroundColor: barColor || color || "var(--accent-info)",
            }}
          />
        </div>
      )}
    </div>
  );
}
