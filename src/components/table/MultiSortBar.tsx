"use client";

import type { SortLevel } from "@/lib/deskMultiSort";
import { sortLevelLabel } from "@/lib/deskMultiSort";

type Props<K extends string> = {
  levels: SortLevel<K>[];
  labels: Record<K, string>;
  onClear: () => void;
};

export function MultiSortBar<K extends string>({ levels, labels, onClear }: Props<K>) {
  if (!levels.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[var(--panel-border)] bg-[var(--surface-alt)] text-[10px] font-terminal text-[var(--text-muted)]">
      <span className="tracking-widest">SORT</span>
      {levels.map((l, i) => (
        <span
          key={`${l.key}-${i}`}
          className="px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--card-bg)] text-[var(--text-secondary)]"
        >
          {i + 1}. {sortLevelLabel(l, labels)}
        </span>
      ))}
      <span className="text-[var(--text-muted)]">· click header · shift+click tie-break</span>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-[var(--accent-info)] hover:underline"
      >
        Reset
      </button>
    </div>
  );
}
