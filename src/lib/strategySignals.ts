import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/supabase/paginate";

export type StrategySignalRow = {
  strategyId: string;
  symbol: string;
  asOf: string;
  knownOn: string;
  side: "BUY" | "SELL" | "FLAT";
  score: number;
  stop: number | null;
  sizeHint: number | null;
  reason: string;
};

type DbRow = {
  strategy_id: string;
  symbol: string;
  as_of: string;
  known_on: string;
  side: string;
  score: number;
  stop: number | null;
  size_hint: number | null;
  reason: string;
};

function mapRow(r: DbRow): StrategySignalRow {
  return {
    strategyId: r.strategy_id,
    symbol: r.symbol,
    asOf: String(r.as_of).slice(0, 10),
    knownOn: String(r.known_on).slice(0, 10),
    side: r.side as StrategySignalRow["side"],
    score: r.score,
    stop: r.stop,
    sizeHint: r.size_hint,
    reason: r.reason,
  };
}

/** Latest ``as_of`` batch for a strategy (empty when table missing or no rows). */
export async function fetchLatestStrategySignals(
  sb: SupabaseClient,
  strategyId: string
): Promise<{ asOf: string | null; knownOn: string | null; signals: StrategySignalRow[] }> {
  const { data: head, error: headErr } = await sb
    .from("strategy_signals")
    .select("as_of, known_on")
    .eq("strategy_id", strategyId)
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (headErr || !head?.as_of) {
    return { asOf: null, knownOn: null, signals: [] };
  }

  const asOf = String(head.as_of).slice(0, 10);
  const knownOn = head.known_on ? String(head.known_on).slice(0, 10) : asOf;

  const rows = await fetchAll<DbRow>(
    sb,
    "strategy_signals",
    "strategy_id, symbol, as_of, known_on, side, score, stop, size_hint, reason",
    (q) => q.eq("strategy_id", strategyId).eq("as_of", asOf)
  );

  return {
    asOf,
    knownOn,
    signals: rows.map(mapRow).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol)),
  };
}
