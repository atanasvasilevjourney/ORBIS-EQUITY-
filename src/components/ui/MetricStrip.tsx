type MetricItem = {
  label: string;
  value: string | number;
  color?: string;
};

export function MetricStrip({
  items,
  columns = 5,
  loading,
}: {
  items: MetricItem[];
  columns?: 4 | 5 | 6;
  loading?: boolean;
}) {
  const colClass =
    columns === 4
      ? "md:grid-cols-4"
      : columns === 6
        ? "md:grid-cols-6"
        : "md:grid-cols-5";
  return (
    <div className={`grid grid-cols-2 ${colClass} gap-3 mb-4`}>
      {items.map((c) => (
        <div key={c.label} className="glass-metric">
          <div className="text-[10px] font-terminal text-[var(--text-muted)] tracking-widest">
            {c.label}
          </div>
          <div
            className="text-lg font-terminal font-bold mt-1 tabular-nums"
            style={{ color: c.color || undefined }}
          >
            {loading ? "…" : c.value}
          </div>
        </div>
      ))}
    </div>
  );
}
