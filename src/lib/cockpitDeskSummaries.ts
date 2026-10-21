/** Latest desk run summaries for cockpit (server-side, Phase 1). */

import type { SupabaseClient } from "@supabase/supabase-js";

async function latestRow<T>(
  sb: SupabaseClient,
  table: string,
  columns: string,
  orderCol = "computed_at"
): Promise<T | null> {
  const { data, error } = await sb
    .from(table)
    .select(columns)
    .order(orderCol, { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data as T | null;
}

export type CockpitDeskSummaries = {
  earningsBeats: number;
  earningsMisses: number;
  earningsUpcoming: number;
  newsCount: number;
  skewNames: number;
  skewAtm: number | null;
  skewWeekend: string | null;
  orbGappers: number;
  orbBreakouts: number;
  analysisBuys: number;
  analysisSells: number;
  quantNames: number;
  quantSharpe: number | null;
  biasLongs: number;
  biasShorts: number;
  cashTema: number;
  cashCarver: number;
  triangleSetups: number;
  triangleBreakouts: number;
};

export async function fetchCockpitDeskSummaries(sb: SupabaseClient): Promise<CockpitDeskSummaries> {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [
    skew,
    orb,
    analysis,
    quant,
    bias,
    cash,
    earningsRes,
    newsRes,
    triangleRun,
    triangleBreakoutsRes,
  ] = await Promise.all([
    latestRow<{ names: number | null; headline: string | null }>(sb, "skew_runs", "names, headline"),
    latestRow<{ names: number | null; breakouts: number | null }>(sb, "orb_runs", "names, breakouts"),
    latestRow<{ buys: number | null; sells: number | null }>(sb, "analysis_runs", "buys, sells"),
    latestRow<{ names: number | null; allocations: Record<string, unknown> | null }>(
      sb,
      "quantropy_runs",
      "names, allocations"
    ),
    latestRow<{ longs: number | null; shorts: number | null }>(sb, "bias_runs", "longs, shorts"),
    latestRow<{ tema_slots: number | null; carver_slots: number | null }>(
      sb,
      "perp_runs",
      "tema_slots, carver_slots"
    ),
    sb.from("earnings_calendar").select("surprise_pct, event_date").gte("event_date", today).limit(500),
    sb.from("news_items").select("id", { count: "exact", head: true }).gte("published_at", weekAgo),
    latestRow<{ names: number | null }>(sb, "triangle_scan_runs", "names", "asof_date"),
    (async () => {
      const { count, error } = await sb
        .from("triangle_setups")
        .select("symbol", { count: "exact", head: true })
        .or("status.eq.breakout_up,status.eq.breakout_down");
      if (error) return 0;
      return count ?? 0;
    })(),
  ]);

  const earnings = earningsRes.data ?? [];
  const upcoming = earnings.length;
  const reported = await sb
    .from("earnings_calendar")
    .select("surprise_pct")
    .lte("event_date", today)
    .gte("event_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
    .limit(500);
  const rep = reported.data ?? [];
  const beats = rep.filter((e) => (e.surprise_pct ?? 0) > 0).length;
  const misses = rep.filter((e) => (e.surprise_pct ?? 0) < 0).length;

  const alloc = quant?.allocations;
  const equalSharpe =
    alloc && typeof alloc === "object" && !Array.isArray(alloc)
      ? (alloc as { equal?: { sharpe?: number } }).equal?.sharpe ?? null
      : null;

  return {
    earningsBeats: beats,
    earningsMisses: misses,
    earningsUpcoming: upcoming,
    newsCount: newsRes.count ?? 0,
    skewNames: skew?.names ?? 0,
    skewAtm: null,
    skewWeekend: null,
    orbGappers: orb?.names ?? 0,
    orbBreakouts: orb?.breakouts ?? 0,
    analysisBuys: analysis?.buys ?? 0,
    analysisSells: analysis?.sells ?? 0,
    quantNames: quant?.names ?? 0,
    quantSharpe: equalSharpe,
    biasLongs: bias?.longs ?? 0,
    biasShorts: bias?.shorts ?? 0,
    cashTema: cash?.tema_slots ?? 0,
    cashCarver: cash?.carver_slots ?? 0,
    triangleSetups: triangleRun?.names ?? 0,
    triangleBreakouts: triangleBreakoutsRes ?? 0,
  };
}
