import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";

export const revalidate = 900;

const HEALTH_SECTORS = new Set(["Health Care", "Healthcare", "Health"]);

export async function GET() {
  try {
    const sb = createServerClient();

    type UniverseRow = { symbol: string; company_name: string | null; sector: string | null; industry: string | null; country: string | null; exchange: string | null };
    type FundRow = {
      symbol: string; price: number | null; market_cap: number | null; pe_ratio: number | null;
      roe: number | null; net_margin: number | null; dividend_yield: number | null;
      revenue_growth_1y: number | null; value_score: number | null; quality_score: number | null;
      growth_score: number | null; composite_factor_score: number | null; f_score: number | null;
    };
    type RadarRow = { symbol: string; state: number; quality_rank: number };

    const [universe, fundamentals, radar] = await Promise.all([
      fetchAll<UniverseRow>(sb, "universe_members", "symbol, company_name, sector, industry, country, exchange", (q) =>
        q.eq("is_active", true)
      ),
      fetchAll<FundRow>(sb, "fundamentals_snapshot", `
        symbol, price, market_cap, pe_ratio, roe, net_margin, dividend_yield,
        revenue_growth_1y, value_score, quality_score, growth_score,
        composite_factor_score, f_score
      `),
      fetchAll<RadarRow>(sb, "trend_radar", "symbol, state, quality_rank"),
    ]);

    const healthUni = universe.filter((u) => HEALTH_SECTORS.has(u.sector ?? ""));
    const fundMap = new Map(fundamentals.map((f) => [f.symbol, f]));
    const radarMap = new Map(radar.map((r) => [r.symbol, r]));

    const rows = healthUni
      .map((u) => {
        const f = fundMap.get(u.symbol);
        const tr = radarMap.get(u.symbol);
        return {
          symbol: u.symbol,
          companyName: u.company_name ?? "",
          industry: u.industry ?? "",
          country: u.country ?? "",
          price: f?.price ?? null,
          marketCap: f?.market_cap ?? null,
          pe: f?.pe_ratio ?? null,
          roe: f?.roe ?? null,
          netMargin: f?.net_margin ?? null,
          divYield: f?.dividend_yield ?? null,
          revGrowth1y: f?.revenue_growth_1y ?? null,
          valueScore: f?.value_score ?? null,
          qualityScore: f?.quality_score ?? null,
          growthScore: f?.growth_score ?? null,
          compositeScore: f?.composite_factor_score ?? null,
          fScore: f?.f_score ?? null,
          state: tr?.state ?? null,
          rank: tr?.quality_rank ?? null,
        };
      })
      .sort((a, b) => (b.compositeScore ?? -1) - (a.compositeScore ?? -1));

    return NextResponse.json({
      rows,
      summary: {
        healthNames: rows.length,
      },
    });
  } catch (err) {
    console.error("Health API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
