import { fetchAll } from "@/lib/supabase/paginate";
import { isMissingRelation } from "@/lib/supabase/errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type IndexDeskId,
  type UniverseDeskId,
  filterSymbolsForIndexDesk,
  parseUniverseDeskParam,
} from "@/lib/universeDesk";

type MemberRow = {
  symbol: string;
  tier: string | null;
  exchange: string | null;
  country: string | null;
  is_active: boolean | null;
};

export type ResolvedDesk = {
  desk: UniverseDeskId;
  symbols: string[];
  /** Human label for API responses */
  universeKey: string;
};

export async function resolveUniverseDesk(
  sb: SupabaseClient,
  deskParam: string | null,
  watchlistSymbols: string[]
): Promise<ResolvedDesk> {
  const parsed = parseUniverseDeskParam(deskParam);
  const desk: UniverseDeskId =
    parsed ?? (watchlistSymbols.length > 0 ? "watchlist" : "sp500_ndx100");

  if (desk === "watchlist") {
    return {
      desk: "watchlist",
      symbols: watchlistSymbols,
      universeKey: "watchlist",
    };
  }

  const [members, marketCaps, ema200Uni] = await Promise.all([
    fetchAll<MemberRow>(
      sb,
      "universe_members",
      "symbol, tier, exchange, country, is_active",
      (q) => q.eq("is_active", true)
    ),
    fetchAll<{ symbol: string; market_cap: number | null }>(
      sb,
      "fundamentals_snapshot",
      "symbol, market_cap"
    ),
    (async () => {
      try {
        return await fetchAll<{ symbol: string; index_tag: string | null }>(
          sb,
          "ema200_universe",
          "symbol, index_tag",
          (q) => q.eq("active", true)
        );
      } catch (err) {
        if (isMissingRelation(err)) return [];
        throw err;
      }
    })(),
  ]);

  const symbols = filterSymbolsForIndexDesk(desk as IndexDeskId, members, marketCaps, ema200Uni);

  return {
    desk,
    symbols,
    universeKey: desk,
  };
}
