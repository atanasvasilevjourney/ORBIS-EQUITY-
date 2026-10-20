"use client";

import type { SortDir, SortLevel } from "@/lib/deskMultiSort";

type Props<K extends string> = {
  columnKey: K;
  label: string;
  levels: SortLevel<K>[];
  align?: "left" | "right";
  onSort: (key: K, shiftKey: boolean) => void;
};

export function SortableTh<K extends string>({
  columnKey,
  label,
  levels,
  align = "left",
  onSort,
}: Props<K>) {
  const idx = levels.findIndex((l) => l.key === columnKey);
  const active = idx >= 0;
  const dir: SortDir | null = active ? levels[idx].dir : null;
  return (
    <th
      className={`px-3 py-2 cursor-pointer hover:text-[var(--text-primary)] select-none ${
        align === "right" ? "text-right" : "text-left"
      } ${active ? "text-[var(--accent-info)]" : ""}`}
      onClick={(e) => onSort(columnKey, e.shiftKey)}
      title={active ? "Click to flip · Shift+click to add tie-breaker" : "Click to sort · Shift+click multi-sort"}
    >
      {label}
      {active && (
        <span className="ml-1">
          {dir === "asc" ? "▲" : "▼"}
          {levels.length > 1 && <span className="text-[8px] align-super text-[var(--text-muted)]">{idx + 1}</span>}
        </span>
      )}
    </th>
  );
}
