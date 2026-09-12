import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";

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
    const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10), 1000);

    if (Number.isNaN(minRank)) {
      return NextResponse.json({ error: "Invalid min_rank" }, { status: 400 });
    }

    const sb = createServerClient();

    type UniverseRow = { symbol: string; company_name: string | null; sector: string | null; industry: string | null; country: string | null; exchange: string | null; tier: string | null };
    type FundRow = { symbol: string; price: number | null; market_cap: number | null; pe_ratio: number | null; dividend_yield: number | null };
    type RadarRow = { symbol: string; state: number; quality_rank: number; z_mom: number; f_ewmac: number; z_52: number; breakout_active: boolean; volume_confirmed: boolean; convergence_count: number; state_changed_at: string | null; computed_at: string | null };

    const [universe, fundamentals] = await Promise.all([
      fetchAll<UniverseRow>(sb, "universe_members", "symbol, company_name, sector, industry, country, exchange, tier", (q) =>
        q.eq("is_active", true)
      ),
      fetchAll<FundRow>(sb, "fundamentals_snapshot", "symbol, price, market_cap, pe_ratio, dividend_yield"),
    ]);

    // Apply region/sector filters before ranking
    let filteredUniverse = universe;
    if (region && region !== "all") {
      const countries = REGION_COUNTRIES[region];
      if (countries) {
        filteredUniverse = filteredUniverse.filter((u) => countries.includes(u.country ?? ""));
      }
    }
    if (sector) {
      filteredUniverse = filteredUniverse.filter((u) => u.sector === sector);
    }

    const allowedSymbols = new Set(filteredUniverse.map((u) => u.symbol));

    const allRadar: RadarRow[] = await fetchAll<RadarRow>(sb, "trend_radar", "symbol, state, quality_rank, z_mom, f_ewmac, z_52, breakout_active, volume_confirmed, convergence_count, state_changed_at, computed_at", (q) => {
      let query = q.gte("quality_rank", minRank).order("quality_rank", { ascending: false });
      if (direction === "bull") query = query.eq("state", 1);
      else if (direction === "bear") query = query.eq("state", -1);
      return query;
    });

    const rows = allRadar
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
          convergence: r.convergence_count,
          stateChangedAt: r.state_changed_at,
          price: f?.price ?? null,
          marketCap: f?.market_cap ?? null,
          peRatio: f?.pe_ratio ?? null,
          divYield: f?.dividend_yield ?? null,
        };
      })
      .filter(Boolean);

    return NextResponse.json(rows);
  } catch (err) {
    console.error("Screener API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
