import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sector = sp.get("sector");
  const minFScore = parseInt(sp.get("min_f") ?? "0", 10);
  const maxPE = parseFloat(sp.get("max_pe") ?? "0");
  const minROE = parseFloat(sp.get("min_roe") ?? "0");
  const ALLOWED_SORTS = new Set([
    "market_cap", "pe_ratio", "pb_ratio", "ps_ratio", "p_fcf_ratio",
    "ev_ebitda", "earnings_yield", "fcf_yield", "dividend_yield",
    "gross_margin", "operating_margin", "net_margin", "roe", "roa", "roic",
    "current_ratio", "debt_to_equity", "revenue_growth_1y", "eps_growth_1y",
    "f_score", "price",
  ]);
  const rawSort = sp.get("sort") ?? "market_cap";
  const sortBy = ALLOWED_SORTS.has(rawSort) ? rawSort : "market_cap";
  const sortDir = sp.get("dir") === "asc" ? true : false;
  const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10), 1000);

  const sb = createServerClient();

  // Build fundamentals query
  let query = sb
    .from("fundamentals_snapshot")
    .select(`
      symbol, price, market_cap,
      pe_ratio, pb_ratio, ps_ratio, p_fcf_ratio, ev_ebitda,
      earnings_yield, fcf_yield, dividend_yield,
      gross_margin, operating_margin, net_margin,
      roe, roa, roic,
      current_ratio, debt_to_equity,
      revenue_growth_1y, revenue_growth_3y,
      net_income_growth_1y, eps_growth_1y, f_score
    `, { count: "exact" })
    .order(sortBy, { ascending: sortDir })
    .limit(limit);

  if (minFScore > 0) {
    query = query.gte("f_score", minFScore);
  }
  if (maxPE > 0) {
    query = query.lte("pe_ratio", maxPE).gt("pe_ratio", 0);
  }
  if (minROE > 0) {
    query = query.gte("roe", minROE);
  }

  // Fetch fundamentals + universe + radar in parallel
  const [fundResult, universeResult, radarResult] = await Promise.all([
    query,
    sb.from("universe_members").select("symbol, company_name, sector, industry, country, exchange, tier").eq("is_active", true),
    sb.from("trend_radar").select("symbol, state, quality_rank", { count: "exact" }),
  ]);

  if (fundResult.error) {
    console.error("Supabase fundamentals query error:", fundResult.error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Build lookup maps
  const uniMap = new Map((universeResult.data ?? []).map((r: any) => [r.symbol, r]));
  const radarMap = new Map((radarResult.data ?? []).map((r: any) => [r.symbol, r]));

  // Filter by sector in JS (since we can't use embedded join filter)
  let filtered = fundResult.data ?? [];
  if (sector) {
    const sectorSymbols = new Set(
      (universeResult.data ?? [])
        .filter((u: any) => u.sector === sector)
        .map((u: any) => u.symbol)
    );
    filtered = filtered.filter((r: any) => sectorSymbols.has(r.symbol));
  }

  // Get all sectors for dropdown
  const sectors = Array.from(
    new Set((universeResult.data ?? []).map((r: any) => r.sector as string).filter(Boolean))
  ).sort();

  // Flatten for frontend
  const rows = filtered.map((r: any) => {
    const u = uniMap.get(r.symbol);
    const tr = radarMap.get(r.symbol);
    return {
      symbol: r.symbol,
      companyName: u?.company_name ?? "",
      sector: u?.sector ?? "",
      country: u?.country ?? "",
      exchange: u?.exchange ?? "",
      tier: u?.tier ?? "",
      state: tr?.state ?? null,
      rank: tr?.quality_rank ?? null,
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
    };
  });

  return NextResponse.json({ rows, sectors });
}
