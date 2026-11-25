import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { isMissingColumn } from "@/lib/supabase/errors";
import { orbisScore } from "@/lib/orbisScore";
import { parseSymbolsQueryParam } from "@/lib/symbolsQuery";
import { resolveUniverseDesk } from "@/lib/resolveIndexDesk";
import { fetchLatestStrategySignals } from "@/lib/strategySignals";
import { fetchSessionQuotes } from "@/lib/sessionQuotes";
import { buildScreenerRow } from "@/lib/screenerEnrich";
import { isResearchDeskEligible } from "@/lib/equityUniverseFilter";

export const revalidate = 900;

const REGION_COUNTRIES: Record<string, string[]> = {
  us: ["US"],
  uk: ["GB"],
  eu: ["DE", "FR", "NL", "ES", "IT", "CH", "IE"],
};

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const direction = sp.get("direction");
    const region = sp.get("region");
    const sector = sp.get("sector");
    const minRank = parseInt(sp.get("min_rank") ?? "0", 10);
    const minDay = parseFloat(sp.get("min_day") ?? "0");
    const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10), 1000);
    const deskSymbols = parseSymbolsQueryParam(sp.get("symbols"));
    const universeParam = sp.get("universe");

    if (Number.isNaN(minRank) || Number.isNaN(minDay)) {
      return NextResponse.json({ error: "Invalid min_rank or min_day" }, { status: 400 });
    }

    const sb = createServerClient();

    let indexDeskSymbols: string[] = [];
    if (!deskSymbols.length && universeParam) {
      const resolved = await resolveUniverseDesk(sb, universeParam, []);
      indexDeskSymbols = resolved.symbols;
    }

    type UniverseRow = {
      symbol: string;
      company_name: string | null;
      sector: string | null;
      industry: string | null;
      country: string | null;
      exchange: string | null;
      tier: string | null;
    };
    type FundRow = {
      symbol: string;
      price: number | null;
      market_cap: number | null;
      pe_ratio: number | null;
      dividend_yield: number | null;
      composite_factor_score: number | null;
    };
    type RadarRow = {
      symbol: string;
      state: number;
      quality_rank: number;
      z_mom: number;
      f_ewmac: number;
      z_52: number;
      breakout_active: boolean;
      volume_confirmed: boolean;
      kama_regime: number | null;
      adx: number | null;
      entry_timing: string | null;
      convergence_count: number;
      state_changed_at: string | null;
      computed_at: string | null;
    };

    const [universe, fundamentals] = await Promise.all([
      fetchAll<UniverseRow>(
        sb,
        "universe_members",
        "symbol, company_name, sector, industry, country, exchange, tier",
        (q) => q.eq("is_active", true)
      ),
      fetchAll<FundRow>(
        sb,
        "fundamentals_snapshot",
        "symbol, price, market_cap, pe_ratio, dividend_yield, composite_factor_score"
      ),
    ]);

    let filteredUniverse = universe;
    if (indexDeskSymbols.length) {
      const allowedDesk = new Set(indexDeskSymbols);
      filteredUniverse = universe.filter((u) => allowedDesk.has(u.symbol));
    }
    if (deskSymbols.length) {
      const known = new Map(filteredUniverse.map((u) => [u.symbol, u]));
      filteredUniverse = deskSymbols.map((sym) => {
        const u = known.get(sym);
        return (
          u ?? {
            symbol: sym,
            company_name: sym,
            sector: null,
            industry: null,
            country: "US",
            exchange: "NASDAQ",
            tier: "desk",
          }
        );
      });
    }
    if (region && region !== "all") {
      const countries = REGION_COUNTRIES[region];
      if (countries) {
        filteredUniverse = filteredUniverse.filter((u) => countries.includes(u.country ?? ""));
      }
    }
    if (sector) {
      filteredUniverse = filteredUniverse.filter((u) => u.sector === sector);
    }
    if (!deskSymbols.length) {
      filteredUniverse = filteredUniverse.filter((u) =>
        isResearchDeskEligible({
          symbol: u.symbol,
          tier: u.tier,
          is_active: true,
          company_name: u.company_name,
          sector: u.sector,
          industry: u.industry,
        })
      );
    }
    const allowedSymbols = new Set(filteredUniverse.map((u) => u.symbol));
    const deskMode = deskSymbols.length > 0;

    const watchBatch = deskMode
      ? { asOf: null, knownOn: null, signals: [] }
      : await fetchLatestStrategySignals(sb, "watchlist_momentum");
    let strategyBuySymbols: string[] = [];
    if (watchBatch.signals.length > 0 && !deskMode && direction !== "bear") {
      strategyBuySymbols = watchBatch.signals
        .filter((s) => {
          if (s.side !== "BUY" || s.score < minRank) return false;
          if (direction === "hot") return s.reason === "hot";
          if (direction === "bull") return true;
          return true;
        })
        .map((s) => s.symbol)
        .filter((sym) => allowedSymbols.has(sym));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const radarFilter = (q: any) => {
      let query = q.order("quality_rank", { ascending: false });
      if (deskMode) {
        query = query.in("symbol", deskSymbols);
        return query;
      }
      query = query.gte("quality_rank", minRank);
      if (minDay > 0) query = query.gte("z_mom", minDay);
      if (direction === "bull") query = query.eq("state", 1);
      else if (direction === "bear") query = query.eq("state", -1);
      else if (direction === "hot") query = query.eq("entry_timing", "hot");
      return query;
    };

    const radarFull =
      "symbol, state, quality_rank, z_mom, f_ewmac, z_52, breakout_active, volume_confirmed, kama_regime, adx, entry_timing, convergence_count, state_changed_at, computed_at";
    const radarBase =
      "symbol, state, quality_rank, z_mom, f_ewmac, z_52, breakout_active, volume_confirmed, convergence_count, state_changed_at, computed_at";

    let allRadar: RadarRow[];
    const useStrategyBus = strategyBuySymbols.length > 0 && !deskMode;
    try {
      if (useStrategyBus) {
        allRadar = await fetchAll<RadarRow>(sb, "trend_radar", radarFull, (q) =>
          q.in("symbol", strategyBuySymbols.slice(0, 1000)).order("quality_rank", { ascending: false })
        );
      } else {
        allRadar = await fetchAll<RadarRow>(sb, "trend_radar", radarFull, radarFilter);
      }
    } catch (err) {
      if (!isMissingColumn(err)) throw err;
      const slim = await fetchAll<Omit<RadarRow, "kama_regime" | "adx" | "entry_timing">>(
        sb,
        "trend_radar",
        radarBase,
        radarFilter
      );
      allRadar = slim.map((r) => ({
        ...r,
        kama_regime: null,
        adx: null,
        entry_timing: null,
      }));
    }

    const filteredRadar = allRadar.filter((r) => allowedSymbols.has(r.symbol)).slice(0, limit);
    const quoteSymbols = Array.from(new Set(filteredRadar.map((r) => r.symbol)));
    const quotes = await fetchSessionQuotes(sb, quoteSymbols, undefined, {
      fillMissing: true,
      fillLimit: 80,
    });

    let rows = filteredRadar
      .map((r) => {
        const u = filteredUniverse.find((x) => x.symbol === r.symbol);
        const f = fundamentals.find((x) => x.symbol === r.symbol);
        if (!u) return null;
        return buildScreenerRow(r, u, f, quotes.get(r.symbol), {
          orbisScore: orbisScore(r.quality_rank, f?.composite_factor_score ?? null),
          signalSource: useStrategyBus ? "strategy_signals" : "trend_radar",
          strategyAsOf: useStrategyBus ? watchBatch.asOf : null,
          hasTrendRadar: true,
        });
      })
      .filter(Boolean);

    if (deskMode) {
      const deskQuotes = await fetchSessionQuotes(sb, deskSymbols);
      const radarBySym = new Map(allRadar.map((r) => [r.symbol, r]));
      const emptyRadar = {
        symbol: "",
        state: 0,
        quality_rank: 0,
        z_mom: 0,
        f_ewmac: 0,
        z_52: 0,
        breakout_active: false,
        volume_confirmed: false,
        convergence_count: 0,
        state_changed_at: null as string | null,
      };
      const merged = deskSymbols.map((sym) => {
        const existing = rows.find((row) => row && row.symbol === sym);
        if (existing) return { ...existing, hasTrendRadar: true, signalSource: "trend_radar", strategyAsOf: null };
        const u = filteredUniverse.find((x) => x.symbol === sym);
        const f = fundamentals.find((x) => x.symbol === sym);
        const r = radarBySym.get(sym);
        if (r && u) {
          return buildScreenerRow(r, u, f, deskQuotes.get(sym), {
            orbisScore: orbisScore(r.quality_rank, f?.composite_factor_score ?? null),
            signalSource: "trend_radar",
            strategyAsOf: null,
            hasTrendRadar: true,
          });
        }
        return buildScreenerRow(
          { ...emptyRadar, symbol: sym },
          {
            company_name: u?.company_name ?? sym,
            sector: u?.sector ?? "",
            country: u?.country ?? "US",
            exchange: u?.exchange ?? "NASDAQ",
            tier: "desk",
          },
          f,
          deskQuotes.get(sym),
          {
            orbisScore: null,
            signalSource: "trend_radar",
            strategyAsOf: null,
            hasTrendRadar: false,
          }
        );
      });
      rows = merged as typeof rows;
    }

    return NextResponse.json(rows);
  } catch (err) {
    console.error("Screener API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
