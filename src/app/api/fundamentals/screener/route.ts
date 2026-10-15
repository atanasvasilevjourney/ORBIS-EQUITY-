import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { matchesScreener, parseScreenerQuery, type ScreenerQuery } from "@/lib/fundamentalsScreener";
import { orbisScore } from "@/lib/orbisScore";

export const revalidate = 900;

function mapRow(
  r: Record<string, unknown>,
  u: {
    company_name: string | null;
    sector: string | null;
    industry: string | null;
    country: string | null;
    exchange: string | null;
    tier: string | null;
  },
  radar: { state: number; quality_rank: number } | undefined
) {
  const rank = radar?.quality_rank ?? null;
  const composite = r.composite_factor_score as number | null;
  return {
    symbol: r.symbol as string,
    companyName: u.company_name ?? "",
    sector: u.sector ?? "",
    industry: u.industry ?? "",
    country: u.country ?? "",
    exchange: u.exchange ?? "",
    tier: u.tier ?? "",
    state: radar?.state ?? null,
    rank,
    orbisScore: orbisScore(rank ?? 0, composite),
    price: r.price as number | null,
    marketCap: r.market_cap as number | null,
    pe: r.pe_ratio as number | null,
    pb: r.pb_ratio as number | null,
    ps: r.ps_ratio as number | null,
    evEbitda: r.ev_ebitda as number | null,
    divYield: r.dividend_yield as number | null,
    roe: r.roe as number | null,
    roa: r.roa as number | null,
    debtToEquity: r.debt_to_equity as number | null,
    currentRatio: r.current_ratio as number | null,
    revGrowth1y: r.revenue_growth_1y as number | null,
    epsGrowth1y: r.eps_growth_1y as number | null,
    fScore: r.f_score as number | null,
    valueScore: r.value_score as number | null,
    qualityScore: r.quality_score as number | null,
    growthScore: r.growth_score as number | null,
    earningsQualityScore: r.earnings_quality_score as number | null,
    leverageScore: r.leverage_score as number | null,
    compositeScore: composite,
    verdict: r.fundamental_verdict as string | null,
    summary: r.fundamental_summary as string | null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const parsed = parseScreenerQuery(req.nextUrl.searchParams);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const q: ScreenerQuery = parsed;

    const sb = createServerClient();

    type FundamentalsRow = Record<string, number | string | null>;
    type UniverseRow = {
      symbol: string;
      company_name: string | null;
      sector: string | null;
      industry: string | null;
      country: string | null;
      exchange: string | null;
      tier: string | null;
    };
    type RadarRow = { symbol: string; state: number; quality_rank: number };

    const fundSelect = `
      symbol, price, market_cap,
      pe_ratio, pb_ratio, ps_ratio, ev_ebitda, dividend_yield,
      roe, roa, roic, net_margin, current_ratio, debt_to_equity,
      revenue_growth_1y, eps_growth_1y, f_score,
      value_score, quality_score, growth_score,
      earnings_quality_score, leverage_score, composite_factor_score,
      fundamental_verdict, fundamental_summary
    `;

    const [fundamentals, universe, radar] = await Promise.all([
      fetchAll<FundamentalsRow>(sb, "fundamentals_snapshot", fundSelect),
      fetchAll<UniverseRow>(sb, "universe_members", "symbol, company_name, sector, industry, country, exchange, tier", (query) =>
        query.eq("is_active", true)
      ),
      fetchAll<RadarRow>(sb, "trend_radar", "symbol, state, quality_rank"),
    ]);

    const uniMap = new Map(universe.map((r) => [r.symbol, r]));
    const radarMap = new Map(radar.map((r) => [r.symbol, r]));

    let filtered = fundamentals.filter((r) => uniMap.has(r.symbol as string));

    filtered = filtered.filter((r) => {
      const sym = r.symbol as string;
      const u = uniMap.get(sym)!;
      const tr = radarMap.get(sym);
      return matchesScreener(r, u, tr, q);
    });

    filtered.sort((a, b) => {
      const av = a[q.sort] as number | null;
      const bv = b[q.sort] as number | null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return q.sortAsc ? av - bv : bv - av;
    });

    filtered = filtered.slice(0, q.limit);

    const sectors = Array.from(new Set(universe.map((r) => r.sector).filter(Boolean))).sort() as string[];
    const industries = Array.from(new Set(universe.map((r) => r.industry).filter(Boolean))).sort() as string[];

    const rows = filtered.map((r) => {
      const sym = r.symbol as string;
      return mapRow(r, uniMap.get(sym)!, radarMap.get(sym));
    });

    return NextResponse.json({
      query: {
        preset: q.preset,
        watchlistOnly: q.watchlistOnly,
        minRank: q.minRank,
        sector: q.sector ?? null,
        region: q.region ?? null,
        verdict: q.verdict ?? null,
      },
      rows,
      sectors,
      industries,
      totalMatched: rows.length,
    });
  } catch (err) {
    console.error("Fundamentals screener API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
