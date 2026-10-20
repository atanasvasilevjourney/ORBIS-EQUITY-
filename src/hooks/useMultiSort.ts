"use client";

import { useCallback, useMemo, useState } from "react";
import {
  multiSortRows,
  nextSortLevels,
  type SortAccessor,
  type SortLevel,
} from "@/lib/deskMultiSort";

export function useMultiSort<T, K extends string>(
  rows: T[],
  accessors: Record<K, SortAccessor<T, K>>,
  defaultLevels: SortLevel<K>[],
  labels: Record<K, string>
) {
  const [levels, setLevels] = useState<SortLevel<K>[]>(defaultLevels);

  const sorted = useMemo(
    () => multiSortRows(rows, levels, accessors),
    [rows, levels, accessors]
  );

  const onHeaderClick = useCallback((key: K, shiftKey: boolean) => {
    setLevels((prev) => nextSortLevels(prev, key, { append: shiftKey }));
  }, []);

  const clearSort = useCallback(() => setLevels(defaultLevels), [defaultLevels]);

  const chips = useMemo(
    () => levels.map((l) => ({ level: l, label: labels[l.key] ?? l.key })),
    [levels, labels]
  );

  return { sorted, levels, chips, onHeaderClick, clearSort, setLevels };
}
