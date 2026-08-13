import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FilterFn = (q: any) => any;

/** Fetch all rows from a Supabase table, paginating past the 1000-row cap. */
export async function fetchAll<T = Record<string, unknown>>(
  sb: SupabaseClient,
  table: string,
  select: string,
  buildQuery?: FilterFn
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;

  while (true) {
    let query = sb.from(table).select(select);
    if (buildQuery) {
      query = buildQuery(query);
    }
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}
