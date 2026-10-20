/**
 * Client-side multi-column sort for desk tables (IBKR-style tie-breakers:
 * primary sort, then secondary, then tertiary — see shift+click on headers).
 */

export type SortDir = "asc" | "desc";

export type SortLevel<K extends string = string> = {
  key: K;
  dir: SortDir;
};

export type SortAccessor<T, K extends string> = (row: T) => string | number | boolean | null | undefined;

export function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const mul = dir === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return mul * (Number(a) - Number(b));
  }
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return 0;
    if (Number.isNaN(a)) return 1;
    if (Number.isNaN(b)) return -1;
    return mul * (a - b);
  }
  const as = String(a);
  const bs = String(b);
  return mul * as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
}

export function multiSortRows<T, K extends string>(
  rows: T[],
  levels: SortLevel<K>[],
  accessors: Record<K, SortAccessor<T, K>>
): T[] {
  if (!levels.length) return [...rows];
  const out = [...rows];
  out.sort((a, b) => {
    for (const level of levels) {
      const get = accessors[level.key];
      if (!get) continue;
      const cmp = compareValues(get(a), get(b), level.dir);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
  return out;
}

/** Plain click: sort by this column only. Shift+click: add/move as next tie-breaker. */
export function nextSortLevels<K extends string>(
  prev: SortLevel<K>[],
  key: K,
  opts: { append: boolean; maxLevels?: number }
): SortLevel<K>[] {
  const max = opts.maxLevels ?? 4;
  const idx = prev.findIndex((l) => l.key === key);
  if (!opts.append) {
    if (idx === 0) {
      const flipped = prev[0].dir === "asc" ? "desc" : "asc";
      return [{ key, dir: flipped }];
    }
    return [{ key, dir: "desc" }];
  }
  if (idx >= 0) {
    const next = [...prev];
    next[idx] = { key, dir: next[idx].dir === "asc" ? "desc" : "asc" };
    return next;
  }
  const merged = [...prev, { key, dir: "desc" as SortDir }];
  return merged.slice(0, max);
}

export function sortLevelLabel<K extends string>(
  level: SortLevel<K>,
  labels: Record<K, string>
): string {
  const name = labels[level.key] ?? level.key;
  return `${name} ${level.dir === "asc" ? "↑" : "↓"}`;
}
