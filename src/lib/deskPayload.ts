/** Client helpers so a 500 JSON body cannot crash a desk page. */

export function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

export function deskList<T>(data: unknown, key: string): T[] {
  const rec = asRecord(data);
  if (!rec) return [];
  const list = rec[key];
  return Array.isArray(list) ? (list as T[]) : [];
}

export function pickNamed<T extends { ticker?: string }>(
  list: T[] | undefined | null,
  ticker: string
): T | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.find((row) => row.ticker === ticker) ?? list[0] ?? null;
}

export function parseDesk<T extends Record<string, unknown>>(
  data: unknown,
  listKey: string
): T | null {
  const rec = asRecord(data);
  if (!rec) return null;
  if (!Array.isArray(rec[listKey])) return null;
  return rec as T;
}
