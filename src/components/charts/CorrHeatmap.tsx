"use client";

import type { CorrMatrix } from "@/lib/corr";

function cellColor(v: number | null) {
  if (v == null) return "var(--surface-alt)";
  const t = Math.max(-1, Math.min(1, v));
  if (t >= 0) return `rgba(34, 197, 94, ${0.12 + t * 0.75})`;
  return `rgba(239, 68, 68, ${0.12 + Math.abs(t) * 0.75})`;
}

export function CorrHeatmap({
  corr,
  title,
}: {
  corr: CorrMatrix | null | undefined;
  title?: string;
}) {
  const labels = corr?.labels ?? [];
  const matrix = corr?.matrix ?? [];
  if (labels.length < 2) {
    return (
      <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3">
        <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">
          {title ?? "CORRELATION"}
        </h2>
        <p className="text-xs text-[var(--text-muted)] font-terminal px-2 py-6 text-center">
          Need ≥2 overlapping series for a correlation matrix.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--card-bg)] p-3 overflow-x-auto">
      <h2 className="text-xs font-terminal text-[var(--text-muted)] tracking-widest mb-2">
        {title ?? "CORRELATION MATRIX · DAILY RETURNS"}
      </h2>
      <table className="text-[10px] font-terminal">
        <thead>
          <tr>
            <th className="px-1 py-1" />
            {labels.map((l) => (
              <th key={l} className="px-1 py-1 text-[var(--text-muted)] font-normal" title={l}>
                {l.length > 8 ? l.slice(0, 8) : l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((row, i) => (
            <tr key={row}>
              <td className="px-1 py-1 text-[var(--text-muted)] whitespace-nowrap">{row.length > 10 ? row.slice(0, 10) : row}</td>
              {labels.map((col, j) => {
                const v = matrix[i]?.[j] ?? null;
                return (
                  <td
                    key={col}
                    className="px-1 py-1 text-center"
                    title={`${row} / ${col}: ${v == null ? "—" : v.toFixed(2)}`}
                    style={{ background: cellColor(v), color: "var(--text-primary)", minWidth: 28 }}
                  >
                    {v == null ? "—" : v.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-[var(--text-muted)] font-terminal mt-2">
        Pearson on overlapping daily returns. Green = co-move. Red = diversifier. Not a covariance model.
      </p>
    </div>
  );
}
