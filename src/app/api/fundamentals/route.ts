import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sector = sp.get("sector");
  const minFScore = parseInt(sp.get("min_f") ?? "0", 10);
  const maxPE = parseFloat(sp.get("max_pe") ?? "0");
  const minROE = parseFloat(sp.get("min_roe") ?? "0");
  const sortBy = sp.get("sort") ?? "market_cap";
  const sortDir = sp.get("dir") === "asc" ? true : false;
  const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10), 1000);

  const sb = createServerClient();

  let query = sb
    .from("fundamentals_snapshot")
    .select(`
      symbol,
      price,
      market_cap,
      pe_ratio,
      pb_ratio,
      ps_ratio,
      p_fcf_ratio,
      ev_ebitda,
      earnings_yield,
      fcf_yield,
      dividend_yield,
      gross_margin,
      operating_margin,
      net_margin,
      roe,
      roa,
      roic,
      current_ratio,
      debt_to_equity,
      revenue_growth_1y,
      revenue_growth_3y,
      net_income_growth_1y,
      eps_growth_1y,
      f_score,
      universe_members!inner (
        company_name,
        sector,
        industry,
        country,
        exchange,
        tier
      ),
      trend_radar (
        state,
        quality_rank
      )
    `)
    .order(sortBy, { ascending: sortDir })
    .limit(limit);

  // F-Score filter
  if (minFScore > 0) {
    query = query.gte("f_score", minFScore);
  }

  // Valuation filters
  if (maxPE > 0) {
    query = query.lte("pe_ratio", maxPE).gt("pe_ratio", 0);
  }

  if (minROE > 0) {
    query = query.gte("roe", minROE);
  }

  // Push sector filter into DB query via embedded join filter
  if (sector) {
    query = query.eq("universe_members.sector", sector);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const filtered = data ?? [];

  // Get unique sectors for filter dropdown
  const sectorSet = new Set<string>();
  for (const r of data ?? []) {
    const s = (r as any).universe_members?.sector;
    if (s) sectorSet.add(s);
  }
  const sectors = Array.from(sectorSet).sort();

  // Flatten for frontend
  const rows = filtered.map((r: any) => ({
    symbol: r.symbol,
    companyName: r.universe_members?.company_name ?? "",
    sector: r.universe_members?.sector ?? "",
    country: r.universe_members?.country ?? "",
    exchange: r.universe_members?.exchange ?? "",
    tier: r.universe_members?.tier ?? "",
    state: r.trend_radar?.state ?? null,
    rank: r.trend_radar?.quality_rank ?? null,
    price: r.price,
    marketCap: r.market_cap,
    pe: r.pe_ratio,
    pb: r.pb_ratio,
    ps: r.ps_ratio,
    pFcf: r.p_fcf_ratio,
    evEbitda: r.ev_ebitda,
    earningsYield: r.earnings_yield,
    fcfYield: r.fcf_yield,
    divYield: r.dividend_yield,
    grossMargin: r.gross_margin,
    opMargin: r.operating_margin,
    netMargin: r.net_margin,
    roe: r.roe,
    roa: r.roa,
    roic: r.roic,
    currentRatio: r.current_ratio,
    debtToEquity: r.debt_to_equity,
    revGrowth1y: r.revenue_growth_1y,
    revGrowth3y: r.revenue_growth_3y,
    niGrowth1y: r.net_income_growth_1y,
    epsGrowth1y: r.eps_growth_1y,
    fScore: r.f_score,
  }));

  return NextResponse.json({ rows, sectors });
}
