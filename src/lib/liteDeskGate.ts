/** When tape is stale, do not recompute lite desk payloads from prices (Phase 1). */

import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateFreshness } from "@/lib/freshness";

export async function latestPriceAsOf(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb
    .from("prices_daily")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const d = data?.date;
  return d ? String(d).slice(0, 10) : null;
}

export async function deskFreshnessForLite(sb: SupabaseClient, deskAsOf: string | null) {
  const pricesAsOf = await latestPriceAsOf(sb);
  return evaluateFreshness(deskAsOf, pricesAsOf);
}

export function blockLiteDesk(signalsSuppressed: boolean): boolean {
  return signalsSuppressed;
}
