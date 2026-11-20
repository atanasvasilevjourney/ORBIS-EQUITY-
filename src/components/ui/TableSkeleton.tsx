export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-[var(--panel-border)] animate-pulse">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-3 py-2.5">
              <div
                className="h-3 rounded bg-[var(--surface-alt)]"
                style={{ width: c === 0 ? "4rem" : `${40 + (c % 3) * 18}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function MetricSkeletonGrid({ count = 5 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded border border-[var(--panel-border)] bg-[var(--surface-alt)] px-3 py-4 h-16"
        />
      ))}
    </div>
  );
}

export function PanelLoadingSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="px-3 py-8 space-y-3 animate-pulse" aria-busy="true">
      <p className="text-center text-[var(--text-muted)] font-terminal text-sm">{label}</p>
      <div className="mx-auto max-w-md h-2 rounded bg-[var(--surface-alt)]" />
      <div className="mx-auto max-w-sm h-2 rounded bg-[var(--surface-alt)]" />
    </div>
  );
}