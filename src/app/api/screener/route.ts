import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { isMissingColumn } from "@/lib/supabase/errors";
import { orbisScore } from "@/lib/orbisScore";
import { parseSymbolsQueryParam } from "@/lib/symbolsQuery";
import { resolveUniverseDesk } from "@/lib/resolveIndexDesk";

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
    const watchlistSymbols = parseSymbolsQueryParam(sp.get("symbols"));

    if (Number.isNaN(minRank) || Number.isNaN(minDay)) {
      return NextResponse.json({ error: "Invalid min_rank or min_day" }, { status: 400 });
    }

    const sb = createServerClient();
    const resolved = await resolveUniverseDesk(sb, sp.get("universe"), watchlistSymbols);
    const deskSymbols =
      resolved.desk === "watchlist" && resolved.symbols.length > 0 ? resolved.symbols : [];
    const indexDeskFilter =
      resolved.desk !== "watchlist" && resolved.symbols.length > 0
        ? new Set(resolved.symbols)
        : null;

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
    if (indexDeskFilter) {
      filteredUniverse = filteredUniverse.filter((u) => indexDeskFilter.has(u.symbol));
    }

    const allowedSymbols = new Set(filteredUniverse.map((u) => u.symbol));
    const deskMode = deskSymbols.length > 0;

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
    try {
      allRadar = await fetchAll<RadarRow>(sb, "trend_radar", radarFull, radarFilter);
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

    let rows = allRadar
      .filter((r) => allowedSymbols.has(r.symbol))
      .slice(0, limit)
      .map((r) => {
        const u = filteredUniverse.find((x) => x.symbol === r.symbol);
        const f = fundamentals.find((x) => x.symbol === r.symbol);
        if (!u) return null;
        return {
          symbol: r.symbol,
          companyName: u.company_name ?? "",
          sector: u.sector ?? "",
          country: u.country ?? "",
          exchange: u.exchange ?? "",
          tier: u.tier ?? "",
          state: r.state,
          rank: r.quality_rank,
          zMom: r.z_mom,
          fEwmac: r.f_ewmac,
          z52: r.z_52,
          breakout: r.breakout_active,
          volumeConfirmed: r.volume_confirmed,
          kamaRegime: r.kama_regime ?? 0,
          adx: r.adx ?? null,
          entryTiming: r.entry_timing ?? null,
          convergence: r.convergence_count,
          stateChangedAt: r.state_changed_at,
          dayPct: r.z_mom,
          relVolume: r.f_ewmac,
          pctFromHigh: r.z_52 * 100,
          price: f?.price ?? null,
          marketCap: f?.market_cap ?? null,
          peRatio: f?.pe_ratio ?? null,
          divYield: f?.dividend_yield ?? null,
          orbisScore: orbisScore(r.quality_rank, f?.composite_factor_score ?? null),
          compositeScore: f?.composite_factor_score ?? null,
          hasTrendRadar: true,
        };
      })
      .filter(Boolean);

    if (deskMode) {
      const radarBySym = new Map(allRadar.map((r) => [r.symbol, r]));
      const merged = deskSymbols.map((sym) => {
        const existing = rows.find((row) => row && row.symbol === sym);
        if (existing) return { ...existing, hasTrendRadar: true };
        const u = filteredUniverse.find((x) => x.symbol === sym);
        const f = fundamentals.find((x) => x.symbol === sym);
        const r = radarBySym.get(sym);
        if (r && u) {
          return {
            symbol: r.symbol,
            companyName: u.company_name ?? "",
            sector: u.sector ?? "",
            country: u.country ?? "",
            exchange: u.exchange ?? "",
            tier: u.tier ?? "",
            state: r.state,
            rank: r.quality_rank,
            zMom: r.z_mom,
            fEwmac: r.f_ewmac,
            z52: r.z_52,
            breakout: r.breakout_active,
            volumeConfirmed: r.volume_confirmed,
            kamaRegime: r.kama_regime ?? 0,
            adx: r.adx ?? null,
            entryTiming: r.entry_timing ?? null,
            convergence: r.convergence_count,
            stateChangedAt: r.state_changed_at,
            dayPct: r.z_mom,
            relVolume: r.f_ewmac,
            pctFromHigh: r.z_52 * 100,
            price: f?.price ?? null,
            marketCap: f?.market_cap ?? null,
            peRatio: f?.pe_ratio ?? null,
            divYield: f?.dividend_yield ?? null,
            orbisScore: orbisScore(r.quality_rank, f?.composite_factor_score ?? null),
            compositeScore: f?.composite_factor_score ?? null,
            hasTrendRadar: true,
          };
        }
        return {
          symbol: sym,
          companyName: u?.company_name ?? sym,
          sector: u?.sector ?? "",
          country: u?.country ?? "US",
          exchange: u?.exchange ?? "NASDAQ",
          tier: "desk",
          state: 0,
          rank: 0,
          zMom: 0,
          fEwmac: 0,
          z52: 0,
          breakout: false,
          volumeConfirmed: false,
          kamaRegime: 0,
          adx: null,
          entryTiming: null,
          convergence: 0,
          stateChangedAt: null,
          dayPct: 0,
          relVolume: 0,
          pctFromHigh: 0,
          price: f?.price ?? null,
          marketCap: f?.market_cap ?? null,
          peRatio: f?.pe_ratio ?? null,
          divYield: f?.dividend_yield ?? null,
          orbisScore: null,
          compositeScore: f?.composite_factor_score ?? null,
          hasTrendRadar: false,
        };
      });
      rows = merged;
    }

    return NextResponse.json(rows);
  } catch (err) {
    console.error("Screener API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
