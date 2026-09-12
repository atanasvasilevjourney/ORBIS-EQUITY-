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
    type SignalRow = {
      nct_id: string; ticker: string; event_type: string; direction: string; phase: string | null;
      confidence: number | null; days_to_catalyst: number | null; price_at_signal: number | null;
    };
    type TrialRow = {
      nct_id: string; drug_name: string | null; condition: string | null; phase: string | null;
      overall_status: string | null; completion_date: string | null; results_posted: boolean | null;
    };

    const [universe, fundamentals, radar, signals, trials] = await Promise.all([
      fetchAll<UniverseRow>(sb, "universe_members", "symbol, company_name, sector, industry, country, exchange", (q) =>
        q.eq("is_active", true)
      ),
      fetchAll<FundRow>(sb, "fundamentals_snapshot", `
        symbol, price, market_cap, pe_ratio, roe, net_margin, dividend_yield,
        revenue_growth_1y, value_score, quality_score, growth_score,
        composite_factor_score, f_score
      `),
      fetchAll<RadarRow>(sb, "trend_radar", "symbol, state, quality_rank"),
      fetchAll<SignalRow>(sb, "pharma_signals", "nct_id, ticker, event_type, direction, phase, confidence, days_to_catalyst, price_at_signal"),
      fetchAll<TrialRow>(sb, "pharma_trials", "nct_id, drug_name, condition, phase, overall_status, completion_date, results_posted"),
    ]);

    const healthUni = universe.filter((u) => HEALTH_SECTORS.has(u.sector ?? ""));
    const healthSymbols = new Set(healthUni.map((u) => u.symbol));
    const uniMap = new Map(healthUni.map((u) => [u.symbol, u]));
    const fundMap = new Map(fundamentals.map((f) => [f.symbol, f]));
    const radarMap = new Map(radar.map((r) => [r.symbol, r]));
    const trialMap = new Map(trials.map((t) => [t.nct_id, t]));

    // Health-sector fundamentals leaderboard (sorted by composite factor score)
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

    // Clinical-trial catalyst calendar (upcoming readouts first)
    const catalysts = signals
      .filter((s) => healthSymbols.has(s.ticker))
      .map((s) => {
        const t = trialMap.get(s.nct_id);
        return {
          nctId: s.nct_id,
          ticker: s.ticker,
          companyName: uniMap.get(s.ticker)?.company_name ?? "",
          eventType: s.event_type,
          direction: s.direction,
          phase: s.phase,
          confidence: s.confidence,
          daysToCatalyst: s.days_to_catalyst,
          drugName: t?.drug_name ?? null,
          condition: t?.condition ?? null,
          status: t?.overall_status ?? null,
          completionDate: t?.completion_date ?? null,
          resultsPosted: t?.results_posted ?? null,
        };
      })
      .sort((a, b) => {
        // upcoming (>=0) ascending first, then past (negative) by recency
        const ax = a.daysToCatalyst ?? 99999;
        const bx = b.daysToCatalyst ?? 99999;
        const aUp = ax >= 0, bUp = bx >= 0;
        if (aUp !== bUp) return aUp ? -1 : 1;
        return aUp ? ax - bx : bx - ax;
      });

    const upcoming = catalysts.filter((c) => (c.daysToCatalyst ?? -1) >= 0);
    const longs = catalysts.filter((c) => c.direction === "LONG");

    return NextResponse.json({
      rows,
      catalysts,
      summary: {
        healthNames: rows.length,
        totalCatalysts: catalysts.length,
        upcomingCatalysts: upcoming.length,
        longSignals: longs.length,
        phase3: catalysts.filter((c) => c.phase === "PHASE3").length,
      },
    });
  } catch (err) {
    console.error("Health API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
