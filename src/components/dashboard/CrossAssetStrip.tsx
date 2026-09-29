"use client";

export type CrossAssetTile = {
  symbol: string;
  label: string;
  last: number | null;
  dayPct: number | null;
  spark: number[];
};

function sparkPath(values: number[], w = 64, h = 24): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function CrossAssetStrip({ tiles }: { tiles: CrossAssetTile[] }) {
  if (!tiles.length) {
    return (
      <p className="text-xs text-[var(--text-muted)] font-terminal py-2">No cross-asset tape in universe.</p>
    );
  }
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {tiles.map((t) => {
        const color =
          (t.dayPct ?? 0) > 0
            ? "var(--accent-bull)"
            : (t.dayPct ?? 0) < 0
              ? "var(--accent-bear)"
              : "var(--text-secondary)";
        return (
          <div
            key={t.symbol}
            className="shrink-0 min-w-[7rem] px-2 py-2 rounded border border-[var(--panel-border)] bg-[var(--surface-alt)]"
          >
            <div className="text-[10px] font-terminal text-[var(--text-muted)]">{t.label}</div>
            <div className="font-terminal font-bold text-sm">{t.symbol}</div>
            <div className="text-xs font-terminal" style={{ color }}>
              {t.dayPct == null ? "—" : `${t.dayPct > 0 ? "+" : ""}${t.dayPct.toFixed(2)}%`}
            </div>
            {t.spark.length > 1 && (
              <svg viewBox="0 0 64 24" className="w-full h-6 mt-1">
                <path d={sparkPath(t.spark)} fill="none" stroke={color} strokeWidth="1.2" />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}
