import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/supabase/paginate";
import { isMissingRelation } from "@/lib/supabase/errors";

export type Ema200FeatureDbRow = {
  symbol: string;
  bar_date: string;
  close: number | null;
  ema200: number | null;
  ema200_high: number | null;
  dist_atr: number | null;
  ribbon_dist_atr: number | null;
  days_above: number | null;
  ema200_slope: number | null;
  rvol: number | null;
  regime: string | null;
};

const FEATURE_SELECT =
  "symbol, bar_date, close, ema200, ema200_high, dist_atr, ribbon_dist_atr, days_above, ema200_slope, rvol, regime";

function subtractDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Recent feature history only (latest session + ribbon touch lookback). */
export async function fetchRecentEma200Features(
  sb: SupabaseClient,
  historyDays = 120
): Promise<Ema200FeatureDbRow[]> {
  try {
    const { data: latestRow, error: latestErr } = await sb
      .from("ema200_features")
      .select("bar_date")
      .order("bar_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr && !isMissingRelation(latestErr)) throw latestErr;
    if (!latestRow?.bar_date) return [];

    const latest = String(latestRow.bar_date).slice(0, 10);
    const cutoff = subtractDays(latest, historyDays);
    return await fetchAll<Ema200FeatureDbRow>(sb, "ema200_features", FEATURE_SELECT, (q) =>
      q.gte("bar_date", cutoff)
    );
  } catch (err) {
    if (isMissingRelation(err)) return [];
    throw err;
  }
}