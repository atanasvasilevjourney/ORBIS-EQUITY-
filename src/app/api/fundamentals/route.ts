import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { fetchSessionQuotes } from "@/lib/sessionQuotes";
import { refreshFundamentalQuotes, sanitizeMargins, sanitizePeRatio } from "@/lib/fundamentalsSanity";
import { displaySector } from "@/lib/displaySector";
import { isResearchDeskEligible } from "@/lib/equityUniverseFilter";

export const revalidate = 900;

const ALLOWED_SORTS = new Set([
  "market_cap", "pe_ratio", "pb_ratio", "ps_ratio", "p_fcf_ratio",
  "ev_ebitda", "earnings_yield", "fcf_yield", "dividend_yield",
  "gross_margin", "operating_margin", "net_margin", "roe", "roa", "roic",
  "current_ratio", "debt_to_equity", "revenue_growth_1y", "eps_growth_1y",
  "f_score", "price",
  "value_score", "quality_score", "growth_score", "composite_factor_score",
  "earnings_quality_score", "leverage_score",
]);

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const sector = sp.get("sector");
    const minFScore = parseInt(sp.get("min_f") ?? "0", 10);
    const minComposite = parseInt(sp.get("min_composite") ?? "0", 10);
    const maxPE = parseFloat(sp.get("max_pe") ?? "0");
    const minROE = parseFloat(sp.get("min_roe") ?? "0");
    const verdict = sp.get("verdict"); // STRONG | ATTRACTIVE | ...
    const rawSort = sp.get("sort") ?? "composite_factor_score";
    const sortBy = ALLOWED_SORTS.has(rawSort) ? rawSort : "composite_factor_score";
    const sortDir = sp.get("dir") === "asc";
    const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10), 1000);

    if ([minFScore, minComposite].some(Number.isNaN) || [maxPE, minROE].some(Number.isNaN)) {
      return NextResponse.json({ error: "Invalid filter parameter" }, { status: 400 });
    }

    const sb = createServerClient();

    type FundamentalsRow = {
      symbol: string;
      price: number | null;
      market_cap: number | null;
      pe_ratio: number | null;
      pb_ratio: number | null;
      ps_ratio: number | null;
      p_fcf_ratio: number | null;
      ev_ebitda: number | null;
      earnings_yield: number | null;
      fcf_yield: number | null;
      dividend_yield: number | null;
      gross_margin: number | null;
      operating_margin: number | null;
      net_margin: number | null;
      roe: number | null;
      roa: number | null;
      roic: number | null;
      current_ratio: number | null;
      debt_to_equity: number | null;
      revenue_growth_1y: number | null;
      revenue_growth_3y: number | null;
      net_income_growth_1y: number | null;
      eps_growth_1y: number | null;
      f_score: number | null;
      value_score: number | null;
      quality_score: number | null;
      growth_score: number | null;
      earnings_quality_score: number | null;
      leverage_score: number | null;
      composite_factor_score: number | null;
      sector_value_pctile: number | null;
      sector_quality_pctile: number | null;
      accruals_ratio: number | null;
      interest_coverage: number | null;
      fundamental_verdict: string | null;
      fundamental_summary: string | null;
    };

    type UniverseRow = { symbol: string; company_name: string | null; sector: string | null; industry: string | null; country: string | null; exchange: string | null; tier: string | null };
    type RadarRow = { symbol: string; state: number; quality_rank: number };

    const [fundamentals, universe, radar] = await Promise.all([
      fetchAll<FundamentalsRow>(sb, "fundamentals_snapshot", `
        symbol, price, market_cap,
        pe_ratio, pb_ratio, ps_ratio, p_fcf_ratio, ev_ebitda,
        earnings_yield, fcf_yield, dividend_yield,
        gross_margin, operating_margin, net_margin,
        roe, roa, roic,
        current_ratio, debt_to_equity,
        revenue_growth_1y, revenue_growth_3y,
        net_income_growth_1y, eps_growth_1y, f_score,
        value_score, quality_score, growth_score,
        earnings_quality_score, leverage_score, composite_factor_score,
        sector_value_pctile, sector_quality_pctile,
        accruals_ratio, interest_coverage,
        fundamental_verdict, fundamental_summary
      `),
      fetchAll<UniverseRow>(sb, "universe_members", "symbol, company_name, sector, industry, country, exchange, tier", (q) =>
        q.eq("is_active", true)
      ),
      fetchAll<RadarRow>(sb, "trend_radar", "symbol, state, quality_rank"),
    ]);

    const uniMap = new Map(universe.map((r) => [r.symbol, r]));
    const radarMap = new Map(radar.map((r) => [r.symbol, r]));

    let filtered = fundamentals.filter((r) => {
      const u = uniMap.get(r.symbol);
      if (!u) return false;
      return isResearchDeskEligible({
        symbol: r.symbol,
        tier: u.tier,
        is_active: true,
        company_name: u.company_name,
        sector: u.sector,
        industry: u.industry,
      });
    });

    if (minFScore > 0) filtered = filtered.filter((r) => (r.f_score ?? 0) >= minFScore);
    if (minComposite > 0) filtered = filtered.filter((r) => (r.composite_factor_score ?? 0) >= minComposite);
    if (maxPE > 0) filtered = filtered.filter((r) => r.pe_ratio != null && r.pe_ratio > 0 && r.pe_ratio <= maxPE);
    if (minROE > 0) filtered = filtered.filter((r) => (r.roe ?? 0) >= minROE);
    if (sector) filtered = filtered.filter((r) => uniMap.get(r.symbol)?.sector === sector);
    if (verdict) filtered = filtered.filter((r) => r.fundamental_verdict === verdict);

    filtered.sort((a, b) => {
      const av = a[sortBy as keyof typeof a] as number | null;
      const bv = b[sortBy as keyof typeof b] as number | null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir ? av - bv : bv - av;
    });

    filtered = filtered.slice(0, limit);

    const quotes = await fetchSessionQuotes(sb, filtered.map((r) => r.symbol), undefined, {
      fillMissing: true,
      fillLimit: 80,
    });

    const sectors = Array.from(
      new Set(universe.map((r) => r.sector).filter(Boolean))
    ).sort() as string[];

    const rows = filtered.map((r) => {
      const u = uniMap.get(r.symbol)!;
      const tr = radarMap.get(r.symbol);
      const quote = quotes.get(r.symbol);
      const refreshed = refreshFundamentalQuotes({
        snapshotPrice: r.price,
        snapshotMarketCap: r.market_cap,
        livePrice: quote?.last ?? null,
        quoteAsOf: quote?.asOf ?? null,
        quoteStale: quote?.stale ?? true,
      });
      const margins = sanitizeMargins(r.gross_margin, r.operating_margin, r.net_margin);
      return {
        symbol: r.symbol,
        companyName: u.company_name ?? "",
        sector: displaySector(u),
        country: u.country ?? "",
        exchange: u.exchange ?? "",
        tier: u.tier ?? "",
        state: tr?.state ?? null,
        rank: tr?.quality_rank ?? null,
        price: refreshed.price,
        priceAsOf: refreshed.priceAsOf,
        quoteStale: refreshed.quoteStale,
        snapshotPrice: refreshed.snapshotPrice,
        marketCap: refreshed.marketCap,
        snapshotMarketCap: refreshed.snapshotMarketCap,
        marketCapImpliedFromPrice: refreshed.marketCapImpliedFromPrice,
        pe: sanitizePeRatio(r.pe_ratio),
        snapshotPe: r.pe_ratio,
        priceVendorMismatch: refreshed.priceVendorMismatch,
        sharesImplied: refreshed.sharesImplied,
        marketCapUnit: refreshed.marketCapUnit,
        pb: r.pb_ratio,
        ps: r.ps_ratio,
        pFcf: r.p_fcf_ratio,
        evEbitda: r.ev_ebitda,
        earningsYield: r.earnings_yield,
        fcfYield: r.fcf_yield,
        divYield: r.dividend_yield,
        grossMargin: margins.grossMargin,
        opMargin: margins.operatingMargin,
        netMargin: margins.netMargin,
        marginSanityOk: margins.marginSanityOk,
        marginNote: margins.marginNote,
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
        valueScore: r.value_score,
        qualityScore: r.quality_score,
        growthScore: r.growth_score,
        earningsQualityScore: r.earnings_quality_score,
        leverageScore: r.leverage_score,
        compositeScore: r.composite_factor_score,
        sectorValuePctile: r.sector_value_pctile,
        sectorQualityPctile: r.sector_quality_pctile,
        accrualsRatio: r.accruals_ratio,
        interestCoverage: r.interest_coverage,
        verdict: r.fundamental_verdict,
        summary: r.fundamental_summary,
      };
    });

    const pricesAsOf =
      rows
        .map((row) => row.priceAsOf)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) ?? null;

    return NextResponse.json({
      rows,
      sectors,
      pricesAsOf,
      quotesSource: "prices_daily",
    });
  } catch (err) {
    console.error("Fundamentals API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
